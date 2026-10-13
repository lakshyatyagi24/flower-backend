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
import { RAZORPAY_CLIENT } from '../src/payments/razorpay.client';
import { signJwt } from '../src/auth/jwt.util';

/**
 * Task 4.3: guests place, pay for, switch and track their own orders; nobody else can by guessing ids.
 * The email on the order is the guest's key, so every guest call must present it and it must match.
 */
describe('Guest checkout authorization (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tag = `gc${Date.now()}`;
  const emailA = `${tag}-a@example.com`;
  const emailB = `${tag}-b@example.com`;
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const orderIds: number[] = [];
  const userIds: number[] = [];
  let productId: number;
  let minProductId: number;
  let deliveryDate = '';
  let restoreRules: (() => Promise<void>) | undefined;
  const mail = {
    sendOrderPlaced: jest.fn(async () => undefined),
    sendOrderPaid: jest.fn(async () => undefined),
    sendOrderShipped: jest.fn(async () => undefined),
  };
  const http = () => request(app.getHttpServer());
  const body = (email: string, over: Record<string, unknown> = {}) => ({
    items: [{ productId, quantity: 1 }], customerName: 'Guest', customerEmail: email, customerPhone: '9354016059',
    shippingAddress: '1 Test Road', city: 'Delhi', postalCode: '110001', paymentMethod: 'RAZORPAY', deliveryDate, ...over,
  });
  const stock = async (id = productId) => (await prisma.product.findUnique({ where: { id } }))!.stock;
  let rzpCounter = 0;

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_gc';
    process.env.RAZORPAY_KEY_SECRET = 'gc-secret';
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RAZORPAY_CLIENT).useValue({ createOrder: async () => ({ id: `order_${tag}_${++rzpCounter}` }) })
      .overrideProvider(MailService).useValue(mail)
      .compile();
    app = m.createNestApplication<NestExpressApplication>({ rawBody: true });
    applyBodyParsers(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    restoreRules = await pinDeliveryRules(prisma);
    deliveryDate = await app.get(DeliveryService).earliestDeliveryDate();
    productId = (await prisma.product.create({
      data: { name: 'GC Rose', slug: `gc-rose-${tag}`, price: 100, stock: 6, active: true, saleMode: 'PURCHASE' },
    })).id;
    minProductId = (await prisma.product.create({
      data: { name: 'GC Bunch', slug: `gc-bunch-${tag}`, price: 40, stock: 30, active: true, saleMode: 'PURCHASE', minOrderQty: 5 },
    })).id;
  });
  afterAll(async () => {
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.product.deleteMany({ where: { id: { in: [productId, minProductId].filter(Boolean) } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = saved.secret;
    await restoreRules?.();
    await app.close();
  });

  async function place(email: string, over: Record<string, unknown> = {}) {
    const res = await http().post('/orders').send(body(email, over));
    expect(res.status).toBe(201);
    orderIds.push(res.body.id);
    return res.body as { id: number; customerEmail: string };
  }

  describe('guest order creation', () => {
    it('needs no token, lowercases the email and charges the database price', async () => {
      const before = await stock();
      const o = await place(emailA.toUpperCase(), { paymentMethod: 'COD', items: [{ productId, quantity: 2 }] });
      expect(o.customerEmail).toBe(emailA);
      const row = await prisma.order.findUnique({ where: { id: o.id } });
      expect(row).toMatchObject({ userId: null, subtotal: 200 });
      expect(row!.total).toBe(200 + row!.shipping);
      expect(await stock()).toBe(before - 2);
    });

    it('rejects client-supplied prices (the server price is authoritative)', async () => {
      const res = await http().post('/orders').send({ ...body(emailA), items: [{ productId, quantity: 1, price: 1 }] });
      expect(res.status).toBe(400);
    });

    it('insufficient stock: a clear 400, nothing created, stock untouched', async () => {
      const before = await stock();
      const count = await prisma.order.count({ where: { customerEmail: emailA } });
      const res = await http().post('/orders').send(body(emailA, { items: [{ productId, quantity: before + 1 }] }));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(`Only ${before} of "GC Rose" available`);
      expect(await stock()).toBe(before);
      expect(await prisma.order.count({ where: { customerEmail: emailA } })).toBe(count);
    });

    it('a quantity below minOrderQty is rejected with the minimum, never silently raised', async () => {
      const before = await stock(minProductId);
      const res = await http().post('/orders').send(body(emailA, { items: [{ productId: minProductId, quantity: 2 }] }));
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('"GC Bunch" has a minimum order of 5');
      expect(await stock(minProductId)).toBe(before);
      const ok = await place(emailA, { paymentMethod: 'COD', items: [{ productId: minProductId, quantity: 5 }] });
      expect(await stock(minProductId)).toBe(before - 5);
      expect(ok.id).toBeGreaterThan(0);
    });

    it("a logged-in buyer's order is bound to the account email, whatever the form said", async () => {
      const u = await prisma.user.create({ data: { email: `${tag}-acct@example.com`, password: 'x', name: 'Acct' } });
      userIds.push(u.id);
      const auth = `Bearer ${signJwt({ sub: u.id, email: u.email, role: 'CUSTOMER' })}`;
      const res = await http().post('/orders').set('Authorization', auth).send(body(emailB, { paymentMethod: 'COD' }));
      expect(res.status).toBe(201);
      orderIds.push(res.body.id);
      expect(res.body.customerEmail).toBe(u.email);
      expect(res.body.userId).toBe(u.id);
    });
  });

  describe("a guest cannot reach another guest's order by guessing ids", () => {
    let a: { id: number };
    let b: { id: number };
    beforeAll(async () => {
      a = await place(emailA);
      b = await place(emailB);
    });

    it('track: POST with the right email works; wrong, missing or other-guest emails all get the SAME 404', async () => {
      const ok = await http().post(`/orders/track/${a.id}`).send({ email: emailA.toUpperCase() }).expect(200);
      expect(ok.body.id).toBe(a.id);
      for (const k of ['adminNotes', 'refundNote', 'razorpayOrderId', 'razorpayPaymentId']) expect(ok.body).not.toHaveProperty(k);

      const wrong = await http().post(`/orders/track/${a.id}`).send({ email: emailB }).expect(404);
      const unknown = await http().post('/orders/track/2147483000').send({ email: emailA }).expect(404);
      expect(wrong.body.message).toBe(unknown.body.message); // no 404-vs-403 oracle for sequential ids
      await http().post(`/orders/track/${a.id}`).send({}).expect(400);
      await http().post(`/orders/track/${a.id}`).send({ email: '' }).expect(400);
      await http().post('/orders/track/abc').send({ email: emailA }).expect(400);
      await http().post(`/orders/track/${a.id}`).send({ email: emailA, extra: 1 }).expect(400);
    });

    it('track: the legacy GET route still works and is equally strict', async () => {
      await http().get(`/orders/track/${a.id}`).query({ email: emailA }).expect(200);
      await http().get(`/orders/track/${a.id}`).query({ email: emailB }).expect(404);
      await http().get(`/orders/track/${a.id}`).expect(400);
    });

    it("razorpay order: no email, the other guest's email, or a wrong id is 403 and creates nothing", async () => {
      const created = rzpCounter;
      await http().post('/payments/razorpay/order').send({ orderId: a.id }).expect(403);
      await http().post('/payments/razorpay/order').send({ orderId: a.id, email: emailB }).expect(403);
      await http().post('/payments/razorpay/order').send({ orderId: 2147483000, email: emailA }).expect(403);
      expect(rzpCounter).toBe(created);
      const row = await prisma.order.findUnique({ where: { id: a.id } });
      expect(row!.razorpayOrderId).toBeNull();
    });

    it('razorpay order: the owning guest gets the payment details and the amount comes from the stored total', async () => {
      const row = await prisma.order.findUnique({ where: { id: b.id } });
      const res = await http().post('/payments/razorpay/order').send({ orderId: b.id, email: emailB }).expect(200);
      expect(res.body.amount).toBe(Math.round(row!.total * 100));
      expect(res.body.prefill.email).toBe(emailB);
    });

    it("switch to COD: another guest's email or none is 403 and the order stays online", async () => {
      await http().put(`/orders/${a.id}/payment-method`).send({ paymentMethod: 'COD', email: emailB }).expect(403);
      await http().put(`/orders/${a.id}/payment-method`).send({ paymentMethod: 'COD' }).expect(403);
      expect((await prisma.order.findUnique({ where: { id: a.id } }))!.paymentMethod).toBe('RAZORPAY');
      const ok = await http().put(`/orders/${a.id}/payment-method`).send({ paymentMethod: 'COD', email: emailA }).expect(200);
      expect(ok.body.paymentMethod).toBe('COD');
    });

    it('verify cannot be used to pay for someone else\'s order without the provider signature', async () => {
      await http().post('/payments/razorpay/verify').send({
        orderId: b.id, razorpayOrderId: 'order_x', razorpayPaymentId: 'pay_x', signature: 'deadbeef',
      }).expect(400);
      expect((await prisma.order.findUnique({ where: { id: b.id } }))!.paymentStatus).toBe('UNPAID');
    });

    it("the customer-only endpoints refuse guests, and a logged-in user cannot read or switch a guest or other user's order", async () => {
      await http().get(`/orders/mine/${a.id}`).expect(401);
      await http().get('/orders/mine').expect(401);
      const u1 = await prisma.user.create({ data: { email: `${tag}-u1@example.com`, password: 'x', name: 'U1' } });
      const u2 = await prisma.user.create({ data: { email: `${tag}-u2@example.com`, password: 'x', name: 'U2' } });
      userIds.push(u1.id, u2.id);
      const auth = (u: { id: number; email: string }) => `Bearer ${signJwt({ sub: u.id, email: u.email, role: 'CUSTOMER' })}`;
      const mine = await http().post('/orders').set('Authorization', auth(u1)).send(body(u1.email)).expect(201);
      orderIds.push(mine.body.id);
      await http().get(`/orders/mine/${mine.body.id}`).set('Authorization', auth(u1)).expect(200);
      await http().get(`/orders/mine/${mine.body.id}`).set('Authorization', auth(u2)).expect(403);
      await http().get(`/orders/mine/${b.id}`).set('Authorization', auth(u2)).expect(403); // guest order: no owner
      await http().post('/payments/razorpay/order').set('Authorization', auth(u2)).send({ orderId: mine.body.id }).expect(403);
      await http().put(`/orders/${mine.body.id}/payment-method`).set('Authorization', auth(u2)).send({ paymentMethod: 'COD' }).expect(403);
      // Not admin-readable by customers either.
      await http().get(`/orders/${a.id}`).set('Authorization', auth(u2)).expect(403);
    });
  });

  describe('one ownership rule (canAccessOrder)', () => {
    let acct: { id: number; email: string };
    let acctOrder: { id: number };
    let guestOrder: { id: number };
    const authFor = (u: { id: number; email: string }) => `Bearer ${signJwt({ sub: u.id, email: u.email, role: 'CUSTOMER' })}`;
    beforeAll(async () => {
      await prisma.product.update({ where: { id: productId }, data: { stock: 100 } });
      acct = await prisma.user.create({ data: { email: `${tag}-owner@example.com`, password: 'x', name: 'Owner' } });
      userIds.push(acct.id);
      const res = await http().post('/orders').set('Authorization', authFor(acct)).send(body(acct.email)).expect(201);
      acctOrder = res.body;
      orderIds.push(res.body.id);
      guestOrder = await place(`${tag}-g@example.com`);
    });

    it('anonymous + the registered customer email + order id is refused on pay and switch, exactly like a wrong guess', async () => {
      const rzp = rzpCounter;
      const real = await http().post('/payments/razorpay/order').send({ orderId: acctOrder.id, email: acct.email }).expect(403);
      const wrong = await http().post('/payments/razorpay/order').send({ orderId: acctOrder.id, email: 'nobody@example.com' }).expect(403);
      const unknown = await http().post('/payments/razorpay/order').send({ orderId: 2147483000, email: acct.email }).expect(403);
      expect(real.body).toEqual(wrong.body);
      expect(real.body).toEqual(unknown.body);
      expect(rzpCounter).toBe(rzp);
      const sw = await http().put(`/orders/${acctOrder.id}/payment-method`).send({ paymentMethod: 'COD', email: acct.email }).expect(403);
      const swWrong = await http().put(`/orders/${acctOrder.id}/payment-method`).send({ paymentMethod: 'COD', email: 'nobody@example.com' }).expect(403);
      expect(sw.body).toEqual(swWrong.body);
      expect((await prisma.order.findUnique({ where: { id: acctOrder.id } }))!.paymentMethod).toBe('RAZORPAY');
    });

    it('another account holder with the owner email is also refused; the owner token works', async () => {
      const other = await prisma.user.create({ data: { email: `${tag}-other@example.com`, password: 'x', name: 'Other' } });
      userIds.push(other.id);
      await http().post('/payments/razorpay/order').set('Authorization', authFor(other)).send({ orderId: acctOrder.id, email: acct.email }).expect(403);
      await http().post('/payments/razorpay/order').set('Authorization', authFor(acct)).send({ orderId: acctOrder.id }).expect(200);
    });

    it('a signed-in user can still pay and switch a GUEST order with its matching email', async () => {
      const u = await prisma.user.create({ data: { email: `${tag}-signedin@example.com`, password: 'x', name: 'SI' } });
      userIds.push(u.id);
      const email = `${tag}-g@example.com`;
      await http().post('/payments/razorpay/order').set('Authorization', authFor(u)).send({ orderId: guestOrder.id }).expect(403);
      await http().post('/payments/razorpay/order').set('Authorization', authFor(u)).send({ orderId: guestOrder.id, email: 'x@example.com' }).expect(403);
      await http().post('/payments/razorpay/order').set('Authorization', authFor(u)).send({ orderId: guestOrder.id, email }).expect(200);
      const sw = await http().put(`/orders/${guestOrder.id}/payment-method`).set('Authorization', authFor(u)).send({ paymentMethod: 'COD', email }).expect(200);
      expect(sw.body.paymentMethod).toBe('COD');
    });

    it('track stays email-based for account orders (public tracking by design)', async () => {
      await http().post(`/orders/track/${acctOrder.id}`).send({ email: acct.email }).expect(200);
    });
  });

  describe('tracking throttle', () => {
    it('GET and POST tracking share one bucket of 20 per minute', async () => {
      const email = `${tag}-t@example.com`;
      const o = await place(email);
      let limited = 0;
      for (let i = 0; i < 24; i++) {
        const r = i % 2 === 0
          ? await http().get(`/orders/track/${o.id}`).query({ email })
          : await http().post(`/orders/track/${o.id}`).send({ email });
        if (r.status === 429) limited++;
      }
      expect(limited).toBeGreaterThanOrEqual(4);
    });
  });
});
