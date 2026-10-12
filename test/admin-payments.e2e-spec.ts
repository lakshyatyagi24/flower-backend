import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHmac } from 'crypto';
import { applyBodyParsers } from '../src/common/body-parsers';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { RAZORPAY_CLIENT } from '../src/payments/razorpay.client';
import { signJwt } from '../src/auth/jwt.util';

describe('Admin payment visibility + capture after COD switch (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const orderIds: number[] = [];
  const SECRET = 'whsec_e2e_adminpay';
  const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
  const email = 'e2e-adminpay@example.com';
  const tag = `ap${Date.now()}`;
  const mail = {
    sendOrderPlaced: jest.fn(async () => undefined),
    sendOrderPaid: jest.fn(async () => undefined),
    sendOrderShipped: jest.fn(async () => undefined),
  };
  const adminToken = () => signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' });
  const customerToken = () => signJwt({ sub: 999998, email: 'c@example.com', role: 'CUSTOMER' });

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
  beforeEach(() => Object.values(mail).forEach((f) => f.mockClear()));

  async function makeOrder(data: Record<string, unknown> = {}) {
    const o = await prisma.order.create({
      data: {
        total: 100, subtotal: 100, status: 'PENDING', paymentMethod: 'RAZORPAY',
        razorpayOrderId: `order_${tag}_${orderIds.length}`,
        customerName: 'AP', customerEmail: email, customerPhone: '9354016059', ...data,
      } as any,
    });
    orderIds.push(o.id);
    return o;
  }
  const webhook = (rzpOrderId: string, payId: string, event = 'payment.captured') => {
    const raw = JSON.stringify({ event, payload: { payment: { entity: { id: payId, order_id: rzpOrderId, amount: 10000 } } } });
    return request(app.getHttpServer()).post('/payments/razorpay/webhook').set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', createHmac('sha256', SECRET).update(raw).digest('hex')).send(raw);
  };
  const adminPut = (id: number, body: object) =>
    request(app.getHttpServer()).put(`/orders/${id}`).set('Authorization', `Bearer ${adminToken()}`).send(body);
  const adminGet = (url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${adminToken()}`);

  it('payment captured on the OLD razorpay order after a COD switch is traced once; nothing else changes', async () => {
    const o = await makeOrder();
    const oldId = o.razorpayOrderId as string;
    const sw = await request(app.getHttpServer()).put(`/orders/${o.id}/payment-method`).send({ paymentMethod: 'COD', email }).expect(200);
    expect(sw.body).not.toHaveProperty('refundNote');
    expect(sw.body.razorpayOrderId ?? null).toBeNull();
    expect((await prisma.order.findUnique({ where: { id: o.id } }))!.refundNote)
      .toBe(`Switched to COD; abandoned Razorpay order ${oldId}`);

    await webhook(oldId, `pay_${tag}_late`).expect(200);
    await webhook(oldId, `pay_${tag}_late`).expect(200);
    const row = await prisma.order.findUnique({ where: { id: o.id } });
    expect(row).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID', paymentMethod: 'COD', razorpayPaymentId: null });
    const note = row!.refundNote as string;
    expect(note).toContain(`PAYMENT pay_${tag}_late CAPTURED AFTER SWITCH TO COD`);
    expect(note.split(`pay_${tag}_late`)).toHaveLength(2); // exactly one occurrence
    expect(mail.sendOrderPaid).not.toHaveBeenCalled();
  });

  it('a switched+captured order is flagged in attention=mismatch and stats.mismatches; admin cannot erase the trace; REFUNDED clears it', async () => {
    // Other e2e suites share this DB and run in parallel, so a global before/after delta is racy.
    // Instead read the card count and the list total back-to-back (retrying if another suite moved
    // the data between the two reads); they must be equal because they share one criterion.
    const snapshot = async () => {
      for (let i = 0; i < 8; i++) {
        const list = (await adminGet('/orders?attention=mismatch&take=200').expect(200)).body;
        const stats = (await adminGet('/orders/stats').expect(200)).body;
        const again = (await adminGet('/orders?attention=mismatch&take=200').expect(200)).body;
        if (list.total === again.total && stats.mismatches === list.total) return { ids: list.items.map((x: any) => x.id) as number[], n: list.total as number };
      }
      throw new Error('mismatch count and list never agreed');
    };
    const o = await makeOrder();
    const oldId = o.razorpayOrderId as string;
    await request(app.getHttpServer()).put(`/orders/${o.id}/payment-method`).send({ paymentMethod: 'COD', email }).expect(200);
    expect((await snapshot()).ids).not.toContain(o.id); // marker only: nothing captured yet

    await webhook(oldId, `pay_${tag}_flag`).expect(200);
    expect((await snapshot()).ids).toContain(o.id);

    const traced = (await prisma.order.findUnique({ where: { id: o.id } }))!.refundNote as string;
    expect(traced).toContain(`PAYMENT pay_${tag}_flag CAPTURED AFTER SWITCH TO COD`);
    // clearing / editing the note only touches the admin part
    await adminPut(o.id, { refundNote: '' }).expect(200);
    expect((await prisma.order.findUnique({ where: { id: o.id } }))!.refundNote).toBe(traced);
    await adminPut(o.id, { refundNote: 'will refund via UPI' }).expect(200);
    expect((await prisma.order.findUnique({ where: { id: o.id } }))!.refundNote).toBe(`will refund via UPI\n${traced}`);

    // money was captured per our trace, so the owner may mark it refunded even though it is UNPAID
    const res = await adminPut(o.id, { paymentStatus: 'REFUNDED' }).expect(200);
    expect(res.body).toMatchObject({ paymentStatus: 'REFUNDED', status: 'PENDING' });
    expect((await snapshot()).ids).not.toContain(o.id);
    expect(mail.sendOrderShipped).not.toHaveBeenCalled();
  });

  it('admin marks a PAID order REFUNDED (200) and an UNPAID one is a 409', async () => {
    const paid = await makeOrder({ paymentStatus: 'PAID', status: 'CANCELLED', razorpayPaymentId: `pay_${tag}_r` });
    const res = await adminPut(paid.id, { paymentStatus: 'REFUNDED', refundNote: '  refunded via UPI  ' }).expect(200);
    expect(res.body).toMatchObject({ paymentStatus: 'REFUNDED', status: 'CANCELLED', refundNote: 'refunded via UPI' });
    await adminPut(paid.id, { paymentStatus: 'REFUNDED' }).expect(409);
    await adminPut(paid.id, { refundNote: '' }).expect(200);
    expect((await prisma.order.findUnique({ where: { id: paid.id } }))!.refundNote).toBeNull();

    const unpaid = await makeOrder();
    await adminPut(unpaid.id, { paymentStatus: 'REFUNDED' }).expect(409);
    expect((await prisma.order.findUnique({ where: { id: unpaid.id } }))!.paymentStatus).toBe('UNPAID');
    await adminPut(unpaid.id, { paymentStatus: 'PAID' }).expect(400);
    expect(mail.sendOrderShipped).not.toHaveBeenCalled();
  });

  it('non-admins cannot use the payment fields', async () => {
    const o = await makeOrder({ paymentStatus: 'PAID' });
    await request(app.getHttpServer()).put(`/orders/${o.id}`).send({ paymentStatus: 'REFUNDED' }).expect(401);
    await request(app.getHttpServer()).put(`/orders/${o.id}`).set('Authorization', `Bearer ${customerToken()}`).send({ paymentStatus: 'REFUNDED' }).expect(403);
  });

  it('GET /orders attention filters return only matching orders; stats exposes the new keys', async () => {
    const refundDue = await makeOrder({ paymentStatus: 'PAID', status: 'CANCELLED' });
    const refunded = await makeOrder({ paymentStatus: 'REFUNDED', status: 'CANCELLED' });
    const awaiting = await makeOrder();
    const mismatch = await makeOrder({ refundNote: 'AMOUNT MISMATCH: payment x captured 1 vs expected 2' });

    const ids = (b: any) => b.items.map((i: any) => i.id);
    const refund = await adminGet('/orders?attention=refund&take=200').expect(200);
    expect(ids(refund.body)).toContain(refundDue.id);
    for (const id of [refunded.id, awaiting.id, mismatch.id]) expect(ids(refund.body)).not.toContain(id);
    expect(refund.body.items.every((i: any) => i.paymentStatus === 'PAID' && i.status === 'CANCELLED')).toBe(true);

    const aw = await adminGet('/orders?attention=awaiting&take=200').expect(200);
    expect(ids(aw.body)).toContain(awaiting.id);
    expect(ids(aw.body)).not.toContain(refundDue.id);
    const mm = await adminGet('/orders?attention=mismatch&take=200').expect(200);
    expect(ids(mm.body)).toContain(mismatch.id);
    expect(ids(mm.body)).not.toContain(awaiting.id);
    const ps = await adminGet('/orders?paymentStatus=REFUNDED&paymentMethod=RAZORPAY&take=200').expect(200);
    expect(ids(ps.body)).toContain(refunded.id);
    expect(ids(ps.body)).not.toContain(refundDue.id);
    // invalid values are ignored, not errors
    await adminGet('/orders?attention=bogus&paymentStatus=nope&paymentMethod=cash').expect(200);

    const stats = await adminGet('/orders/stats').expect(200);
    for (const k of ['orderCount', 'revenue', 'recentOrders', 'openEnquiries']) expect(stats.body).toHaveProperty(k);
    expect(stats.body.unpaidOnline).toBeGreaterThanOrEqual(2);
    expect(stats.body.refundsDue).toBeGreaterThanOrEqual(1);
    expect(stats.body.mismatches).toBeGreaterThanOrEqual(1);
  });

  it('customer-facing endpoints never expose refundNote or razorpay ids', async () => {
    const o = await makeOrder({ refundNote: 'AMOUNT MISMATCH: secret', razorpayPaymentId: `pay_${tag}_t` });
    const t = await request(app.getHttpServer()).get(`/orders/track/${o.id}`).query({ email }).expect(200);
    for (const k of ['refundNote', 'razorpayOrderId', 'razorpayPaymentId']) expect(t.body).not.toHaveProperty(k);
    await request(app.getHttpServer()).get('/orders').expect(401);
    await request(app.getHttpServer()).get('/orders/stats').set('Authorization', `Bearer ${customerToken()}`).expect(403);
  });
});
