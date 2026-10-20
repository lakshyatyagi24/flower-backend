import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeIndianPhone } from '../common/validators';
import { MailService } from '../mail/mail.service';
import { isOnlinePaymentsEnabled } from '../payments/config';
import { SETTING_DEFAULTS } from '../settings/setting-defaults';
import { DeliveryService } from '../delivery/delivery.service';
import { istNow, toStoredDate } from '../delivery/delivery-date';
import { canAccessOrder } from './order-access';
import { round2 } from '../common/money';
import {
  belowMinimumTotalError, couponError, evaluateCoupon, MIN_DISCOUNTED_TOTAL, normalizeCouponCode,
} from '../coupons/coupon-rules';
import { gstPerLine } from '../coupons/discount-tax';
import { buildOrderSearchWhere, resolveDayRange, zeroFillSeries } from './orders-query';
import { EXPORT_ROW_CAP, exportFilename, ordersToCsv, type ExportOrder } from './orders-csv';
import {
  ALLOWED_STATUSES,
  assertTransition,
  isOrderStatus,
  MISMATCH_MARKER,
  OrderStatus,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  POST_SWITCH_MARKER,
} from './order-status';
import { AdminOrderPatch, assertRefundEligible, buildAdminData, planRefundNoteWrite } from './order-admin-patch';
import { buildOrderItems, OrderItemInput, OrderItemRow, ProductRow, TaxLine } from './order-items';

export interface OrderListFilters {
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  attention?: string;
  sort?: string;
  /** Free-text admin search: order id, customer email / name / phone. */
  q?: string;
}

interface CreateOrderInput {
  items: OrderItemInput[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  city: string;
  postalCode: string;
  notes?: string;
  paymentMethod?: string;
  /** `YYYY-MM-DD` (IST calendar date). Stored as UTC midnight of that date. */
  deliveryDate: string;
  /** Optional coupon code; trimmed and upper-cased here. Re-validated inside the order transaction. */
  couponCode?: string;
}

/** Everything the order transaction needs, computed before it opens. */
interface OrderDraft {
  userId: number | null;
  input: CreateOrderInput;
  deliveryDate: string;
  customerEmail: string;
  couponInput: ReturnType<typeof normalizeCouponCode>;
  subtotal: number;
  shipping: number;
  taxLines: TaxLine[];
  itemRows: OrderItemRow[];
}

type AttentionKey = 'refund' | 'mismatch' | 'awaiting';

// Orders needing the owner's attention. Defined ONCE; listAll(attention) and stats() both use these.
const ATTENTION_WHERE: Record<AttentionKey, Record<string, unknown>> = {
  // paid, then cancelled: money is owed back (REFUNDED excluded by construction)
  refund: { paymentStatus: 'PAID', status: 'CANCELLED' },
  // "capture needs manual review": amount mismatch, or a payment captured after a switch to COD
  mismatch: {
    OR: [{ refundNote: { contains: MISMATCH_MARKER } }, { refundNote: { contains: POST_SWITCH_MARKER } }],
    paymentStatus: { not: 'REFUNDED' },
  },
  // online order still waiting for its payment
  awaiting: { paymentMethod: 'RAZORPAY', paymentStatus: { in: ['UNPAID', 'FAILED'] }, status: 'PENDING' },
};

const ENUM_FILTERS = [
  ['status', ALLOWED_STATUSES],
  ['paymentStatus', PAYMENT_STATUSES],
  ['paymentMethod', PAYMENT_METHODS],
] as const;

const NOT_SWITCHABLE_MESSAGE = 'Order can no longer be switched to cash on delivery';
const fireAndForget = (p: Promise<unknown>) => void p.catch(() => undefined);

/** An unpaid online order that has not captured any payment can still be switched to COD. */
function isSwitchable(o: any): boolean {
  return !!o && o.paymentMethod === 'RAZORPAY' && o.status === 'PENDING' &&
    (o.paymentStatus === 'UNPAID' || o.paymentStatus === 'FAILED') && !o.razorpayPaymentId;
}

/** Already-COD is idempotent; anything else is a lost race or a non-switchable order. */
function isLostSwitch(fresh: any): boolean {
  return !fresh || fresh.paymentMethod !== 'COD' || fresh.status === 'CANCELLED' ||
    fresh.paymentStatus === 'PAID' || !!fresh.razorpayPaymentId;
}

function switchToCodData(abandoned: string | null, existingNote: string | null): Record<string, unknown> {
  const data: Record<string, unknown> = { paymentMethod: 'COD', razorpayOrderId: null, paymentStatus: 'UNPAID' };
  if (abandoned) {
    const marker = `Switched to COD; abandoned Razorpay order ${abandoned}`;
    data.refundNote = existingNote ? `${existingNote}\n${marker}` : marker;
  }
  return data;
}

function emailMatches(stored: string | null | undefined, given: string): boolean {
  return !!given && stored?.toLowerCase() === given.trim().toLowerCase();
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly delivery: DeliveryService,
  ) {}

