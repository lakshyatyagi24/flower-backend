import { BadRequestException, ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PaymentsService } from './payments.service';

const SECRET = 'testsecret';
const sign = (rzpOrder: string, pay: string, secret = SECRET) =>
  createHmac('sha256', secret).update(`${rzpOrder}|${pay}`).digest('hex');

/** Minimal in-memory Prisma fake: equality, `{ in: [...] }` and null matching. */
function fakePrisma(order: any) {
  const matches = (where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && 'in' in v ? v.in.includes(order[k]) : (order[k] ?? null) === v,
    );
  return {
    order: {
      findUnique: jest.fn(async ({ where }: any) => (order && order.id === where.id ? { ...order } : null)),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ok = order.id === where.id && matches(where);
        if (ok) Object.assign(order, data);
        return { count: ok ? 1 : 0 };
      }),
    },
  } as any;
}

const baseOrder = (over: any = {}) => ({
  id: 7, userId: null, total: 1249.5, status: 'PENDING', paymentStatus: 'UNPAID', paymentMethod: 'COD',
  razorpayOrderId: null, razorpayPaymentId: null, customerName: 'A', customerEmail: 'a@b.com',
  customerPhone: '9354016059', items: [], ...over,
});

describe('PaymentsService', () => {
  let rzp: { createOrder: jest.Mock };
  let mail: { sendOrderPaid: jest.Mock };
  let warnSpy: jest.SpyInstance;
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const make = (order: any) => new PaymentsService(fakePrisma(order), rzp as any, mail as any);

  beforeEach(() => {
    process.env.RAZORPAY_KEY_SECRET = SECRET;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
    rzp = { createOrder: jest.fn(async () => ({ id: 'order_abc' })) };
    mail = { sendOrderPaid: jest.fn(async () => undefined) };
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = saved.secret;
    jest.restoreAllMocks();
  });

  describe('createRazorpayOrder', () => {
    it('creates a razorpay order in integer paise, stores the id and sets paymentMethod', async () => {
      const order = baseOrder();
      const res = await make(order).createRazorpayOrder(7, null, 'A@B.com');
      expect(rzp.createOrder).toHaveBeenCalledWith(124950, 'order_7');
      expect(res).toEqual({
        keyId: 'rzp_test_x', razorpayOrderId: 'order_abc', amount: 124950, currency: 'INR', name: 'Fresh Petals',
        prefill: { name: 'A', email: 'a@b.com', contact: '9354016059' },
      });
      expect(order.razorpayOrderId).toBe('order_abc');
      expect(order.paymentMethod).toBe('RAZORPAY');
    });

    it('rounds floating-point totals to exact paise', async () => {
      const total = 19.99 * 3; // 59.97 with float error
      expect(Math.round(total * 100)).toBe(5997);
      await make(baseOrder({ total })).createRazorpayOrder(7, null, 'a@b.com');
      expect(rzp.createOrder).toHaveBeenCalledWith(5997, 'order_7');
      rzp.createOrder.mockClear();
      await make(baseOrder({ total: 0.1 + 0.2 })).createRazorpayOrder(7, null, 'a@b.com');
      expect(rzp.createOrder).toHaveBeenCalledWith(30, 'order_7');
    });

    it('is idempotent: reuses an existing razorpayOrderId', async () => {
      const order = baseOrder({ razorpayOrderId: 'order_existing' });
      const res = await make(order).createRazorpayOrder(7, null, 'a@b.com');
      expect(rzp.createOrder).not.toHaveBeenCalled();
      expect(res.razorpayOrderId).toBe('order_existing');
    });

    it('allows the owner when logged in, rejects another user and a wrong/missing guest email', async () => {
      await expect(make(baseOrder({ userId: 3 })).createRazorpayOrder(7, 3, null)).resolves.toMatchObject({ razorpayOrderId: 'order_abc' });
      await expect(make(baseOrder({ userId: 3 })).createRazorpayOrder(7, 4, 'a@b.com')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(make(baseOrder()).createRazorpayOrder(7, null, 'x@y.com')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(make(baseOrder()).createRazorpayOrder(7, null, null)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(make(baseOrder({ customerEmail: null })).createRazorpayOrder(7, null, null)).rejects.toBeInstanceOf(ForbiddenException);
      // an unknown order looks identical to a not-yours order (no id enumeration)
      await expect(make(baseOrder()).createRazorpayOrder(999, null, 'a@b.com')).rejects.toBeInstanceOf(ForbiddenException);
      expect(rzp.createOrder).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['already paid', { paymentStatus: 'PAID' }],
      ['refunded', { paymentStatus: 'REFUNDED' }],
      ['cancelled', { status: 'CANCELLED' }],
      ['shipped', { status: 'SHIPPED' }],
    ])('rejects an order that is %s', async (_n, over) => {
      await expect(make(baseOrder(over)).createRazorpayOrder(7, null, 'a@b.com')).rejects.toBeInstanceOf(BadRequestException);
      expect(rzp.createOrder).not.toHaveBeenCalled();
    });

    it('allows retrying a FAILED payment', async () => {
      await expect(make(baseOrder({ paymentStatus: 'FAILED' })).createRazorpayOrder(7, null, 'a@b.com')).resolves.toBeDefined();
    });

    it('throws a clear error when RAZORPAY_KEY_ID is not configured', async () => {
      for (const v of [undefined, '']) {
        if (v === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = v;
        await expect(make(baseOrder()).createRazorpayOrder(7, null, 'a@b.com')).rejects.toThrow('Online payments are not configured');
      }
      expect(rzp.createOrder).not.toHaveBeenCalled();
    });
  });

  describe('markPaid', () => {
    it('flips UNPAID -> PAID once, sets status PAID and mails exactly once', async () => {
      const order = baseOrder();
      const svc = make(order);
      await expect(svc.markPaid(7, 'pay_1')).resolves.toBe('PAID');
      expect(order).toMatchObject({ paymentStatus: 'PAID', status: 'PAID', razorpayPaymentId: 'pay_1' });
      expect(order.paidAt).toBeInstanceOf(Date);
      await expect(svc.markPaid(7, 'pay_1')).resolves.toBe('ALREADY_PAID');
      expect(mail.sendOrderPaid).toHaveBeenCalledTimes(1);
    });

    it('FAILED -> PAID works', async () => {
      const order = baseOrder({ paymentStatus: 'FAILED' });
      await expect(make(order).markPaid(7, 'pay_2')).resolves.toBe('PAID');
      expect(order).toMatchObject({ paymentStatus: 'PAID', status: 'PAID' });
      expect(mail.sendOrderPaid).toHaveBeenCalledTimes(1);
    });

    it('race: only the caller whose guarded update wins sends mail', async () => {
      const order = baseOrder();
      const svc = make(order);
      const results = await Promise.all([svc.markPaid(7, 'pay_1'), svc.markPaid(7, 'pay_1')]);
      expect([...results].sort()).toEqual(['ALREADY_PAID', 'PAID']);
      expect(mail.sendOrderPaid).toHaveBeenCalledTimes(1);
    });

    it('PAID_AFTER_CANCEL: records payment, keeps CANCELLED, no customer mail, warns with ids only', async () => {
      const order = baseOrder({ status: 'CANCELLED' });
      await expect(make(order).markPaid(7, 'pay_3')).resolves.toBe('PAID_AFTER_CANCEL');
      expect(order).toMatchObject({ paymentStatus: 'PAID', status: 'CANCELLED', razorpayPaymentId: 'pay_3' });
      expect(order.paidAt).toBeInstanceOf(Date);
      expect(mail.sendOrderPaid).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = String(warnSpy.mock.calls[0][0]);
      expect(msg).toContain('7');
      expect(msg).toContain('pay_3');
    });

    it('does not move a SHIPPED order back to PAID status', async () => {
      const order = baseOrder({ status: 'SHIPPED' });
      await expect(make(order).markPaid(7, 'pay_4')).resolves.toBe('PAID');
      expect(order.status).toBe('SHIPPED');
      expect(order.paymentStatus).toBe('PAID');
    });

    it('does not resurrect a REFUNDED order', async () => {
      const order = baseOrder({ paymentStatus: 'REFUNDED' });
      await expect(make(order).markPaid(7, 'pay_5')).resolves.toBe('ALREADY_PAID');
      expect(order.paymentStatus).toBe('REFUNDED');
      expect(mail.sendOrderPaid).not.toHaveBeenCalled();
    });

    it('a mail failure does not fail markPaid', async () => {
      mail.sendOrderPaid.mockRejectedValue(new Error('boom'));
      await expect(make(baseOrder()).markPaid(7, 'pay_6')).resolves.toBe('PAID');
    });
  });

  describe('verify', () => {
    const body = (over: any = {}) => ({
      orderId: 7, razorpayOrderId: 'order_abc', razorpayPaymentId: 'pay_1', signature: sign('order_abc', 'pay_1'), ...over,
    });
    const rzpOrder = (over: any = {}) => baseOrder({ razorpayOrderId: 'order_abc', paymentMethod: 'RAZORPAY', ...over });

    it('verifies a correct signature and marks PAID once; replay is idempotent', async () => {
      const order = rzpOrder();
      const svc = make(order);
      await expect(svc.verify(body())).resolves.toEqual({ ok: true, status: 'PAID' });
      expect(order).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
      await expect(svc.verify(body())).resolves.toEqual({ ok: true, status: 'PAID' });
      expect(mail.sendOrderPaid).toHaveBeenCalledTimes(1);
    });

    it('rejects a bad signature (wrong value, wrong length, wrong secret) and does not mark paid', async () => {
      for (const signature of ['nope', 'a'.repeat(64), sign('order_abc', 'pay_1', 'othersecret')]) {
        const order = rzpOrder();
        await expect(make(order).verify(body({ signature }))).rejects.toBeInstanceOf(BadRequestException);
        expect(order.paymentStatus).toBe('UNPAID');
      }
      expect(mail.sendOrderPaid).not.toHaveBeenCalled();
    });

    it('a signature for a different payment id is rejected', async () => {
      await expect(make(rzpOrder()).verify(body({ razorpayPaymentId: 'pay_other' }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when RAZORPAY_KEY_SECRET is missing, even for a signature forged with an empty secret', async () => {
      for (const v of [undefined, '']) {
        if (v === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = v;
        const order = rzpOrder();
        const forged = createHmac('sha256', '').update('order_abc|pay_1').digest('hex');
        await expect(make(order).verify(body({ signature: forged }))).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(order.paymentStatus).toBe('UNPAID');
      }
    });

    it('rejects when the razorpayOrderId does not match the stored one, or the order is unknown', async () => {
      const order = rzpOrder();
      const sig = sign('order_evil', 'pay_1');
      await expect(make(order).verify(body({ razorpayOrderId: 'order_evil', signature: sig }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(make(rzpOrder({ razorpayOrderId: null })).verify(body())).rejects.toBeInstanceOf(BadRequestException);
      await expect(make(rzpOrder()).verify(body({ orderId: 999 }))).rejects.toBeInstanceOf(BadRequestException);
      expect(order.paymentStatus).toBe('UNPAID');
    });
  });
});
