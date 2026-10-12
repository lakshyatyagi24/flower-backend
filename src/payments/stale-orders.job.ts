import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

/** Unpaid online orders older than this are released (stock returned). */
export const STALE_ORDER_TTL_MS = 30 * 60 * 1000;

/**
 * Auto-cancels online (RAZORPAY) orders that were never paid. COD orders, paid orders and
 * orders carrying any payment id (including amount-mismatch traces) are never touched.
 */
@Injectable()
export class StaleOrdersJob {
  static readonly TTL_MS = STALE_ORDER_TTL_MS;
  private readonly log = new Logger(StaleOrdersJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    try {
      const n = await this.run();
      if (n > 0) this.log.log(`auto-cancelled ${n} stale unpaid orders`);
    } catch (err) {
      this.log.error(`stale order sweep failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  async run(now: Date = new Date()): Promise<number> {
    const stale: Array<{ id: number }> = await this.prisma.order.findMany({
      where: {
        paymentMethod: 'RAZORPAY',
        paymentStatus: { in: ['UNPAID', 'FAILED'] },
        status: 'PENDING',
        razorpayPaymentId: null,
        createdAt: { lt: new Date(now.getTime() - StaleOrdersJob.TTL_MS) },
      },
      select: { id: true },
    });

    let cancelled = 0;
    for (const { id } of stale) {
      try {
        // Re-assert the selection criteria at write time: if the payment was confirmed
        // (markPaid/verify/webhook) after the SELECT, the guarded write matches nothing.
        const done: boolean = await this.prisma.$transaction((tx: any) =>
          this.orders.cancelAndRestock(tx, id, {
            status: 'PENDING',
            paymentMethod: 'RAZORPAY',
            paymentStatus: { in: ['UNPAID', 'FAILED'] },
            razorpayPaymentId: null,
          }),
        );
        if (done) cancelled++;
      } catch (err) {
        this.log.error(`failed to auto-cancel order ${id}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
    return cancelled;
  }
}
