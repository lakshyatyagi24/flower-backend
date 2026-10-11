import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RAZORPAY_CLIENT } from '../src/payments/razorpay.client';

describe('Payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orderId: number;
  const email = 'e2e-payments@example.com';
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const fake = { createOrder: jest.fn(async () => ({ id: 'order_e2e_fake' })) };

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_e2e';
    process.env.RAZORPAY_KEY_SECRET = 'e2e-secret';
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RAZORPAY_CLIENT)
      .useValue(fake)
      .compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const order = await prisma.order.create({
      data: {
        total: 100, subtotal: 100, status: 'PENDING', paymentMethod: 'RAZORPAY',
        customerName: 'E2E', customerEmail: email, customerPhone: '9354016059',
        razorpayOrderId: 'order_e2e_stored',
      },
    });
    orderId = order.id;
  });
  afterAll(async () => {
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = saved.secret;
    await app.close();
  });

  const post = (path: string) => request(app.getHttpServer()).post(path);

  it('order: an unauthenticated caller without the matching email gets 403, never 500', async () => {
    const wrong = await post('/payments/razorpay/order').send({ orderId, email: 'someone-else@example.com' });
    expect(wrong.status).toBe(403);
    const none = await post('/payments/razorpay/order').send({ orderId });
    expect(none.status).toBe(403);
  });

  it('order: an unknown order id gets 403/404, never 500', async () => {
    const res = await post('/payments/razorpay/order').send({ orderId: 2147483000, email });
    expect([403, 404]).toContain(res.status);
  });

  it('order: invalid bodies get 400', async () => {
    for (const body of [{}, { orderId: 0 }, { orderId: 'abc' }, { orderId: 1.5 }, { orderId: 1, email: 'not-an-email' }, { orderId: 1, extra: true }]) {
      const res = await post('/payments/razorpay/order').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('order: the guest with the matching email gets the existing razorpay order (idempotent, 200)', async () => {
    const res = await post('/payments/razorpay/order').send({ orderId, email: email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      keyId: 'rzp_test_e2e', razorpayOrderId: 'order_e2e_stored', amount: 10000, currency: 'INR',
    });
    expect(fake.createOrder).not.toHaveBeenCalled();
  });

  it('verify: a bad signature gets 400 and does not mark the order paid', async () => {
    const res = await post('/payments/razorpay/verify').send({
      orderId, razorpayOrderId: 'order_e2e_stored', razorpayPaymentId: 'pay_e2e', signature: 'a'.repeat(64),
    });
    expect(res.status).toBe(400);
    const after = await prisma.order.findUnique({ where: { id: orderId } });
    expect(after?.paymentStatus).toBe('UNPAID');
  });

  it('verify: malformed bodies get 400', async () => {
    for (const body of [{}, { orderId, razorpayOrderId: 'o', razorpayPaymentId: 'p', signature: 'short' }, { orderId, razorpayOrderId: 'o', razorpayPaymentId: 'p', signature: 'A'.repeat(64) }]) {
      const res = await post('/payments/razorpay/verify').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('verify: a mismatched razorpay order id gets 400', async () => {
    const sig = createHmac('sha256', 'e2e-secret').update('order_other|pay_e2e').digest('hex');
    const res = await post('/payments/razorpay/verify').send({
      orderId, razorpayOrderId: 'order_other', razorpayPaymentId: 'pay_e2e', signature: sig,
    });
    expect(res.status).toBe(400);
  });

  it('verify: a correct signature marks the order PAID, and a replay is idempotent', async () => {
    const sig = createHmac('sha256', 'e2e-secret').update('order_e2e_stored|pay_e2e').digest('hex');
    const body = { orderId, razorpayOrderId: 'order_e2e_stored', razorpayPaymentId: 'pay_e2e', signature: sig };
    const first = await post('/payments/razorpay/verify').send(body);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, status: 'PAID' });
    const again = await post('/payments/razorpay/verify').send(body);
    expect(again.status).toBe(200);
    const row = await prisma.order.findUnique({ where: { id: orderId } });
    expect(row).toMatchObject({ paymentStatus: 'PAID', status: 'PAID', razorpayPaymentId: 'pay_e2e' });
    expect(row?.paidAt).toBeTruthy();
  });

  it('track: the public tracker never exposes payment references or refund notes', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { refundNote: 'internal', adminNotes: 'internal' } });
    const res = await request(app.getHttpServer()).get(`/orders/track/${orderId}`).query({ email });
    expect(res.status).toBe(200);
    for (const k of ['razorpayOrderId', 'razorpayPaymentId', 'refundNote', 'adminNotes']) {
      expect(res.body).not.toHaveProperty(k);
    }
    expect(res.body.paymentStatus).toBe('PAID');
  });
});
