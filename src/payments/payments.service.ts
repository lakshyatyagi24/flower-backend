import {
  BadRequestException,
  ForbiddenException,
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RAZORPAY_CLIENT, RazorpayClient } from './razorpay.client';

/** Env value, trimmed; whitespace-only counts as unset. */
const envTrim = (name: string): string => (process.env[name] ?? '').trim();

interface WebhookPayment {
  id?: unknown;
  order_id?: unknown;
  amount?: unknown;
}

export type MarkPaidResult = 'PAID' | 'ALREADY_PAID' | 'PAID_AFTER_CANCEL';

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RAZORPAY_CLIENT) private readonly rzp: RazorpayClient,
    private readonly mail: MailService,
  ) {}

  private readonly include = { items: true } as const;

  async createRazorpayOrder(orderId: number, userId: number | null, email: string | null) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: this.include });
    // Unknown and not-yours look identical so sequential ids can't be enumerated.
    const guestEmail = email?.trim().toLowerCase();
    const owns = order
      ? userId
        ? order.userId === userId
        : !!guestEmail && !!order.customerEmail && order.customerEmail.trim().toLowerCase() === guestEmail
      : false;
    if (!order || !owns) throw new ForbiddenException('Not your order');

    if (order.paymentStatus !== 'UNPAID' && order.paymentStatus !== 'FAILED') {
      throw new BadRequestException(
        order.paymentStatus === 'PAID' ? 'Order is already paid' : 'Order cannot be paid online',
      );
    }
    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        order.status === 'CANCELLED' ? 'Order was cancelled' : 'Order cannot be paid online',
      );
    }

    // This order was created as an online order; COD<->online switching happens only via the
    // dedicated endpoint, never as a side effect of opening the payment flow.
    if (order.paymentMethod !== 'RAZORPAY') throw new BadRequestException('This order is cash on delivery');

    const keyId = envTrim('RAZORPAY_KEY_ID');
    if (!keyId || !envTrim('RAZORPAY_KEY_SECRET')) {
      throw new ServiceUnavailableException('Online payments are not configured');
    }

    // Razorpay wants integer paise; Math.round absorbs float error (e.g. 19.99 * 3).
    const amount = Math.round(order.total * 100);
    let rzpOrderId: string | null = order.razorpayOrderId;
    if (!rzpOrderId) {
      let created: { id: string };
      try {
        created = await this.rzp.createOrder(amount, `order_${order.id}`);
      } catch (err) {
        // err.message only: provider error objects can carry request/response details.
        this.log.error(`razorpay createOrder failed for order ${order.id}: ${err instanceof Error ? err.message : 'unknown error'}`);
        throw new BadGatewayException('Payment provider unavailable, please retry');
      }
      // Guarded write: if a concurrent request stored an id first, use theirs
      // (our extra Razorpay order is simply never paid).
      const stored = await this.prisma.order.updateMany({
        where: { id: order.id, razorpayOrderId: null },
        data: { razorpayOrderId: created.id },
      });
      if (stored.count === 1) {
        rzpOrderId = created.id;
      } else {
        const latest = await this.prisma.order.findUnique({ where: { id: order.id } });
        rzpOrderId = latest?.razorpayOrderId ?? created.id;
      }
    }

    return {
      keyId,
      razorpayOrderId: rzpOrderId as string,
      amount,
      currency: 'INR' as const,
      name: 'Fresh Petals',
      prefill: {
        name: order.customerName ?? '',
        email: order.customerEmail ?? '',
        contact: order.customerPhone ?? '',
      },
    };
  }

  private signatureOk(payload: string | Buffer, signature: string, secret: string): boolean {
    const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /**
   * Idempotent and race-safe. The guarded updateMany lets exactly one caller flip
   * UNPAID/FAILED -> PAID; only that caller sends mail.
   */
  async markPaid(orderId: number, razorpayPaymentId: string): Promise<MarkPaidResult> {
    // Both guarded writes commit together: a crash between them can no longer leave an
    // order paymentStatus=PAID but status=PENDING (a retry would see ALREADY_PAID and never fix it).
    const won = await this.prisma.$transaction(async (tx: any) => {
      const flipped = await tx.order.updateMany({
        // paymentMethod guard: a COD order (e.g. switched after an abandoned online attempt) must never
        // be flipped to PAID by a stray payment id.
        where: { id: orderId, paymentMethod: 'RAZORPAY', paymentStatus: { in: ['UNPAID', 'FAILED'] } },
        data: { paymentStatus: 'PAID', razorpayPaymentId, paidAt: new Date() },
      });
      if (flipped.count !== 1) return false;
      // Only a still-PENDING order advances to PAID; SHIPPED/COMPLETED stay put and
      // CANCELLED stays CANCELLED (guarded, so a concurrent cancel is not overwritten).
      await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'PAID' },
      });
      return true;
    });
    if (!won) return 'ALREADY_PAID';

    // Read + mail only after the commit.

    const fresh = await this.prisma.order.findUnique({ where: { id: orderId }, include: this.include });
    if (!fresh) return 'PAID';
    if (fresh.status === 'CANCELLED') {
      // Stock was already restocked on cancel; do not restock again or announce
      // a normal paid order. The owner must refund manually.
      this.log.warn(`order ${orderId} captured after cancellation (payment ${razorpayPaymentId}); refund manually`);
      return 'PAID_AFTER_CANCEL';
    }
    void this.mail.sendOrderPaid(fresh).catch(() => undefined);
    return 'PAID';
  }

  /**
   * Razorpay webhook. Signature is checked over the RAW body bytes before anything is parsed.
   * Any validly signed delivery gets a 2xx (so Razorpay does not retry forever); only a bad
   * signature or missing config is a 400. Never log the body, signature or secrets.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ ok: true }> {
    // Never HMAC with an empty secret: anyone could forge that signature.
    const secret = envTrim('RAZORPAY_WEBHOOK_SECRET');
    if (!secret || !signature || !rawBody || !this.signatureOk(rawBody, signature, secret)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    let evt: any;
    try {
      evt = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.log.warn('webhook ignored: signed body is not valid JSON');
      return { ok: true };
    }
    const event = typeof evt?.event === 'string' ? evt.event : '';
    if (event !== 'payment.captured' && event !== 'order.paid' && event !== 'payment.failed') {
      this.log.log(`webhook ignored: unhandled event type ${event.slice(0, 64) || '(none)'}`);
      return { ok: true };
    }
    const payment: WebhookPayment | undefined = evt?.payload?.payment?.entity;
    const rzpOrderId = payment?.order_id;
    if (!payment || typeof rzpOrderId !== 'string' || !rzpOrderId) {
      this.log.warn(`webhook ${event} ignored: no payment/order reference in payload`);
      return { ok: true };
    }

    const order = await this.prisma.order.findUnique({ where: { razorpayOrderId: rzpOrderId } });
    if (!order) {
      this.log.warn(`webhook ${event} for unknown razorpay order ${rzpOrderId.slice(0, 64)}`);
      return { ok: true };
    }

    if (event === 'payment.failed') {
      // Guarded: a failed attempt must never downgrade an already-paid order.
      await this.prisma.order.updateMany({
        where: { id: order.id, paymentStatus: 'UNPAID' },
        data: { paymentStatus: 'FAILED' },
      });
      return { ok: true };
    }

    // payment.captured / order.paid
    const paymentId = payment.id;
    if (typeof paymentId !== 'string' || !paymentId) {
      this.log.warn(`webhook ${event} for order ${order.id} has no payment id; not marking paid`);
      return { ok: true };
    }
    const expectedPaise = Math.round(order.total * 100);
    if (payment.amount !== expectedPaise) {
      this.log.warn(
        `webhook ${event} amount mismatch for order ${order.id}: got ${String(payment.amount)} paise, expected ${expectedPaise}; NOT marked paid, review manually`,
      );
      // Persist a trace WITHOUT touching status/paymentStatus. Setting razorpayPaymentId also makes
      // the stale-order job skip this order (it requires null), and refundNote surfaces it to the admin.
      try {
        await this.prisma.order.updateMany({
          where: { id: order.id, razorpayPaymentId: null },
          data: {
            razorpayPaymentId: paymentId,
            refundNote: `AMOUNT MISMATCH: payment ${paymentId} captured ${String(payment.amount)} vs expected ${expectedPaise} - review/refund manually`,
          },
        });
      } catch (err) {
        // e.g. unique violation on razorpayPaymentId; never fail the 200 to Razorpay.
        this.log.warn(
          `could not persist amount-mismatch trace for order ${order.id}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
      return { ok: true };
    }
    const result = await this.markPaid(order.id, paymentId);
    this.log.log(`webhook ${event} order=${order.id} result=${result}`);
    return { ok: true };
  }

  async verify(input: { orderId: number; razorpayOrderId: string; razorpayPaymentId: string; signature: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order || !order.razorpayOrderId || order.razorpayOrderId !== input.razorpayOrderId) {
      throw new BadRequestException('Order mismatch');
    }
    const secret = envTrim('RAZORPAY_KEY_SECRET');
    // Never HMAC with an empty secret: anyone could forge that signature.
    if (!secret) throw new ServiceUnavailableException('Online payments are not configured');
    if (!this.signatureOk(`${input.razorpayOrderId}|${input.razorpayPaymentId}`, input.signature, secret)) {
      throw new BadRequestException('Payment signature invalid');
    }
    const result = await this.markPaid(input.orderId, input.razorpayPaymentId);
    // Paid after the order was cancelled: tell the storefront so it can say a refund will follow.
    const status: 'PAID' | 'CANCELLED' = result === 'PAID_AFTER_CANCEL' ? 'CANCELLED' : 'PAID';
    return { ok: true as const, status };
  }
}
