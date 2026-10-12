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

describe('Switch to COD (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const orderIds: number[] = [];
  const SECRET = 'whsec_e2e_pm';
  const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
  const email = 'e2e-pm@example.com';
  const tag = `pm${Date.now()}`;
  const mail = { sendOrderPlaced: jest.fn(async () => undefined), sendOrderPaid: jest.fn(async () => undefined) };

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RAZORPAY_CLIENT).useValue({ createOrder: async () => ({ id: 'order_never' }) })
      .overrideProvider(MailService).useValue(mail)
      .compile();
    app = m.createNestApplication<NestExpressApplication>({ rawBody: true });
    applyBodyParsers(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (saved === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = saved;
    await app.close();
  });
  beforeEach(() => mail.sendOrderPlaced.mockClear());

  const put = (id: number | string, body: object) => request(app.getHttpServer()).put(`/orders/${id}/payment-method`).send(body);
  async function makeOrder() {
    const o = await prisma.order.create({
      data: {
        total: 100, subtotal: 100, status: 'PENDING', paymentMethod: 'RAZORPAY', razorpayOrderId: `order_${tag}_${orderIds.length}`,
        customerName: 'PM', customerEmail: email, customerPhone: '9354016059',
      },
    });
    orderIds.push(o.id);
    return o;
  }

  it('guest + email switches to COD, nulls the razorpay order id, and a late capture on the old id does not pay it', async () => {
    const o = await makeOrder();
    const res = await put(o.id, { paymentMethod: 'COD', email: email.toUpperCase() }).expect(200);
    expect(res.body).toMatchObject({ id: o.id, paymentMethod: 'COD' });
    expect(res.body).not.toHaveProperty('refundNote');
    const row = await prisma.order.findUnique({ where: { id: o.id } });
    expect(row).toMatchObject({ paymentMethod: 'COD', razorpayOrderId: null, paymentStatus: 'UNPAID', status: 'PENDING' });
    expect(mail.sendOrderPlaced).toHaveBeenCalledTimes(1);

    await put(o.id, { paymentMethod: 'COD', email }).expect(200);
    expect(mail.sendOrderPlaced).toHaveBeenCalledTimes(1);

    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${tag}`, order_id: `order_${tag}_0`, amount: 10000 } } } });
    await request(app.getHttpServer()).post('/payments/razorpay/webhook').set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', createHmac('sha256', SECRET).update(raw).digest('hex')).send(raw).expect(200);
    const after = await prisma.order.findUnique({ where: { id: o.id } });
    expect(after).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'PENDING', razorpayPaymentId: null });
    expect(mail.sendOrderPaid).not.toHaveBeenCalled();
  });

  it('rejects a non-COD body with 400, a bad id with 400, and wrong email / unknown order with 403', async () => {
    const o = await makeOrder();
    await put(o.id, { paymentMethod: 'RAZORPAY', email }).expect(400);
    await put('abc', { paymentMethod: 'COD', email }).expect(400);
    await put(o.id, { paymentMethod: 'COD', email: 'other@example.com' }).expect(403);
    await put(o.id, { paymentMethod: 'COD' }).expect(403);
    await put(2147483000, { paymentMethod: 'COD', email }).expect(403);
    expect((await prisma.order.findUnique({ where: { id: o.id } }))!.paymentMethod).toBe('RAZORPAY');
  });

  it('a paid order gets 409 and stays RAZORPAY/PAID', async () => {
    const o = await makeOrder();
    await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: 'PAID', status: 'PAID', razorpayPaymentId: `pay_paid_${tag}` } });
    await put(o.id, { paymentMethod: 'COD', email }).expect(409);
    expect(await prisma.order.findUnique({ where: { id: o.id } })).toMatchObject({ paymentMethod: 'RAZORPAY', paymentStatus: 'PAID' });
  });
});
