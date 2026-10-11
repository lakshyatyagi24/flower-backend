import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { applyBodyParsers } from '../src/common/body-parsers';
import request from 'supertest';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { RAZORPAY_CLIENT } from '../src/payments/razorpay.client';

describe('Razorpay webhook (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let productId: number;
  const orderIds: number[] = [];
  const SECRET = 'whsec_e2e_test';
  const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
  const tag = `wh${Date.now()}`;
  const mail = { sendOrderPaid: jest.fn(async () => undefined) };

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RAZORPAY_CLIENT)
      .useValue({ createOrder: async () => ({ id: 'order_never' }) })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    // Same parser setup as main.ts (shared helper), so this test guards the real raw-body wiring.
    app = m.createNestApplication<NestExpressApplication>({ rawBody: true });
    applyBodyParsers(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const product = await prisma.product.create({
      data: { name: `Webhook test ${tag}`, slug: `webhook-test-${tag}`, price: 100, stock: 5 },
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productId) await prisma.product.deleteMany({ where: { id: productId } });
    if (saved === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = saved;
    await app.close();
  });

  beforeEach(() => mail.sendOrderPaid.mockClear());

  let seq = 0;
  async function makeOrder(over: Record<string, unknown> = {}) {
    const rzp = `order_${tag}_${++seq}`;
    const order = await prisma.order.create({
      data: {
        total: 100, subtotal: 100, status: 'PENDING', paymentMethod: 'RAZORPAY', razorpayOrderId: rzp,
        customerName: 'WH', customerEmail: 'wh@example.com', customerPhone: '9354016059',
        items: { create: [{ productId, productName: 'Webhook test', quantity: 1, unitPrice: 100 }] },
        ...over,
      },
    });
    orderIds.push(order.id);
    return { id: order.id, rzp };
  }

  const bodyOf = (event: string, rzpOrderId: string, payId: string, amount = 10000) =>
    JSON.stringify({ event, payload: { payment: { entity: { id: payId, order_id: rzpOrderId, amount, currency: 'INR' } } } });
  const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');
  const deliver = (raw: string, sig?: string) => {
    const r = request(app.getHttpServer()).post('/payments/razorpay/webhook').set('Content-Type', 'application/json');
    if (sig !== undefined) r.set('X-Razorpay-Signature', sig);
    return r.send(raw);
  };
  const row = (id: number) => prisma.order.findUnique({ where: { id } });

  it('rejects a bad signature with 400 and changes nothing', async () => {
    const o = await makeOrder();
    const raw = bodyOf('payment.captured', o.rzp, 'pay_bad');
    await deliver(raw, 'bad').expect(400);
    await deliver(raw, sign(raw, 'wrong-secret')).expect(400);
    expect((await row(o.id))!.paymentStatus).toBe('UNPAID');
  });

  it('rejects a missing signature header with 400', async () => {
    const o = await makeOrder();
    await deliver(bodyOf('payment.captured', o.rzp, 'pay_nohdr')).expect(400);
    expect((await row(o.id))!.paymentStatus).toBe('UNPAID');
  });

  it('rejects everything with 400 when RAZORPAY_WEBHOOK_SECRET is empty, even a signature forged with an empty secret', async () => {
    const o = await makeOrder();
    const raw = bodyOf('payment.captured', o.rzp, 'pay_nosecret');
    try {
      for (const v of ['', '   ']) {
        process.env.RAZORPAY_WEBHOOK_SECRET = v;
        await deliver(raw, sign(raw, v)).expect(400);
        await deliver(raw, sign(raw, SECRET)).expect(400);
      }
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    }
    expect((await row(o.id))!.paymentStatus).toBe('UNPAID');
  });

  it('a valid payment.captured marks the order PAID exactly once across two duplicate deliveries', async () => {
    const o = await makeOrder();
    // Non-canonical whitespace proves the signature is checked against the raw bytes.
    const raw = `{ "event": "payment.captured",\n  "payload": { "payment": { "entity": { "id": "pay_dup", "order_id": "${o.rzp}", "amount": 10000 } } } }`;
    const sig = sign(raw);
    const a = await deliver(raw, sig).expect(200);
    const b = await deliver(raw, sig).expect(200);
    expect(a.body).toEqual({ ok: true });
    expect(b.body).toEqual({ ok: true });
    const after = await row(o.id);
    expect(after).toMatchObject({ paymentStatus: 'PAID', status: 'PAID', razorpayPaymentId: 'pay_dup' });
    expect(after!.paidAt).toBeTruthy();
    expect(mail.sendOrderPaid).toHaveBeenCalledTimes(1);
    expect((mail.sendOrderPaid.mock.calls[0] as any)[0].id).toBe(o.id);
  });

  it('payment.failed sets FAILED while UNPAID, and a later capture still pays it', async () => {
    const o = await makeOrder();
    const fail = bodyOf('payment.failed', o.rzp, 'pay_f1');
    await deliver(fail, sign(fail)).expect(200);
    expect((await row(o.id))!.paymentStatus).toBe('FAILED');
    const cap = bodyOf('payment.captured', o.rzp, 'pay_f2');
    await deliver(cap, sign(cap)).expect(200);
    expect(await row(o.id)).toMatchObject({ paymentStatus: 'PAID', status: 'PAID', razorpayPaymentId: 'pay_f2' });
  });

  it('payment.failed never downgrades a PAID order', async () => {
    const o = await makeOrder();
    const cap = bodyOf('payment.captured', o.rzp, 'pay_keep');
    await deliver(cap, sign(cap)).expect(200);
    const fail = bodyOf('payment.failed', o.rzp, 'pay_late_fail');
    await deliver(fail, sign(fail)).expect(200);
    expect(await row(o.id)).toMatchObject({ paymentStatus: 'PAID', status: 'PAID', razorpayPaymentId: 'pay_keep' });
  });

  it('a captured event for an unknown razorpay order is a 200 no-op', async () => {
    const raw = bodyOf('payment.captured', `order_unknown_${tag}`, 'pay_unknown');
    const res = await deliver(raw, sign(raw)).expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(mail.sendOrderPaid).not.toHaveBeenCalled();
  });

  it('an unsupported event type and malformed JSON (validly signed) are 200 no-ops', async () => {
    const o = await makeOrder();
    const other = bodyOf('refund.created', o.rzp, 'pay_x');
    await deliver(other, sign(other)).expect(200);
    const junk = '{not json';
    await deliver(junk, sign(junk)).expect(200);
    expect((await row(o.id))!.paymentStatus).toBe('UNPAID');
  });

  it('an amount mismatch is NOT marked paid (200, flagged for manual review)', async () => {
    const o = await makeOrder();
    const raw = bodyOf('payment.captured', o.rzp, 'pay_short', 5000);
    await deliver(raw, sign(raw)).expect(200);
    expect(await row(o.id)).toMatchObject({ paymentStatus: 'UNPAID', status: 'PENDING', razorpayPaymentId: null });
    expect(mail.sendOrderPaid).not.toHaveBeenCalled();
  });
});
