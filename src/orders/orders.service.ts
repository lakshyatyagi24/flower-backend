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
import { joinRefundNote, splitRefundNote } from './refund-note';
import { SETTING_DEFAULTS } from '../settings/setting-defaults';
import { DeliveryService } from '../delivery/delivery.service';
import { istNow, toStoredDate } from '../delivery/delivery-date';

interface OrderItemInput {
  productId: number;
  quantity: number;
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
}

const ALLOWED_STATUSES = ['PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'] as const;
type OrderStatus = (typeof ALLOWED_STATUSES)[number];

// Legal forward transitions. COMPLETED and CANCELLED are terminal. This keeps
// the customer-facing tracking timeline coherent and lets cancellation restock
// exactly once (you cannot resurrect a CANCELLED order and re-cancel it).
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAID', 'SHIPPED', 'CANCELLED'],
  PAID: ['SHIPPED', 'COMPLETED', 'CANCELLED'],
  SHIPPED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const PAYMENT_STATUSES = ['UNPAID', 'PAID', 'FAILED', 'REFUNDED'] as const;
const PAYMENT_METHODS = ['COD', 'RAZORPAY'] as const;
const MISMATCH_MARKER = 'AMOUNT MISMATCH';
const POST_SWITCH_MARKER = 'CAPTURED AFTER SWITCH';

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

  async create(userId: number | null, input: CreateOrderInput) {
    // DTO covers shape; these catch whitespace-only values it cannot.
    if (!input.customerName.trim()) throw new BadRequestException('Customer name is required');
    if (!input.shippingAddress.trim()) throw new BadRequestException('Shipping address is required');

    if (input.paymentMethod === 'RAZORPAY' && !isOnlinePaymentsEnabled()) {
      throw new BadRequestException('Online payments are currently unavailable. Please choose cash on delivery.');
    }

    // Serviceability gate: runs before any product/stock work or side effect.
    if (!(await this.delivery.isServiceable((input.postalCode ?? '').trim()))) {
      throw new BadRequestException('We do not deliver to this PIN code yet');
    }

    // Delivery-date gate (cut-off, lead time, window, blackout dates): also before any product/stock work.
    const deliveryDate = await this.delivery.validateDeliveryDate(input.deliveryDate);

    const productIds = input.items.map((i) => i.productId);
    type ProductRow = {
      id: number;
      name: string;
      price: number;
      stock: number;
      active: boolean;
      saleMode: 'PURCHASE' | 'ENQUIRY';
      gstRate: number;
      minOrderQty: number;
    };
    const products: ProductRow[] = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products are unavailable');
    }
    const productMap = new Map<number, ProductRow>(products.map((p) => [p.id, p]));

    let subtotal = 0;
    let gstTotal = 0;
    const itemRows = input.items.map((it) => {
      const product = productMap.get(it.productId)!;
      if (!product.active) throw new BadRequestException(`Product "${product.name}" is not available`);
      if (product.saleMode === 'ENQUIRY') {
        throw new BadRequestException(`"${product.name}" is enquiry-only — please send an enquiry instead`);
      }
      const qty = Math.max(product.minOrderQty || 1, Math.floor(it.quantity || 1));
      if (qty > product.stock) {
        throw new BadRequestException(
          product.stock <= 0
            ? `"${product.name}" is out of stock`
            : `Only ${product.stock} of "${product.name}" available`,
        );
      }
      const lineTotal = product.price * qty;
      const gstRate = product.gstRate || 0;
      const gstAmount = +((lineTotal * gstRate) / 100).toFixed(2);
      subtotal += lineTotal;
      gstTotal += gstAmount;
      return {
        productId: product.id,
        productName: product.name,
        quantity: qty,
        unitPrice: product.price,
        gstRate,
        gstAmount,
      };
    });

    const flatRate = await this.loadShippingRate();
    const freeThreshold = await this.loadFreeShippingThreshold();
    const shipping = freeThreshold !== null && subtotal >= freeThreshold ? 0 : flatRate;
    const gst = +gstTotal.toFixed(2);
    const total = +(subtotal + shipping + gst).toFixed(2);

    // For a logged-in buyer, bind the order's tracking email to their account
    // email so ownership (userId) and the email-based tracking key cannot diverge.
    let customerEmail = input.customerEmail.trim().toLowerCase();
    if (userId) {
      const account = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (account?.email) customerEmail = account.email.trim().toLowerCase();
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Atomically claim stock BEFORE creating the order. updateMany with a
      // `stock >= qty` guard serializes concurrent buyers — if another order
      // took the last units between our snapshot and now, count is 0 and we
      // roll back instead of overselling into negative stock.
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

      const order = await tx.order.create({
        data: {
          userId: userId ?? null,
          subtotal,
          shipping,
          gst,
          total,
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
          items: { create: itemRows },
        },
        include: this.include,
      });

      return order;
    });
    // Fire-and-forget: mail must never fail or slow the request. Online-payment
    // orders are unpaid at creation, so they are announced on capture instead
    // (PaymentsService.markPaid -> sendOrderPaid).
    if ((input.paymentMethod || 'COD') !== 'RAZORPAY') {
      void this.mail.sendOrderPlaced(created).catch(() => undefined);
    }
    return this.forCustomer(created);
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
    const guestEmail = email?.trim().toLowerCase();
    const owns = order
      ? userId
        ? order.userId === userId
        : !!guestEmail && !!order.customerEmail && order.customerEmail.trim().toLowerCase() === guestEmail
      : false;
    if (!order || !owns) throw new ForbiddenException('Not your order');

    // The CAS is bound to the razorpayOrderId and refundNote values we READ, so the marker we append
    // names exactly the Razorpay order being abandoned. If createRazorpayOrder (or a webhook trace)
    // changed either meanwhile, the CAS matches nothing; we re-read and retry (bounded), and if the
    // order is no longer switchable the usual 409 logic below applies.
    const switchable = (o: any) =>
      !!o && o.paymentMethod === 'RAZORPAY' && o.status === 'PENDING' &&
      (o.paymentStatus === 'UNPAID' || o.paymentStatus === 'FAILED') && !o.razorpayPaymentId;
    let switched = { count: 0 };
    let current: any = order;
    for (let attempt = 0; attempt < 3 && switchable(current); attempt++) {
      const abandoned: string | null = current.razorpayOrderId ?? null;
      const existingNote: string | null = current.refundNote ?? null;
      const marker = abandoned ? `Switched to COD; abandoned Razorpay order ${abandoned}` : null;
      const data: Record<string, unknown> = { paymentMethod: 'COD', razorpayOrderId: null, paymentStatus: 'UNPAID' };
      if (marker) data.refundNote = existingNote ? `${existingNote}\n${marker}` : marker;
      switched = await this.prisma.order.updateMany({
        where: {
          id: orderId,
          paymentMethod: 'RAZORPAY',
          status: 'PENDING',
          paymentStatus: { in: ['UNPAID', 'FAILED'] },
          razorpayPaymentId: null,
          razorpayOrderId: abandoned,
          refundNote: existingNote,
        },
        data,
      });
      if (switched.count === 1) break;
      current = await this.prisma.order.findUnique({ where: { id: orderId } });
    }

    const fresh = await this.prisma.order.findUnique({ where: { id: orderId }, include: this.include });
    if (switched.count === 1) {
      if (fresh) void this.mail.sendOrderPlaced(fresh).catch(() => undefined);
    } else if (!fresh || fresh.paymentMethod !== 'COD' || fresh.status === 'CANCELLED' || fresh.paymentStatus === 'PAID' || fresh.razorpayPaymentId) {
      // Already-COD is idempotent (below); anything else is a lost race or a non-switchable order.
      throw new ConflictException('Order can no longer be switched to cash on delivery');
    }
    if (!fresh) throw new ConflictException('Order can no longer be switched to cash on delivery');
    return this.forCustomer(fresh);
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

  async track(id: number, email: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    // Single generic error for both "no such order" and "email mismatch" so
    // sequential order IDs can't be enumerated via 404-vs-403 responses.
    if (!order || !email || order.customerEmail?.toLowerCase() !== email.trim().toLowerCase()) {
      throw new NotFoundException('Order not found, or the email does not match this order');
    }
    // Strip internal-only fields before returning to the public tracking endpoint.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { adminNotes: _a, refundNote: _r, razorpayOrderId: _o, razorpayPaymentId: _p, ...publicOrder } = order;
    return publicOrder;
  }

  async listAll(params: { status?: string; paymentStatus?: string; paymentMethod?: string; attention?: string; sort?: string; take?: number; skip?: number }) {
    const where: Record<string, unknown> = {};
    if (params.status && (ALLOWED_STATUSES as readonly string[]).includes(params.status)) {
      where.status = params.status;
    }
    if (params.paymentStatus && (PAYMENT_STATUSES as readonly string[]).includes(params.paymentStatus)) {
      where.paymentStatus = params.paymentStatus;
    }
    if (params.paymentMethod && (PAYMENT_METHODS as readonly string[]).includes(params.paymentMethod)) {
      where.paymentMethod = params.paymentMethod;
    }
    if (params.attention && Object.prototype.hasOwnProperty.call(ATTENTION_WHERE, params.attention)) {
      where.AND = [ATTENTION_WHERE[params.attention as AttentionKey]];
    }
    // "Upcoming deliveries": only orders due today (India date) or later, soonest first, so a long history of
    // past deliveries can never push upcoming ones out of the 200-row page.
    const upcoming = params.sort === 'deliveryDate';
    if (upcoming) where.deliveryDate = { gte: toStoredDate(istNow(new Date()).date) };
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

  async getOne(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private assertTransition(from: OrderStatus, to: OrderStatus) {
    if (from === to) return;
    if (!STATUS_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Cannot change order status from ${from} to ${to}`);
    }
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
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { productId: true, quantity: true },
    });
    for (const it of items) {
      if (it.productId) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { increment: it.quantity } },
        });
      }
    }
    return true;
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
      // Any non-status fields from the same patch.
      const { status: _s, ...rest } = data; // eslint-disable-line @typescript-eslint/no-unused-vars
      if (Object.keys(rest).length) await tx.order.update({ where: { id }, data: rest });
    } else {
      const res = await tx.order.updateMany({ where: { id, status: from }, data });
      if (res.count !== 1) throw conflict();
    }
    return tx.order.findUnique({ where: { id }, include: this.include });
  }

  async updateStatus(id: number, status: string) {
    if (!(ALLOWED_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order not found');
    const from = existing.status as OrderStatus;
    const to = status as OrderStatus;
    if (from === to) return this.getOne(id);
    this.assertTransition(from, to);

    const updated = await this.prisma.$transaction((tx) => this.transition(tx, id, from, to, { status: to }));
    if (to === 'SHIPPED') void this.mail.sendOrderShipped(updated).catch(() => undefined);
    return updated;
  }

  /**
   * Generic admin-only update for fulfillment fields. Each field is optional so
   * admins can edit a tracking number without re-supplying everything else.
   */
  async adminUpdate(
    id: number,
    patch: {
      status?: string;
      trackingNumber?: string | null;
      courierName?: string | null;
      adminNotes?: string | null;
      shippingAddress?: string | null;
      city?: string | null;
      postalCode?: string | null;
      customerPhone?: string | null;
      paymentStatus?: 'REFUNDED';
      refundNote?: string | null;
    },
  ) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order not found');

    const data: Record<string, unknown> = {};
    const fromStatus = existing.status as OrderStatus;
    if (patch.status !== undefined) {
      if (!(ALLOWED_STATUSES as readonly string[]).includes(patch.status)) {
        throw new BadRequestException('Invalid status');
      }
      const from = existing.status as OrderStatus;
      const to = patch.status as OrderStatus;
      // Only treat it as a transition when the status actually changes, so an
      // admin can edit tracking/notes without re-validating an unchanged status.
      if (from !== to) {
        this.assertTransition(from, to);
        data.status = to;
      }
    }
    if (patch.trackingNumber !== undefined) data.trackingNumber = patch.trackingNumber || null;
    if (patch.courierName !== undefined) data.courierName = patch.courierName || null;
    if (patch.adminNotes !== undefined) data.adminNotes = patch.adminNotes || null;
    if (patch.shippingAddress !== undefined) data.shippingAddress = patch.shippingAddress || null;
    if (patch.city !== undefined) data.city = patch.city || null;
    if (patch.postalCode !== undefined) data.postalCode = patch.postalCode || null;
    if (patch.customerPhone !== undefined) data.customerPhone = patch.customerPhone || null;
    if (patch.paymentStatus !== undefined && patch.paymentStatus !== 'REFUNDED') {
      throw new BadRequestException('Invalid payment status');
    }
    const markRefunded = patch.paymentStatus === 'REFUNDED';

    // Admin text replaces only the ADMIN part of refundNote; system trace lines are always preserved
    // (and system-looking lines in the submitted text are stripped, so they cannot be forged/duplicated).
    const readNote: string | null = existing.refundNote ?? null;
    let newNote: string | null | undefined;
    if (patch.refundNote !== undefined) {
      newNote = joinRefundNote(splitRefundNote(patch.refundNote).admin, splitRefundNote(readNote).system);
    }
    const writeNote = newNote !== undefined && newNote !== readNote;

    if (markRefunded) {
      // PAID, or UNPAID with our own trace that money was captured (post-COD-switch capture / mismatch).
      const traced = readNote !== null && (readNote.includes(POST_SWITCH_MARKER) || readNote.includes(MISMATCH_MARKER));
      const eligible = existing.paymentStatus === 'PAID' || (existing.paymentStatus === 'UNPAID' && traced);
      if (!eligible) throw new ConflictException('Only a paid order can be marked refunded');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (markRefunded || writeNote) {
        // Compare-and-set on the paymentStatus and note we read: a webhook trace appended meanwhile makes
        // this match nothing, so it can never be silently overwritten. Never touches status/stock/mail.
        const cas: Record<string, unknown> = { id, refundNote: readNote };
        if (markRefunded) cas.paymentStatus = existing.paymentStatus;
        const casData: Record<string, unknown> = {};
        if (markRefunded) casData.paymentStatus = 'REFUNDED';
        if (writeNote) casData.refundNote = newNote;
        const res = await tx.order.updateMany({ where: cas, data: casData });
        if (res.count !== 1) {
          const now = await tx.order.findUnique({ where: { id } });
          if (markRefunded && now && now.paymentStatus !== existing.paymentStatus) {
            throw new ConflictException('Only a paid order can be marked refunded');
          }
          throw new ConflictException('The note was changed meanwhile - reload and try again');
        }
      }
      if (data.status !== undefined) return this.transition(tx, id, fromStatus, data.status as OrderStatus, data);
      // No status change: plain field edits stay unguarded.
      return tx.order.update({ where: { id }, data, include: this.include });
    });
    // data.status is only set when the status actually changed.
    if (data.status === 'SHIPPED') void this.mail.sendOrderShipped(updated).catch(() => undefined);
    return updated;
  }

  async stats() {
    const [orderCount, productCount, customerCount, totalAgg, recentOrders, openEnquiries, unpaidOnline, refundsDue, mismatches] = await Promise.all([
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
        select: {
          id: true,
          customerName: true,
          total: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.enquiry.count({ where: { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } } }),
      this.prisma.order.count({ where: ATTENTION_WHERE.awaiting }),
      this.prisma.order.count({ where: ATTENTION_WHERE.refund }),
      this.prisma.order.count({ where: ATTENTION_WHERE.mismatch }),
    ]);
    return {
      orderCount,
      productCount,
      customerCount,
      revenue: totalAgg._sum.total ?? 0,
      recentOrders,
      openEnquiries,
      unpaidOnline,
      refundsDue,
      mismatches,
    };
  }
}
