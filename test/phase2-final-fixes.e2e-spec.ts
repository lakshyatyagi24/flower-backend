import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { applyBodyParsers } from '../src/common/body-parsers';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { DeliveryService } from '../src/delivery/delivery.service';
import { pinDeliveryRules } from './delivery-rules-helper';
import { PaymentsService } from '../src/payments/payments.service';
import { RAZORPAY_CLIENT } from '../src/payments/razorpay.client';
import { signJwt } from '../src/auth/jwt.util';

const HIDDEN = ['adminNotes', 'refundNote', 'razorpayOrderId', 'razorpayPaymentId'];

describe('Phase 2 final fixes (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tag = `ff${Date.now()}`;
  const email = `${tag}@example.com`;
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const orderIds: number[] = [];
  let userId: number;
  let productId: number;
  const mail = {
    sendOrderPlaced: jest.fn(async () => undefined),
    sendOrderPaid: jest.fn(async () => undefined),
    sendOrderShipped: jest.fn(async () => undefined),
  };
  const setKeys = (id?: string, secret?: string) => {
    if (id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = id;
    if (secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = secret;
  };
  const http = () => request(app.getHttpServer());
  const userAuth = () => `Bearer ${signJwt({ sub: userId, email, role: 'CUSTOMER' })}`;
  const adminAuth = () => `Bearer ${signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' })}`;
  let deliveryDate = '';
  let restoreRules: (() => Promise<void>) | undefined;
  const orderBody = (paymentMethod: string) => ({
    items: [{ productId, quantity: 1 }], customerName: 'FF', customerEmail: email, customerPhone: '9354016059',
    shippingAddress: '1 Test Road', city: 'Delhi', postalCode: '110001', paymentMethod,
    deliveryDate,
  });

  beforeAll(async () => {
    setKeys('rzp_test_ff', 'ff-secret');
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RAZORPAY_CLIENT).useValue({ createOrder: async () => ({ id: 'order_never' }) })
      .overrideProvider(MailService).useValue(mail)
      .compile();
    app = m.createNestApplication<NestExpressApplication>({ rawBody: true });
    applyBodyParsers(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    restoreRules = await pinDeliveryRules(prisma);
    deliveryDate = await app.get(DeliveryService).earliestDeliveryDate();
    userId = (await prisma.user.create({ data: { email, password: 'x', name: 'FF' } })).id;
    productId = (await prisma.product.create({
      data: { name: 'FF Rose', slug: `ff-rose-${tag}`, price: 100, stock: 50, active: true, saleMode: 'PURCHASE' },
    })).id;
  });
  afterAll(async () => {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productId) await prisma.product.deleteMany({ where: { id: productId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    setKeys(saved.id, saved.secret);
    await restoreRules?.();
    await app.close();
  });

  describe('GET /payments/razorpay/config', () => {
    it('reports enabled only when both keys are set; never leaks the key id', async () => {
      const on = await http().get('/payments/razorpay/config').expect(200);
      expect(on.body).toEqual({ enabled: true });
      expect(JSON.stringify(on.body)).not.toContain('rzp_test_ff');
      setKeys('rzp_test_ff', undefined);
      expect((await http().get('/payments/razorpay/config').expect(200)).body).toEqual({ enabled: false });
      setKeys(undefined, undefined);
      expect((await http().get('/payments/razorpay/config').expect(200)).body).toEqual({ enabled: false });
      setKeys('  ', '  ');
      expect((await http().get('/payments/razorpay/config').expect(200)).body).toEqual({ enabled: false });
      setKeys('rzp_test_ff', 'ff-secret');
    });

    it('POST /orders with RAZORPAY is 400 when disabled (no stock claimed); COD still works', async () => {
      setKeys(undefined, undefined);
      try {
        const before = (await prisma.product.findUnique({ where: { id: productId } }))!.stock;
        const res = await http().post('/orders').send(orderBody('RAZORPAY'));
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Online payments are currently unavailable. Please choose cash on delivery.');
        expect((await prisma.product.findUnique({ where: { id: productId } }))!.stock).toBe(before);
        const cod = await http().post('/orders').send(orderBody('COD'));
        expect(cod.status).toBe(201);
        orderIds.push(cod.body.id);
      } finally {
        setKeys('rzp_test_ff', 'ff-secret');
      }
    });
  });

  describe('customer endpoints never expose adminNotes, refundNote or razorpay ids', () => {
    const expectHidden = (body: any) => { for (const k of HIDDEN) expect(body).not.toHaveProperty(k); };

    it('create, mine, mine/:id, track and switch responses are clean; admin GET /orders/:id still has them', async () => {
      const created = await http().post('/orders').set('Authorization', userAuth()).send(orderBody('RAZORPAY')).expect(201);
      orderIds.push(created.body.id);
      expectHidden(created.body);
      const id: number = created.body.id;

      await prisma.order.update({
        where: { id },
        data: { adminNotes: 'internal', refundNote: 'owner note', razorpayOrderId: `order_${tag}`, razorpayPaymentId: `pay_${tag}` },
      });

      const list = await http().get('/orders/mine').set('Authorization', userAuth()).expect(200);
      expect(list.body.find((o: any) => o.id === id)).toBeDefined();
      for (const o of list.body) expectHidden(o);
      expectHidden((await http().get(`/orders/mine/${id}`).set('Authorization', userAuth()).expect(200)).body);
      expectHidden((await http().get(`/orders/track/${id}`).query({ email }).expect(200)).body);

      const admin = await http().get(`/orders/${id}`).set('Authorization', adminAuth()).expect(200);
      expect(admin.body).toMatchObject({
        adminNotes: 'internal', refundNote: 'owner note', razorpayOrderId: `order_${tag}`, razorpayPaymentId: `pay_${tag}`,
      });

      // switch response (separate order: a recorded payment id makes the first one non-switchable)
      const second = await http().post('/orders').set('Authorization', userAuth()).send(orderBody('RAZORPAY')).expect(201);
      orderIds.push(second.body.id);
      await prisma.order.update({
        where: { id: second.body.id },
        data: { adminNotes: 'internal2', razorpayOrderId: `order_${tag}_2` },
      });
      const sw = await http().put(`/orders/${second.body.id}/payment-method`).set('Authorization', userAuth())
        .send({ paymentMethod: 'COD' }).expect(200);
      expect(sw.body.paymentMethod).toBe('COD');
      expectHidden(sw.body);
    });
  });

  describe('capture that races a switch to COD (markPaid on the COD order)', () => {
    it('appends the trace once, never changes status/paymentStatus/method, sends no paid mail', async () => {
      const created = await http().post('/orders').send(orderBody('RAZORPAY')).expect(201);
      const id: number = created.body.id;
      orderIds.push(id);
      await prisma.order.update({ where: { id }, data: { razorpayOrderId: `order_${tag}_race` } });
      await http().put(`/orders/${id}/payment-method`).send({ paymentMethod: 'COD', email }).expect(200);

      const payments = app.get(PaymentsService);
      mail.sendOrderPaid.mockClear();
      await expect(payments.markPaid(id, `pay_${tag}_x`)).resolves.toBe('CAPTURED_AFTER_SWITCH');
      await expect(payments.markPaid(id, `pay_${tag}_x`)).resolves.toBe('CAPTURED_AFTER_SWITCH');

      const row = await prisma.order.findUnique({ where: { id } });
      expect(row).toMatchObject({ status: 'PENDING', paymentStatus: 'UNPAID', paymentMethod: 'COD', razorpayPaymentId: null });
      const note = row!.refundNote as string;
      expect(note).toContain(`Switched to COD; abandoned Razorpay order order_${tag}_race`);
      expect(note).toContain(`PAYMENT pay_${tag}_x CAPTURED AFTER SWITCH TO COD - REFUND`);
      expect(note.split(`pay_${tag}_x`)).toHaveLength(2); // exactly once
      expect(mail.sendOrderPaid).not.toHaveBeenCalled();
    });
  });
});
