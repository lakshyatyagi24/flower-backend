import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { createHmac } from 'crypto';
import { PaymentsService } from '../src/payments/payments.service';
import { ConflictException } from '@nestjs/common';
import { OrdersService } from '../src/orders/orders.service';
import { StaleOrdersJob } from '../src/payments/stale-orders.job';
import type { INestApplication } from '@nestjs/common';

describe('StaleOrdersJob (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let job: StaleOrdersJob;
  let productId: number;
  const orderIds: number[] = [];
  const tag = `stale${Date.now()}`;
  const OLD = new Date(Date.now() - 60 * 60 * 1000);

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({})
      .compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    job = app.get(StaleOrdersJob);
    // stock 10 with 4 units "claimed" by the 4 orders below (2 each is applied per-test via makeOrder).
    productId = (await prisma.product.create({ data: { name: `Stale ${tag}`, slug: `stale-${tag}`, price: 100, stock: 10 } })).id;
  });

  afterAll(async () => {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productId) await prisma.product.deleteMany({ where: { id: productId } });
    await app.close();
  });

  const stock = async () => (await prisma.product.findUnique({ where: { id: productId } }))!.stock;
  const row = (id: number) => prisma.order.findUnique({ where: { id } });

  async function makeOrder(over: Record<string, unknown> = {}) {
    const order = await prisma.order.create({
      data: {
        total: 500, subtotal: 500, status: 'PENDING', paymentMethod: 'RAZORPAY', paymentStatus: 'UNPAID',
        createdAt: OLD, customerName: 'S', customerEmail: 'stale@example.com', customerPhone: '9354016059',
        items: {
          create: [
            { productId, productName: 'Stale A', quantity: 2, unitPrice: 100 },
            { productId, productName: 'Stale B', quantity: 3, unitPrice: 100 },
          ],
        },
        ...over,
      },
    });
    orderIds.push(order.id);
    return order.id;
  }

  /** Simulate the stock the order claimed at creation (5 units) so restock is observable. */
  const claim = (n = 5) => prisma.product.update({ where: { id: productId }, data: { stock: { decrement: n } } });

  it('cancels a stale unpaid RAZORPAY order (UNPAID and FAILED) and returns stock', async () => {
    const a = await makeOrder();
    const b = await makeOrder({ paymentStatus: 'FAILED' });
    await claim(); await claim();
    expect(await stock()).toBe(0);
    const n = await job.run();
    expect(n).toBeGreaterThanOrEqual(2);
    expect((await row(a))!.status).toBe('CANCELLED');
    expect((await row(b))!.status).toBe('CANCELLED');
    expect(await stock()).toBe(10);
    // Idempotent: a second sweep restocks nothing more.
    await job.run();
    expect(await stock()).toBe(10);
  });

  it('leaves a fresh (within TTL) order, a COD order, a PAID order and an order with a payment id untouched', async () => {
    const fresh = await makeOrder({ createdAt: new Date() });
    const cod = await makeOrder({ paymentMethod: 'COD' });
    const paid = await makeOrder({ paymentStatus: 'PAID', status: 'PAID', paidAt: new Date() });
    const withPay = await makeOrder({ razorpayPaymentId: `pay_${tag}` });
    for (let i = 0; i < 4; i++) await claim();
    await job.run();
    expect((await row(fresh))!.status).toBe('PENDING');
    expect((await row(cod))!.status).toBe('PENDING');
    expect(await row(paid)).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
    expect((await row(withPay))!.status).toBe('PENDING');
    expect(await stock()).toBe(10 - 20);
    await prisma.product.update({ where: { id: productId }, data: { stock: 10 } });
  });

  it('an order paid after being selected is not cancelled (guarded write)', async () => {
    const id = await makeOrder();
    await claim();
    // Pay it, then sweep: the SELECT would have matched a moment earlier, the guarded write must not.
    await prisma.order.update({ where: { id }, data: { paymentStatus: 'PAID', status: 'PAID' } });
    const n = await job.run();
    expect(n).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
    await prisma.product.update({ where: { id: productId }, data: { stock: 10 } });
  });

  it('a webhook amount-mismatch trace makes the (otherwise stale) order skipped by the job', async () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_stale_e2e';
    try {
      const rzp = `order_${tag}_mm`;
      const id = await makeOrder({ razorpayOrderId: rzp });
      await claim();
      const raw = Buffer.from(
        JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_mm_${tag}`, order_id: rzp, amount: 123 } } } }),
      );
      const sig = createHmac('sha256', 'whsec_stale_e2e').update(raw).digest('hex');
      await expect(app.get(PaymentsService).handleWebhook(raw, sig)).resolves.toEqual({ ok: true });
      const traced = await row(id);
      expect(traced).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID', razorpayPaymentId: `pay_mm_${tag}` });
      expect(traced!.refundNote).toContain('AMOUNT MISMATCH');

      expect(await job.run()).toBe(0);
      expect((await row(id))!.status).toBe('PENDING');
      expect(await stock()).toBe(5);
    } finally {
      if (saved === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = saved;
      await prisma.product.update({ where: { id: productId }, data: { stock: 10 } });
    }
  });

  it('an admin status write based on a stale PENDING read cannot revive a job-cancelled order (real DB)', async () => {
    const id = await makeOrder();
    await prisma.product.update({ where: { id: productId }, data: { stock: 5 } }); // 5 units claimed by this order
    expect(await job.run()).toBeGreaterThanOrEqual(1);
    expect((await row(id))!.status).toBe('CANCELLED');
    expect(await stock()).toBe(10);

    const orders = app.get(OrdersService);
    for (const to of ['SHIPPED', 'PAID']) {
      // Interleaving: the admin's read (outside the tx) happened before the job's commit.
      const spy = jest.spyOn(prisma.order, 'findUnique').mockResolvedValueOnce({ id, status: 'PENDING' } as any);
      await expect(orders.updateStatus(id, to)).rejects.toBeInstanceOf(ConflictException);
      spy.mockRestore();
    }
    const spy2 = jest.spyOn(prisma.order, 'findUnique').mockResolvedValueOnce({ id, status: 'PENDING' } as any);
    await expect(orders.adminUpdate(id, { status: 'SHIPPED' })).rejects.toBeInstanceOf(ConflictException);
    spy2.mockRestore();

    expect((await row(id))!.status).toBe('CANCELLED');
    expect(await stock()).toBe(10); // restocked exactly once
    await prisma.product.update({ where: { id: productId }, data: { stock: 10 } });
  });
});
