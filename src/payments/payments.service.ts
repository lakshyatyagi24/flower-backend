import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RAZORPAY_CLIENT, RazorpayClient } from './razorpay.client';

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

    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) throw new ServiceUnavailableException('Online payments are not configured');

    // Razorpay wants integer paise; Math.round absorbs float error (e.g. 19.99 * 3).
    const amount = Math.round(order.total * 100);
    let rzpOrderId: string | null = order.razorpayOrderId;
    if (!rzpOrderId) {
      const created = await this.rzp.createOrder(amount, `order_${order.id}`);
      // Guarded write: if a concurrent request stored an id first, use theirs
      // (our extra Razorpay order is simply never paid).
      const stored = await this.prisma.order.updateMany({
        where: { id: order.id, razorpayOrderId: null },
        data: { razorpayOrderId: created.id, paymentMethod: 'RAZORPAY' },
      });
      if (stored.count === 1) {
        rzpOrderId = created.id;
      } else {
        const latest = await this.prisma.order.findUnique({ where: { id: order.id } });
        rzpOrderId = latest?.razorpayOrderId ?? created.id;
      }
    } else if (order.paymentMethod !== 'RAZORPAY') {
      await this.prisma.order.update({ where: { id: order.id }, data: { paymentMethod: 'RAZORPAY' } });
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

  private signatureOk(payload: string, signature: string, secret: string): boolean {
    const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /**
   * Idempotent and race-safe. The guarded updateMany lets exactly one caller flip
   * UNPAID/FAILED -> PAID; only that caller sends mail.
   */
  async markPaid(orderId: number, razorpayPaymentId: string): Promise<MarkPaidResult> {
    const flipped = await this.prisma.order.updateMany({
      where: { id: orderId, paymentStatus: { in: ['UNPAID', 'FAILED'] } },
      data: { paymentStatus: 'PAID', razorpayPaymentId, paidAt: new Date() },
    });
    if (flipped.count !== 1) return 'ALREADY_PAID';

    // Only a still-PENDING order advances to PAID; SHIPPED/COMPLETED stay put and
    // CANCELLED stays CANCELLED (guarded, so a concurrent cancel is not overwritten).
    await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'PAID' },
    });

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

  async verify(input: { orderId: number; razorpayOrderId: string; razorpayPaymentId: string; signature: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order || !order.razorpayOrderId || order.razorpayOrderId !== input.razorpayOrderId) {
      throw new BadRequestException('Order mismatch');
    }
    const secret = process.env.RAZORPAY_KEY_SECRET ?? '';
    // Never HMAC with an empty secret: anyone could forge that signature.
    if (!secret) throw new ServiceUnavailableException('Online payments are not configured');
    if (!this.signatureOk(`${input.razorpayOrderId}|${input.razorpayPaymentId}`, input.signature, secret)) {
      throw new BadRequestException('Payment signature invalid');
    }
    await this.markPaid(input.orderId, input.razorpayPaymentId);
    return { ok: true as const, status: 'PAID' as const };
  }
}
