import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RAZORPAY_CLIENT } from '../src/payments/razorpay.client';
import { signJwt } from '../src/auth/jwt.util';
import { DeliveryService } from '../src/delivery/delivery.service';
import { pinDeliveryRules } from './delivery-rules-helper';

describe('Coupons (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreRules: () => Promise<void>;
  let deliveryDate: string;
  let productId: number;
  let taxedProductId: number;
  const tag = `E2EC${Date.now().toString(36).toUpperCase()}`;
  const email = `e2e-coupons-${Date.now()}@example.com`;
  const createdOrderIds: number[] = [];
  const createdCouponCodes: string[] = [];
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const fake = { createOrder: jest.fn(async (amount: number) => ({ id: `order_e2e_${amount}` })) };
  const admin = () => `Bearer ${signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' })}`;
  const customer = () => `Bearer ${signJwt({ sub: 999998, email: 'c@example.com', role: 'CUSTOMER' })}`;
  let shippingKeys: Array<{ key: string; value: string }> = [];

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
    restoreRules = await pinDeliveryRules(prisma);
    deliveryDate = (await app.get(DeliveryService).deliveryOptions()).earliest;
    // Deterministic shipping: flat 50, free from 5000.
    shippingKeys = await prisma.setting.findMany({ where: { key: { in: ['shipping.flatRate', 'shipping.freeThreshold'] } } });
    for (const [key, value] of [['shipping.flatRate', '50'], ['shipping.freeThreshold', '5000']]) {
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    const p = await prisma.product.create({
      data: { name: 'E2E Coupon Rose', slug: `e2e-coupon-${Date.now()}`, price: 1000, stock: 20, active: true, saleMode: 'PURCHASE' },
    });
    productId = p.id;
    const t = await prisma.product.create({
      data: { name: 'E2E Coupon Taxed', slug: `e2e-coupon-tax-${Date.now()}`, price: 1000, stock: 20, active: true, saleMode: 'PURCHASE', gstRate: 18 },
    });
    taxedProductId = t.id;
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.coupon.deleteMany({ where: { code: { in: createdCouponCodes } } });
    await prisma.product.deleteMany({ where: { id: { in: [productId, taxedProductId] } } });
    await prisma.setting.deleteMany({ where: { key: { in: ['shipping.flatRate', 'shipping.freeThreshold'] } } });
    for (const r of shippingKeys) await prisma.setting.create({ data: r });
    await restoreRules();
    if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = saved.secret;
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const mkCoupon = async (suffix: string, over: Record<string, unknown> = {}) => {
    const code = `${tag}${suffix}`;
    createdCouponCodes.push(code);
    return prisma.coupon.create({ data: { code, type: 'PERCENT', value: 10, ...over } as any });
  };
  const order = async (couponCode?: string, extra: Record<string, unknown> = {}) => {
    const res = await http().post('/orders').send({
      items: [{ productId, quantity: 1 }], customerName: 'E2E', customerEmail: email, customerPhone: '9354016059',
      shippingAddress: '1 Road', city: 'Delhi', postalCode: '110001', deliveryDate, paymentMethod: 'RAZORPAY',
      ...(couponCode !== undefined ? { couponCode } : {}), ...extra,
    });
    if (res.body?.id) createdOrderIds.push(res.body.id);
    return res;
  };

  describe('admin CRUD', () => {
    it('is admin only', async () => {
      expect((await http().get('/coupons')).status).toBe(401);
      expect((await http().get('/coupons').set('Authorization', customer())).status).toBe(403);
      expect((await http().post('/coupons').set('Authorization', customer()).send({ code: 'ABC', type: 'FLAT', value: 5 })).status).toBe(403);
    });

    it('creates (code upper-cased), lists, updates, refuses a duplicate, validates ranges', async () => {
      const code = `${tag}CRUD`;
      createdCouponCodes.push(code);
      const created = await http().post('/coupons').set('Authorization', admin()).send({ code: code.toLowerCase(), type: 'PERCENT', value: 15, maxDiscount: 200, minSubtotal: 500 });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code, type: 'PERCENT', value: 15, maxDiscount: 200, minSubtotal: 500, usedCount: 0, active: true });
      const dup = await http().post('/coupons').set('Authorization', admin()).send({ code, type: 'FLAT', value: 5 });
      expect(dup.status).toBe(409);
      const list = await http().get('/coupons').set('Authorization', admin());
      expect(list.body.some((c: any) => c.code === code)).toBe(true);
      const upd = await http().put(`/coupons/${created.body.id}`).set('Authorization', admin()).send({ value: 20, active: false });
      expect(upd.body).toMatchObject({ value: 20, active: false, code });
      // code is immutable
      expect((await http().put(`/coupons/${created.body.id}`).set('Authorization', admin()).send({ code: 'OTHER' })).status).toBe(400);
      for (const bad of [
        { code: 'AB', type: 'FLAT', value: 5 },
        { code: 'has space', type: 'FLAT', value: 5 },
        { code: 'OKCODE1', type: 'PERCENT', value: 101 },
        { code: 'OKCODE2', type: 'PERCENT', value: 0 },
        { code: 'OKCODE3', type: 'FLAT', value: -5 },
        { code: 'OKCODE4', type: 'FLAT', value: 5, minSubtotal: -1 },
        { code: 'OKCODE5', type: 'PERCENT', value: 5, maxDiscount: 0 },
        { code: 'OKCODE6', type: 'FLAT', value: 5, maxDiscount: 5 },
        { code: 'OKCODE7', type: 'FLAT', value: 5, maxUses: 0 },
        { code: 'OKCODE8', type: 'FLAT', value: 5, expiresAt: 'tomorrow' },
        { code: 'OKCODE9', type: 'NOPE', value: 5 },
      ]) {
        const r = await http().post('/coupons').set('Authorization', admin()).send(bad);
        expect([bad, r.status]).toEqual([bad, 400]);
      }
    });

    it('non-numeric ids are a 400 on every id route (no parseInt leniency)', async () => {
      for (const id of ['1abc', 'abc', '1.5', '-1', '99999999999']) {
        expect([id, (await http().put('/coupons/' + id).set('Authorization', admin()).send({ active: false })).status]).toEqual([id, 400]);
        expect([id, (await http().delete('/coupons/' + id).set('Authorization', admin())).status]).toEqual([id, 400]);
      }
    });

    it('a partial update (only active) leaves every other field, including expiry, untouched', async () => {
      const exp = new Date('2031-01-01T18:29:59.999Z');
      const c = await mkCoupon('PART', { expiresAt: exp, maxUses: 7, minSubtotal: 300 });
      const res = await http().put('/coupons/' + c.id).set('Authorization', admin()).send({ active: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ active: false, maxUses: 7, minSubtotal: 300, value: 10, type: 'PERCENT' });
      expect(new Date(res.body.expiresAt).getTime()).toBe(exp.getTime());
    });

    it('delete: unused coupons are removed; used ones are refused with a clear message', async () => {
      const unused = await mkCoupon('DEL1');
      expect((await http().delete(`/coupons/${unused.id}`).set('Authorization', admin())).status).toBe(200);
      expect(await prisma.coupon.findUnique({ where: { id: unused.id } })).toBeNull();
      const used = await mkCoupon('DEL2', { usedCount: 2 });
      const res = await http().delete(`/coupons/${used.id}`).set('Authorization', admin());
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Deactivate it instead/);
      expect(await prisma.coupon.findUnique({ where: { id: used.id } })).not.toBeNull();
    });
  });

  describe('POST /coupons/validate', () => {
    it('returns the discount for a valid code (normalised) and only public fields', async () => {
      const c = await mkCoupon('VAL', { value: 10, maxUses: 5, usedCount: 2 });
      const res = await http().post('/coupons/validate').send({ code: `  ${c.code.toLowerCase()} `, subtotal: 1000 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ code: c.code, type: 'PERCENT', value: 10, discount: 100, minTotal: 1 });
    });

    it('unknown, inactive, expired and used-up codes are indistinguishable in the public preview; the minimum-subtotal hint stays', async () => {
      const off = await mkCoupon('OFF', { active: false });
      const unknown = await http().post('/coupons/validate').send({ code: `${tag}NOPE`, subtotal: 1000 });
      const inactive = await http().post('/coupons/validate').send({ code: off.code, subtotal: 1000 });
      expect(unknown.status).toBe(400);
      expect(inactive.status).toBe(400);
      expect(inactive.body).toEqual(unknown.body);
      expect(unknown.body.message).toBe('Coupon not found');
      const expired = await mkCoupon('EXP', { expiresAt: new Date('2020-01-01') });
      // The PUBLIC preview reports finished codes as unknown, so strangers cannot probe which codes have existed.
      const expiredRes = await http().post('/coupons/validate').send({ code: expired.code, subtotal: 1000 });
      expect(expiredRes.status).toBe(400);
      expect(expiredRes.body).toEqual(unknown.body);
      const full = await mkCoupon('FULL', { maxUses: 1, usedCount: 1 });
      const fullRes = await http().post('/coupons/validate').send({ code: full.code, subtotal: 1000 });
      expect(fullRes.body).toEqual(unknown.body);
      const min = await mkCoupon('MIN', { minSubtotal: 1500 });
      expect((await http().post('/coupons/validate').send({ code: min.code, subtotal: 1000 })).body.message).toBe('Add ₹500 more to use this coupon');
    });

    it('rejects malformed bodies', async () => {
      expect((await http().post('/coupons/validate').send({ code: 'A'.repeat(65), subtotal: 5 })).status).toBe(400);
      expect((await http().post('/coupons/validate').send({ code: 'X' })).status).toBe(400);
      expect((await http().post('/coupons/validate').send({ code: 'X', subtotal: -5 })).status).toBe(400);
      expect((await http().post('/coupons/validate').send({ code: 'X', subtotal: 5, extra: 1 })).status).toBe(400);
    });
  });

  describe('orders with a coupon', () => {
    it('persists the discount, total and use; the Razorpay amount comes from the discounted total', async () => {
      const c = await mkCoupon('ORD1', { value: 10 });
      const res = await order(c.code.toLowerCase());
      expect(res.status).toBe(201);
      // subtotal 1000, discount 100, shipping 50 (below the 5000 threshold), gst 0
      expect(res.body).toMatchObject({ couponCode: c.code, discount: 100, subtotal: 1000, shipping: 50, total: 950 });
      expect((await prisma.coupon.findUnique({ where: { id: c.id } }))!.usedCount).toBe(1);
      const pay = await http().post('/payments/razorpay/order').send({ orderId: res.body.id, email });
      expect(pay.status).toBe(200);
      expect(pay.body.amount).toBe(95000);
      expect(fake.createOrder).toHaveBeenLastCalledWith(95000, `order_${res.body.id}`);
    });

    it('GST is charged on the discounted value and the Razorpay amount matches the persisted total', async () => {
      const c = await mkCoupon('GST1', { value: 20 });
      const res = await order(c.code, { items: [{ productId: taxedProductId, quantity: 1 }] });
      expect(res.status).toBe(201);
      // 1000 - 200 discount + 50 shipping + 18% of 800 (= 144)
      expect(res.body).toMatchObject({ subtotal: 1000, discount: 200, gst: 144, shipping: 50, total: 994 });
      expect(res.body.items[0].gstAmount).toBe(144);
      const pay = await http().post('/payments/razorpay/order').send({ orderId: res.body.id, email });
      expect(pay.body.amount).toBe(99400);
      const plain = await order(undefined, { items: [{ productId: taxedProductId, quantity: 1 }] });
      expect(plain.body).toMatchObject({ discount: 0, gst: 180, total: 1230 });
    });

    it('a client-supplied subtotal or total is rejected, never used', async () => {
      const c = await mkCoupon('ORD2');
      expect((await order(c.code, { subtotal: 1 })).status).toBe(400);
      expect((await order(c.code, { total: 1 })).status).toBe(400);
      expect((await order(c.code, { discount: 999 })).status).toBe(400);
    });

    it('each coupon error is a 400 flagged field=couponCode, and consumes neither stock nor a use', async () => {
      const before = (await prisma.product.findUnique({ where: { id: productId } }))!.stock;
      const expired = await mkCoupon('E1', { expiresAt: new Date('2020-01-01') });
      const full = await mkCoupon('E2', { maxUses: 1, usedCount: 1 });
      const min = await mkCoupon('E3', { minSubtotal: 2000 });
      const off = await mkCoupon('E4', { active: false });
      const free = await mkCoupon('E5', { type: 'PERCENT', value: 100 });
      await prisma.setting.update({ where: { key: 'shipping.freeThreshold' }, data: { value: '500' } });
      try {
        const cases: Array<[string, RegExp | string]> = [
          [expired.code, 'Coupon expired'],
          [full.code, 'Coupon usage limit reached'],
          [min.code, 'Add ₹1000 more to use this coupon'],
          [off.code, 'Coupon not found'],
          [`${tag}MISSING`, 'Coupon not found'],
          [free.code, /below ₹1/],
        ];
        for (const [code, msg] of cases) {
          const res = await order(code);
          expect([code, res.status]).toEqual([code, 400]);
          expect(res.body.field).toBe('couponCode');
          if (typeof msg === 'string') expect(res.body.message).toBe(msg); else expect(res.body.message).toMatch(msg);
        }
      } finally {
        await prisma.setting.update({ where: { key: 'shipping.freeThreshold' }, data: { value: '5000' } });
      }
      expect((await prisma.product.findUnique({ where: { id: productId } }))!.stock).toBe(before);
      expect((await prisma.coupon.findUnique({ where: { id: free.id } }))!.usedCount).toBe(0);
      expect((await prisma.coupon.findUnique({ where: { id: min.id } }))!.usedCount).toBe(0);
    });

    it('concurrent orders for the last use: one wins, the loser is rolled back and its stock restored', async () => {
      const c = await mkCoupon('RACE', { maxUses: 1 });
      const before = (await prisma.product.findUnique({ where: { id: productId } }))!.stock;
      const [a, b] = await Promise.all([order(c.code), order(c.code)]);
      expect([a.status, b.status].sort()).toEqual([201, 400]);
      const loser = a.status === 400 ? a : b;
      expect(loser.body.message).toBe('Coupon usage limit reached');
      expect((await prisma.coupon.findUnique({ where: { id: c.id } }))!.usedCount).toBe(1);
      expect((await prisma.product.findUnique({ where: { id: productId } }))!.stock).toBe(before - 1);
    });

    it('cancel (admin) gives the use back once; a repeat does not give it back twice', async () => {
      const c = await mkCoupon('CAN', { maxUses: 1 });
      const o = await order(c.code);
      expect(o.status).toBe(201);
      expect((await prisma.coupon.findUnique({ where: { id: c.id } }))!.usedCount).toBe(1);
      expect((await order(c.code)).status).toBe(400); // exhausted while the first is live
      const cancel = () => http().put(`/orders/${o.body.id}/status`).set('Authorization', admin()).send({ status: 'CANCELLED' });
      const [r1, r2] = await Promise.all([cancel(), cancel()]);
      expect([r1.status, r2.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
      expect((await prisma.coupon.findUnique({ where: { id: c.id } }))!.usedCount).toBe(0);
      await cancel();
      expect((await prisma.coupon.findUnique({ where: { id: c.id } }))!.usedCount).toBe(0);
      expect((await order(c.code)).status).toBe(201); // the freed use is usable again
    });

    it('an order switched to COD keeps its coupon and its use', async () => {
      const c = await mkCoupon('COD');
      const o = await order(c.code);
      const sw = await http().put(`/orders/${o.body.id}/payment-method`).send({ paymentMethod: 'COD', email });
      expect(sw.status).toBe(200);
      expect(sw.body).toMatchObject({ paymentMethod: 'COD', couponCode: c.code, discount: 100 });
      expect((await prisma.coupon.findUnique({ where: { id: c.id } }))!.usedCount).toBe(1);
    });

    it('order responses (customer track, admin detail) expose couponCode and discount; plain orders show 0', async () => {
      const c = await mkCoupon('VIS');
      const o = await order(c.code);
      const track = await http().post(`/orders/track/${o.body.id}`).send({ email });
      expect(track.body).toMatchObject({ couponCode: c.code, discount: 100 });
      const detail = await http().get(`/orders/${o.body.id}`).set('Authorization', admin());
      expect(detail.body).toMatchObject({ couponCode: c.code, discount: 100 });
      const plain = await order();
      expect(plain.body).toMatchObject({ couponCode: null, discount: 0, total: 1050 });
    });
  });
});