  private include = {
    items: {
      select: {
        id: true,
        productId: true,
        productName: true,
        quantity: true,
        unitPrice: true,
        gstRate: true,
        gstAmount: true,
        product: { select: { id: true, slug: true, image: true } },
      },
    },
    user: { select: { id: true, email: true, name: true } },
  } as const;

  private async loadShippingRate(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'shipping.flatRate' } });
    // A missing row uses the same default the public /settings exposes; a present-but-invalid value means 0.
    const raw = setting ? setting.value : SETTING_DEFAULTS['shipping.flatRate'];
    const v = parseFloat(raw);
    return isNaN(v) ? 0 : v;
  }

  private async loadFreeShippingThreshold(): Promise<number | null> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'shipping.freeThreshold' } });
    // Missing row: same default as /settings. A blank/invalid value means "no free shipping".
    const raw = setting ? setting.value : SETTING_DEFAULTS['shipping.freeThreshold'];
    const v = parseFloat(raw);
    return isNaN(v) ? null : v;
  }

  private async computeShipping(subtotal: number): Promise<number> {
    const flatRate = await this.loadShippingRate();
    const freeThreshold = await this.loadFreeShippingThreshold();
    return freeThreshold !== null && subtotal >= freeThreshold ? 0 : flatRate;
  }

  /** Cheap input gates; all run before any product/stock work or side effect. */
  private async assertOrderable(input: CreateOrderInput): Promise<void> {
    // DTO covers shape; these catch whitespace-only values it cannot.
    if (!input.customerName.trim()) throw new BadRequestException('Customer name is required');
    if (!input.shippingAddress.trim()) throw new BadRequestException('Shipping address is required');

    if (input.paymentMethod === 'RAZORPAY' && !isOnlinePaymentsEnabled()) {
      throw new BadRequestException('Online payments are currently unavailable. Please choose cash on delivery.');
    }

    // Serviceability gate.
    if (!(await this.delivery.isServiceable((input.postalCode ?? '').trim()))) {
      throw new BadRequestException('We do not deliver to this PIN code yet');
    }
  }

  private async loadProductMap(items: OrderItemInput[]): Promise<Map<number, ProductRow>> {
    const productIds = items.map((i) => i.productId);
    const products: ProductRow[] = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products are unavailable');
    }
    return new Map<number, ProductRow>(products.map((p) => [p.id, p]));
  }

  /**
   * For a logged-in buyer, bind the order's tracking email to their account
   * email so ownership (userId) and the email-based tracking key cannot diverge.
   */
  private async resolveCustomerEmail(userId: number | null, given: string): Promise<string> {
    const customerEmail = given.trim().toLowerCase();
    if (!userId) return customerEmail;
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return account?.email ? account.email.trim().toLowerCase() : customerEmail;
  }

  async create(userId: number | null, input: CreateOrderInput) {
    await this.assertOrderable(input);

    // Delivery-date gate (cut-off, lead time, window, blackout dates): also before any product/stock work.
    const deliveryDate = await this.delivery.validateDeliveryDate(input.deliveryDate);

    const productMap = await this.loadProductMap(input.items);
    const { itemRows, taxLines, subtotal } = buildOrderItems(input.items, productMap);
    const shipping = await this.computeShipping(subtotal);
    // R19: free shipping and the coupon minimum are both judged on the PRE-discount subtotal (above). The discount
    // comes off the item subtotal; GST is charged on the value AFTER the discount (spread over the lines in
    // proportion, see discount-tax.ts), so a discount also lowers the tax. Shipping is unaffected.
    const couponInput = normalizeCouponCode(input.couponCode);
    const customerEmail = await this.resolveCustomerEmail(userId, input.customerEmail);

    const draft: OrderDraft = {
      userId, input, deliveryDate, customerEmail, couponInput, subtotal, shipping, taxLines, itemRows,
    };
    const created = await this.prisma.$transaction((tx) => this.createInTransaction(tx, draft));
    // Fire-and-forget: mail must never fail or slow the request. Online-payment
    // orders are unpaid at creation, so they are announced on capture instead
    // (PaymentsService.markPaid -> sendOrderPaid).
    if ((input.paymentMethod || 'COD') !== 'RAZORPAY') {
      fireAndForget(this.mail.sendOrderPlaced(created));
    }
    return this.forCustomer(created);
  }

  private async createInTransaction(tx: any, draft: OrderDraft) {
    // Coupon FIRST, inside the transaction and against the server-computed subtotal: any failure rolls the
    // whole order back (stock claims below have not happened yet, or are undone with the rollback).
    const { discount, couponCode } = await this.applyCoupon(tx, draft);
    const lineGst = gstPerLine(draft.taxLines, discount);
    const rows = draft.itemRows.map((r, i) => ({ ...r, gstAmount: lineGst[i] }));
    const gst = round2(lineGst.reduce((a, b) => a + b, 0));
    const total = round2(draft.subtotal - discount + draft.shipping + gst);

    await this.claimStock(tx, draft.itemRows);
    return tx.order.create({
      data: { ...this.buildOrderData(draft, { discount, couponCode, gst, total }), items: { create: rows } },
      include: this.include,
    });
  }

  private buildOrderData(
    { userId, input, deliveryDate, customerEmail, subtotal, shipping }: OrderDraft,
    totals: { discount: number; couponCode: string | null; gst: number; total: number },
  ) {
    return {
      userId: userId ?? null,
      subtotal,
      shipping,
      gst: totals.gst,
      couponCode: totals.couponCode,
      discount: totals.discount,
      total: totals.total,
      status: 'PENDING',
      paymentMethod: input.paymentMethod || 'COD',
      customerName: input.customerName.trim(),
      customerEmail,
      customerPhone: normalizeIndianPhone(input.customerPhone ?? ''),
      shippingAddress: input.shippingAddress.trim(),
      city: input.city?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      notes: input.notes?.trim() || null,
      deliveryDate: toStoredDate(deliveryDate),
    };
  }

  private async applyCoupon(
    tx: any,
    { couponInput, subtotal, shipping, taxLines }: OrderDraft,
  ): Promise<{ discount: number; couponCode: string | null }> {
    if (!couponInput) return { discount: 0, couponCode: null };
    const coupon = await tx.coupon.findUnique({ where: { code: couponInput } });
    const discount = evaluateCoupon(coupon, subtotal);
    const gstIfApplied = gstPerLine(taxLines, discount).reduce((a, b) => a + b, 0);
    if (round2(subtotal - discount + shipping + gstIfApplied) < MIN_DISCOUNTED_TOTAL) throw belowMinimumTotalError();
    await this.claimCouponUse(tx, coupon, subtotal);
    return { discount, couponCode: coupon!.code };
  }

  /**
   * Atomic use claim: the guard is re-evaluated against the committed row, so of N concurrent orders
   * racing for the last use exactly one gets count 1.
   */
  private async claimCouponUse(tx: any, coupon: any, subtotal: number): Promise<void> {
    const claimed = await tx.coupon.updateMany({
      where: {
        id: coupon.id,
        active: true,
        AND: [
          { OR: [{ maxUses: null }, { usedCount: { lt: coupon.maxUses ?? 0 } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count !== 0) return;
    // Lost the race (or the coupon changed after we read it): re-read it so the error names the real reason.
    const fresh = await tx.coupon.findUnique({ where: { id: coupon.id } });
    evaluateCoupon(fresh, subtotal); // throws not found / expired / usage limit as appropriate
    throw couponError('Coupon usage limit reached');
  }

  /**
   * Atomically claim stock BEFORE creating the order. updateMany with a
   * `stock >= qty` guard serializes concurrent buyers — if another order
   * took the last units between our snapshot and now, count is 0 and we
   * roll back instead of overselling into negative stock.
   */
  private async claimStock(tx: any, itemRows: OrderItemRow[]): Promise<void> {
    for (const it of itemRows) {
      const claimed = await tx.product.updateMany({
        where: { id: it.productId, stock: { gte: it.quantity } },
        data: { stock: { decrement: it.quantity } },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          `"${it.productName}" just went out of stock — please adjust your cart and try again`,
        );
      }
    }
  }

  /**
   * Owner-only bookkeeping and provider references never reach customer-facing endpoints (same set
   * track() strips). The checkout gets its Razorpay order id from POST /payments/razorpay/order.
   */
  private forCustomer<T extends Record<string, unknown>>(
    order: T,
  ): Omit<T, 'adminNotes' | 'refundNote' | 'razorpayOrderId' | 'razorpayPaymentId'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { adminNotes: _a, refundNote: _r, razorpayOrderId: _o, razorpayPaymentId: _p, ...rest } = order;
    return rest;
  }

  /**
   * Switch an unpaid online (RAZORPAY) order to cash on delivery. Ownership mirrors
   * PaymentsService.createRazorpayOrder: unknown and not-yours are both 403. The write is CAS-guarded
   * and nulls razorpayOrderId so a late capture on the abandoned Razorpay order can never mark this
   * COD order PAID (the webhook then sees an unknown order; the owner refunds manually).
   */
  async switchToCod(orderId: number, userId: number | null, email: string | null) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    const owns = canAccessOrder(order, { userId, email });
    if (!order || !owns) throw new ForbiddenException('Not your order');

    const switched = await this.casSwitchToCod(orderId, order);

    const fresh = await this.prisma.order.findUnique({ where: { id: orderId }, include: this.include });
    if (switched) {
      if (fresh) fireAndForget(this.mail.sendOrderPlaced(fresh));
    } else if (isLostSwitch(fresh)) {
      throw new ConflictException(NOT_SWITCHABLE_MESSAGE);
    }
    if (!fresh) throw new ConflictException(NOT_SWITCHABLE_MESSAGE);
    return this.forCustomer(fresh);
  }

  /**
   * The CAS is bound to the razorpayOrderId and refundNote values we READ, so the marker we append
   * names exactly the Razorpay order being abandoned. If createRazorpayOrder (or a webhook trace)
   * changed either meanwhile, the CAS matches nothing; we re-read and retry (bounded), and if the
   * order is no longer switchable the caller's 409 logic applies. Returns true iff this call switched it.
   */
  private async casSwitchToCod(orderId: number, order: any): Promise<boolean> {
    let current: any = order;
    for (let attempt = 0; attempt < 3 && isSwitchable(current); attempt++) {
      const abandoned: string | null = current.razorpayOrderId ?? null;
      const existingNote: string | null = current.refundNote ?? null;
      const res = await this.prisma.order.updateMany({
        where: {
          id: orderId,
          paymentMethod: 'RAZORPAY',
          status: 'PENDING',
          paymentStatus: { in: ['UNPAID', 'FAILED'] },
          razorpayPaymentId: null,
          razorpayOrderId: abandoned,
          refundNote: existingNote,
        },
        data: switchToCodData(abandoned, existingNote),
      });
      if (res.count === 1) return true;
      current = await this.prisma.order.findUnique({ where: { id: orderId } });
    }
    return false;
  }

  async listMine(userId: number) {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      include: this.include,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.forCustomer(r));
  }

  async getMine(userId: number, id: number) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Not your order');
    return this.forCustomer(order);
  }

  // Public tracking is email-based BY DESIGN (it is how guests and account holders look an order up with just
  // id + email), so it intentionally does not use canAccessOrder. It returns a stripped view and one generic 404.
  async track(id: number, email: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    // Single generic error for both "no such order" and "email mismatch" so
    // sequential order IDs can't be enumerated via 404-vs-403 responses.
    if (!order || !emailMatches(order.customerEmail, email)) {
      throw new NotFoundException('Order not found, or the email does not match this order');
    }
    // Strip internal-only fields before returning to the public tracking endpoint.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { adminNotes: _a, refundNote: _r, razorpayOrderId: _o, razorpayPaymentId: _p, ...publicOrder } = order;
    return publicOrder;
  }

  /**
   * ONE place that turns the admin list filters into a Prisma `where`; the paginated list and the CSV export
   * both use it so they can never disagree about which orders match.
   */
  private buildListWhere(params: OrderListFilters): { where: Record<string, unknown>; upcoming: boolean } {
    const where: Record<string, unknown> = {};
    for (const [key, allowed] of ENUM_FILTERS) {
      const value = params[key];
      if (value && (allowed as readonly string[]).includes(value)) where[key] = value;
    }
    const and = this.buildListAnd(params);
    if (and.length) where.AND = and;
    // "Upcoming deliveries": only orders due today (India date) or later, soonest first, so a long history of
    // past deliveries can never push upcoming ones out of the 200-row page.
    const upcoming = params.sort === 'deliveryDate';
    if (upcoming) where.deliveryDate = { gte: toStoredDate(istNow(new Date()).date) };
    return { where, upcoming };
  }

  private buildListAnd(params: OrderListFilters): Record<string, unknown>[] {
    const and: Record<string, unknown>[] = [];
    if (params.attention && Object.prototype.hasOwnProperty.call(ATTENTION_WHERE, params.attention)) {
      and.push(ATTENTION_WHERE[params.attention as AttentionKey]);
    }
    const search = buildOrderSearchWhere(params.q);
    if (search) and.push(search);
    return and;
  }

  async listAll(params: OrderListFilters & { take?: number; skip?: number }) {
    const { where, upcoming } = this.buildListWhere(params);
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const skip = Math.max(params.skip ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: this.include,
        orderBy: upcoming ? [{ deliveryDate: 'asc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, take, skip };
  }

  /** CSV of the orders matching the SAME filters as the list, newest first (or soonest delivery), capped. */
  async exportCsv(params: OrderListFilters, now: Date = new Date()) {
    const { where, upcoming } = this.buildListWhere(params);
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true, createdAt: true, status: true, paymentMethod: true, paymentStatus: true,
          customerName: true, customerEmail: true, customerPhone: true, city: true, postalCode: true,
          deliveryDate: true, subtotal: true, discount: true, couponCode: true, shipping: true, gst: true,
          total: true, trackingNumber: true, courierName: true,
          items: { select: { productName: true, quantity: true }, orderBy: { id: 'asc' } },
        },
        orderBy: upcoming ? [{ deliveryDate: 'asc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
        take: EXPORT_ROW_CAP,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      csv: ordersToCsv(rows as ExportOrder[]),
      filename: exportFilename(now),
      exported: rows.length,
      total,
      truncated: total > rows.length,
    };
  }

  async getOne(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private assertTransition(from: OrderStatus, to: OrderStatus) {
    assertTransition(from, to);
  }

  /**
   * Flip an order to CANCELLED and give its reserved stock back, atomically with the caller's
   * transaction. The status write is guarded (`status != CANCELLED` plus any `extraWhere`), and
   * stock is restored ONLY if this call performed the flip, so concurrent/repeated cancels can
   * never restock twice and a changed precondition (e.g. just paid) cancels nothing.
   * Returns true iff this call cancelled the order.
   */
  async cancelAndRestock(
    tx: any,
    orderId: number,
    extraWhere: Record<string, unknown> = {},
  ): Promise<boolean> {
    const flipped = await tx.order.updateMany({
      // AND-composed so an extraWhere can never override the id or the CANCELLED guard.
      where: { AND: [{ id: orderId, status: { not: 'CANCELLED' } }, extraWhere] },
      data: { status: 'CANCELLED' },
    });
    if (flipped.count !== 1) return false;
    await this.giveBackCoupon(tx, orderId);
    await this.restockItems(tx, orderId);
    return true;
  }

  /**
   * Coupon give-back (R19). Reached only by the call that performed the CANCELLED flip, so it happens
   * exactly once per order; the `usedCount > 0` guard keeps the counter from ever going negative.
   */
  private async giveBackCoupon(tx: any, orderId: number): Promise<void> {
    const couponRow = await tx.order.findUnique({ where: { id: orderId }, select: { couponCode: true } });
    if (!couponRow?.couponCode) return;
    await tx.coupon.updateMany({
      where: { code: couponRow.couponCode, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }

  private async restockItems(tx: any, orderId: number): Promise<void> {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { productId: true, quantity: true },
    });
    for (const it of items) {
      if (!it.productId) continue;
      await tx.product.update({
        where: { id: it.productId },
        data: { stock: { increment: it.quantity } },
      });
    }
  }

  /**
   * Compare-and-set a status change against the status the validation was based on
   * (`from`). If anyone changed the order since it was read (e.g. the stale-order job
   * cancelled and restocked it), nothing is written and a Conflict is thrown, so a
   * cancelled order can never be revived and stock can never be restored twice.
   */
  private async transition(tx: any, id: number, from: OrderStatus, to: OrderStatus, data: Record<string, unknown>) {
    const conflict = () => new ConflictException('Order was changed by someone else — reload and try again');
    if (to === 'CANCELLED') {
      if (!(await this.cancelAndRestock(tx, id, { status: from }))) throw conflict();
      await this.writeNonStatusFields(tx, id, data);
    } else {
      const res = await tx.order.updateMany({ where: { id, status: from }, data });
      if (res.count !== 1) throw conflict();
    }
    return tx.order.findUnique({ where: { id }, include: this.include });
  }

  /** Any non-status fields from the same patch as a cancellation. */
  private async writeNonStatusFields(tx: any, id: number, data: Record<string, unknown>): Promise<void> {
    const { status: _s, ...rest } = data; // eslint-disable-line @typescript-eslint/no-unused-vars
    if (Object.keys(rest).length) await tx.order.update({ where: { id }, data: rest });
  }

  async updateStatus(id: number, status: string) {
    if (!isOrderStatus(status)) throw new BadRequestException('Invalid status');
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order not found');
    const from = existing.status as OrderStatus;
    const to = status;
    if (from === to) return this.getOne(id);
    this.assertTransition(from, to);

    const updated = await this.prisma.$transaction((tx) => this.transition(tx, id, from, to, { status: to }));
    if (to === 'SHIPPED') fireAndForget(this.mail.sendOrderShipped(updated));
    return updated;
  }

  /**
   * Generic admin-only update for fulfillment fields. Each field is optional so
   * admins can edit a tracking number without re-supplying everything else.
   */
  async adminUpdate(id: number, patch: AdminOrderPatch) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order not found');

    const data = buildAdminData(patch, existing.status);
    const markRefunded = patch.paymentStatus === 'REFUNDED';
    const readNote: string | null = existing.refundNote ?? null;
    const { writeNote, newNote } = planRefundNoteWrite(patch.refundNote, readNote);
    if (markRefunded) assertRefundEligible(existing.paymentStatus, readNote);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (markRefunded || writeNote) {
        await this.casRefundFields(tx, existing, readNote, markRefunded, writeNote ? { note: newNote } : null);
      }
      if (data.status !== undefined) {
        return this.transition(tx, id, existing.status as OrderStatus, data.status as OrderStatus, data);
      }
      // No status change: plain field edits stay unguarded.
      return tx.order.update({ where: { id }, data, include: this.include });
    });
    // data.status is only set when the status actually changed.
    if (data.status === 'SHIPPED') fireAndForget(this.mail.sendOrderShipped(updated));
    return updated;
  }

  /**
   * Compare-and-set on the paymentStatus and note we read: a webhook trace appended meanwhile makes
   * this match nothing, so it can never be silently overwritten. Never touches status/stock/mail.
   */
  private async casRefundFields(
    tx: any,
    existing: { id: number; paymentStatus: string },
    readNote: string | null,
    markRefunded: boolean,
    noteWrite: { note: string | null | undefined } | null,
  ): Promise<void> {
    const cas: Record<string, unknown> = { id: existing.id, refundNote: readNote };
    if (markRefunded) cas.paymentStatus = existing.paymentStatus;
    const casData: Record<string, unknown> = {};
    if (markRefunded) casData.paymentStatus = 'REFUNDED';
    if (noteWrite) casData.refundNote = noteWrite.note;
    const res = await tx.order.updateMany({ where: cas, data: casData });
    if (res.count === 1) return;
    const now = await tx.order.findUnique({ where: { id: existing.id } });
    if (markRefunded && now && now.paymentStatus !== existing.paymentStatus) {
      throw new ConflictException('Only a paid order can be marked refunded');
    }
    throw new ConflictException('The note was changed meanwhile - reload and try again');
  }

  async stats(range?: { from?: unknown; to?: unknown }, now: Date = new Date()) {
    const dayRange = resolveDayRange(range?.from, range?.to, now);
    // Both groups start before either is awaited, so all queries still run concurrently.
    const [totals, attention] = await Promise.all([
      this.statsTotals(),
      this.statsAttention(dayRange.fromUtc, dayRange.toUtcExclusive),
    ]);
    return {
      ...totals.counts,
      revenue: totals.revenue,
      recentOrders: totals.recentOrders,
      openEnquiries: attention.openEnquiries,
      unpaidOnline: attention.unpaidOnline,
      refundsDue: attention.refundsDue,
      mismatches: attention.mismatches,
      range: { from: dayRange.from, to: dayRange.to },
      series: zeroFillSeries(dayRange.days, attention.seriesRows, round2),
    };
  }

  private async statsTotals() {
    const [orderCount, productCount, customerCount, totalAgg, recentOrders] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
      // Real sales only: not cancelled/refunded, and either cash on delivery or actually paid online.
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: {
          status: { not: 'CANCELLED' },
          paymentStatus: { not: 'REFUNDED' },
          OR: [{ paymentMethod: 'COD' }, { paymentStatus: 'PAID' }],
        },
      }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, customerName: true, total: true, status: true, createdAt: true },
      }),
    ]);
    return {
      counts: { orderCount, productCount, customerCount },
      revenue: totalAgg._sum.total ?? 0,
      recentOrders,
    };
  }

  private async statsAttention(fromUtc: Date, toUtcExclusive: Date) {
    const [openEnquiries, unpaidOnline, refundsDue, mismatches, seriesRows] = await Promise.all([
      this.prisma.enquiry.count({ where: { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } } }),
      this.prisma.order.count({ where: ATTENTION_WHERE.awaiting }),
      this.prisma.order.count({ where: ATTENTION_WHERE.refund }),
      this.prisma.order.count({ where: ATTENTION_WHERE.mismatch }),
      this.dailySeriesRows(fromUtc, toUtcExclusive),
    ]);
    return { openEnquiries, unpaidOnline, refundsDue, mismatches, seriesRows };
  }

  /**
   * Orders and revenue per IST calendar day in [fromUtc, toUtcExclusive) in ONE grouped query.
   * "createdAt" is a UTC `timestamp` (no zone), so adding the fixed +05:30 offset (India has no DST) and
   * casting to date gives the IST day; the range bounds are IST midnights expressed in UTC. The bounds are
   * passed as explicit-UTC timestamptz and converted with AT TIME ZONE 'UTC' so the comparison never depends
   * on the database session's TimeZone setting (a bare Date parameter would be read in the session zone).
   *  - orders: every order PLACED that day except CANCELLED
   *  - revenue: the SAME definition as the all-time `revenue` total in stats(): not CANCELLED, not REFUNDED,
   *    and either cash on delivery or actually PAID online (attributed to the day the order was placed)
   */
  private dailySeriesRows(fromUtc: Date, toUtcExclusive: Date) {
    return this.prisma.$queryRaw<{ date: string; orders: number; revenue: number | null }[]>`
      SELECT to_char(("createdAt" + interval '330 minutes')::date, 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS orders,
             SUM("total") FILTER (
               WHERE "paymentStatus" <> 'REFUNDED' AND ("paymentMethod" = 'COD' OR "paymentStatus" = 'PAID')
             )::float8 AS revenue
        FROM "Order"
       WHERE "createdAt" >= (${fromUtc.toISOString()}::timestamptz AT TIME ZONE 'UTC')
         AND "createdAt" < (${toUtcExclusive.toISOString()}::timestamptz AT TIME ZONE 'UTC')
         AND "status" <> 'CANCELLED'
       GROUP BY 1
    `;
  }
}
