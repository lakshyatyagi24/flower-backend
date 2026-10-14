import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { StaleOrdersJob } from '../payments/stale-orders.job';

/**
 * Stateful in-memory stand-in for the slice of Prisma the coupon paths touch. It applies guarded
 * updateMany filters against shared state exactly as the database would (atomically), and a failed
 * transaction undoes its own writes, so races and rollbacks are observable.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === 'AND') return (Array.isArray(v) ? v : [v]).every((w: any) => matches(row, w));
    if (k === 'OR') return v.some((w: any) => matches(row, w));
    const actual = row[k];
    if (v === null) return actual === null || actual === undefined;
    if (v instanceof Date || typeof v !== 'object') return actual === v;
    return Object.entries(v).every(([op, arg]: [string, any]) => {
      switch (op) {
        case 'not': return actual !== arg;
        case 'in': return arg.includes(actual);
        case 'lt': return actual < arg;
        case 'gt': return actual > arg;
        case 'gte': return actual >= arg;
        default: throw new Error(`unsupported operator ${op}`);
      }
    });
  });
}

const baseCoupon = (over: Record<string, unknown> = {}) => ({
  id: 1, code: 'SAVE10', type: 'PERCENT', value: 10, minSubtotal: 0, maxDiscount: null, expiresAt: null,
  maxUses: null, usedCount: 0, active: true, ...over,
});

function makeEnv(opts: { coupon?: any; stock?: number; price?: number; gstRate?: number; settings?: Record<string, string>; raceReads?: number; products?: any[] } = {}) {
  const state: any = {
    stock: opts.stock ?? 10,
    coupon: opts.coupon === undefined ? baseCoupon() : opts.coupon,
    orders: [] as any[],
    items: [] as any[],
    nextId: 1,
  };
  let reads = 0;
  let release!: () => void;
  const allRead = new Promise<void>((r) => (release = r));

  const tx = (undo: Array<() => void>) => ({
    coupon: {
      findUnique: jest.fn(async ({ where }: any) => {
        const c = state.coupon && (where.code === undefined || state.coupon.code === where.code) && (where.id === undefined || state.coupon.id === where.id) ? { ...state.coupon } : null;
        if (opts.raceReads) {
          reads++;
          if (reads >= opts.raceReads) release();
          await allRead; // every racer has read the pre-claim row before anyone claims
        }
        return c;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const c = state.coupon;
        if (!c) return { count: 0 };
        const row = { ...c };
        const ok = (where.id === undefined || where.id === c.id) && (where.code === undefined || where.code === c.code) && matches(row, (({ id: _i, code: _c, ...rest }) => rest)(where));
        if (!ok) return { count: 0 };
        const delta = data.usedCount.increment ?? -data.usedCount.decrement;
        c.usedCount += delta;
        undo.push(() => (c.usedCount -= delta));
        return { count: 1 };
      }),
    },
    product: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (state.stock < where.stock.gte) return { count: 0 };
        state.stock -= data.stock.decrement;
        undo.push(() => (state.stock += data.stock.decrement));
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        state.stock += data.stock.increment;
      }),
    },
    order: {
      create: jest.fn(async ({ data }: any) => {
        const { items, ...rest } = data;
        const o = { id: state.nextId++, createdAt: new Date(), ...rest };
        state.orders.push(o);
        state.items.push(...items.create.map((i: any) => ({ ...i, orderId: o.id })));
        undo.push(() => state.orders.splice(state.orders.indexOf(o), 1));
        return { ...o, items: items.create };
      }),
      findUnique: jest.fn(async ({ where, select }: any) => {
        const o = state.orders.find((x: any) => x.id === where.id);
        if (!o) return null;
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, o[k]])) : { ...o, items: [] };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = state.orders.filter((o: any) => matches(o, where));
        hits.forEach((o: any) => Object.assign(o, data));
        return { count: hits.length };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const o = state.orders.find((x: any) => x.id === where.id);
        Object.assign(o, data);
        return o;
      }),
    },
    orderItem: {
      findMany: jest.fn(async ({ where }: any) =>
        state.items.filter((i: any) => i.orderId === where.orderId).map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
      ),
    },
  });

  const prisma: any = {
    product: {
      findMany: jest.fn(async () => opts.products ?? [
        { id: 1, name: 'Rose', price: opts.price ?? 1000, stock: state.stock, active: true, saleMode: 'PURCHASE', gstRate: opts.gstRate ?? 0, minOrderQty: 1 },
      ]),
    },
    setting: {
      findUnique: jest.fn(async ({ where }: any) =>
        opts.settings && where.key in opts.settings ? { value: opts.settings[where.key] } : null,
      ),
    },
    user: { findUnique: jest.fn(async () => null) },
    order: {
      findUnique: jest.fn(async ({ where }: any) => {
        const o = state.orders.find((x: any) => x.id === where.id);
        return o ? { ...o, items: [] } : null;
      }),
      findMany: jest.fn(async () => state.orders.filter((o: any) => o.status === 'PENDING').map((o: any) => ({ id: o.id }))),
    },
    $transaction: jest.fn(async (fn: any) => {
      const undo: Array<() => void> = [];
      try {
        return await fn(tx(undo));
      } catch (e) {
        undo.reverse().forEach((u) => u());
        throw e;
      }
    }),
  };
  const mail: any = { sendOrderPlaced: jest.fn(async () => undefined), sendOrderShipped: jest.fn(async () => undefined) };
  const delivery: any = { isServiceable: jest.fn(async () => true), validateDeliveryDate: jest.fn(async (d: string) => d) };
  const svc = new OrdersService(prisma, mail, delivery);
  return { state, prisma, svc, mail };
}

const input = {
  items: [{ productId: 1, quantity: 1 }], customerName: 'C', customerEmail: 'c@x.com',
  customerPhone: '9876543210', shippingAddress: '1 Road', city: 'Delhi', postalCode: '110001',
  deliveryDate: '2026-10-14',
};
// Shipping: flat 99, free from 1499 (the public defaults) unless a test overrides settings.

async function errorOf(p: Promise<unknown>): Promise<BadRequestException> {
  try {
    await p;
  } catch (e) {
    return e as BadRequestException;
  }
  throw new Error('expected a rejection');
}

beforeAll(() => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
  process.env.RAZORPAY_KEY_SECRET = 'sec';
});

describe('OrdersService.create with a coupon', () => {
  it('applies a percent discount from the server-computed subtotal and persists code + discount + total', async () => {
    const { svc, state } = makeEnv({ price: 1000 }); // subtotal 1000 < 1499 -> shipping 99
    const o: any = await svc.create(null, { ...input, couponCode: ' save10 ' });
    expect(o).toMatchObject({ couponCode: 'SAVE10', discount: 100, subtotal: 1000, shipping: 99, gst: 0, total: 999 });
    expect(state.coupon.usedCount).toBe(1);
    expect(state.stock).toBe(9);
  });

  it('R19: free shipping is judged on the PRE-discount subtotal', async () => {
    // subtotal 1500 >= 1499 -> free shipping, even though 1500 - 500 = 1000 would be below the threshold
    const { svc } = makeEnv({ price: 1500, coupon: baseCoupon({ type: 'FLAT', value: 500 }) });
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(o).toMatchObject({ shipping: 0, discount: 500, total: 1000 });
  });

  it('R19: minSubtotal is judged on the pre-discount subtotal (and before shipping/GST)', async () => {
    const { svc, state } = makeEnv({ price: 900, gstRate: 18, coupon: baseCoupon({ minSubtotal: 1000 }) });
    const err = await errorOf(svc.create(null, { ...input, couponCode: 'SAVE10' }));
    expect((err.getResponse() as any).message).toBe('Add ₹100 more to use this coupon');
    expect(state.coupon.usedCount).toBe(0);
    expect(state.stock).toBe(10);
  });

  it('GST is charged on the value AFTER the discount: 1000 less 200 at 18% is 144, not 180', async () => {
    const { svc, state } = makeEnv({ price: 1000, gstRate: 18, coupon: baseCoupon({ value: 20 }) });
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(o).toMatchObject({ subtotal: 1000, discount: 200, gst: 144, shipping: 99, total: 1043 });
    expect(state.items.map((i: any) => i.gstAmount)).toEqual([144]); // the persisted line matches the order
  });

  it('without a coupon GST is unchanged (line * rate)', async () => {
    const { svc, state } = makeEnv({ price: 1000, gstRate: 18 });
    const o: any = await svc.create(null, input);
    expect(o).toMatchObject({ discount: 0, gst: 180, total: 1279 });
    expect(state.items[0].gstAmount).toBe(180);
  });

  it('zero-rate lines stay at zero GST with a coupon', async () => {
    const { svc } = makeEnv({ price: 1000, gstRate: 0, coupon: baseCoupon({ value: 20 }) });
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(o).toMatchObject({ gst: 0, total: 899 });
  });

  it('percent + maxDiscount: GST follows the capped discount', async () => {
    const { svc } = makeEnv({ price: 2000, gstRate: 5, coupon: baseCoupon({ value: 50, maxDiscount: 150 }) });
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10' });
    // taxable 2000 - 150 = 1850 -> 92.5; shipping free (>= 1499)
    expect(o).toMatchObject({ discount: 150, gst: 92.5, shipping: 0, total: 1942.5 });
  });

  it('multi-line: the discount is spread in proportion, the last line takes the rounding remainder, sums are exact', async () => {
    const products = [
      { id: 1, name: 'A', price: 333.33, stock: 99, active: true, saleMode: 'PURCHASE', gstRate: 18, minOrderQty: 1 },
      { id: 2, name: 'B', price: 333.33, stock: 99, active: true, saleMode: 'PURCHASE', gstRate: 12, minOrderQty: 1 },
      { id: 3, name: 'C', price: 333.34, stock: 99, active: true, saleMode: 'PURCHASE', gstRate: 5, minOrderQty: 1 },
    ];
    const { svc, state } = makeEnv({ products, stock: 99, coupon: baseCoupon({ type: 'FLAT', value: 100 }), settings: { 'shipping.flatRate': '0' } });
    const o: any = await svc.create(null, {
      ...input,
      couponCode: 'SAVE10',
      items: [{ productId: 1, quantity: 1 }, { productId: 2, quantity: 1 }, { productId: 3, quantity: 1 }],
    });
    // discounts 33.33 + 33.33 + 33.34 = 100; taxable 300 each; gst 54 + 36 + 15
    expect(state.items.map((i: any) => i.gstAmount)).toEqual([54, 36, 15]);
    expect(o).toMatchObject({ subtotal: 1000, discount: 100, gst: 105, total: 1005 });
    expect(state.items.reduce((s: number, i: any) => s + i.gstAmount, 0)).toBe(o.gst);
  });

  it('the minimum-total check includes the post-discount GST', async () => {
    const { svc } = makeEnv({ price: 2, gstRate: 50, settings: { 'shipping.flatRate': '0' }, coupon: baseCoupon({ type: 'FLAT', value: 1 }) });
    // 2 - 1 + gst(1 at 50%) = 1.5, allowed
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(o.total).toBe(1.5);
  });

  it('a claim lost to an expiry after the read names the real reason', async () => {
    const env = makeEnv({ price: 1000 });
    const real = env.prisma.$transaction;
    env.prisma.$transaction = jest.fn(async (fn: any) =>
      real(async (tx: any) => {
        const find = tx.coupon.findUnique;
        let first = true;
        tx.coupon.findUnique = jest.fn(async (a: any) => {
          const c = await find(a);
          if (first) {
            first = false;
            env.state.coupon.expiresAt = new Date(Date.now() - 1000);
          }
          return c;
        });
        return fn(tx);
      }),
    );
    await expect(env.svc.create(null, { ...input, couponCode: 'SAVE10' })).rejects.toThrow('Coupon expired');
    expect(env.state.coupon.usedCount).toBe(0);
  });

  it('percent cap and flat cap are respected', async () => {
    const a: any = await makeEnv({ price: 2000, coupon: baseCoupon({ value: 50, maxDiscount: 150 }) }).svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(a.discount).toBe(150);
    const b: any = await makeEnv({ price: 100, coupon: baseCoupon({ type: 'FLAT', value: 500 }) }).svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(b.discount).toBe(100);
    expect(b.total).toBe(99); // only shipping left
  });

  it('an order without a coupon is unchanged: discount 0, couponCode null', async () => {
    const { svc, state } = makeEnv({ price: 1000 });
    const o: any = await svc.create(null, input);
    expect(o).toMatchObject({ couponCode: null, discount: 0, total: 1099 });
    expect(state.coupon.usedCount).toBe(0);
    const blank: any = await svc.create(null, { ...input, couponCode: '   ' });
    expect(blank.couponCode).toBeNull();
    expect(state.coupon.usedCount).toBe(0);
  });

  it('each error branch rolls the order back (no use consumed, stock untouched) and is flagged as a coupon error', async () => {
    const cases: Array<[Record<string, unknown> | null, string]> = [
      [null, 'Coupon not found'],
      [baseCoupon({ active: false }), 'Coupon not found'],
      [baseCoupon({ expiresAt: new Date('2020-01-01') }), 'Coupon expired'],
      [baseCoupon({ maxUses: 2, usedCount: 2 }), 'Coupon usage limit reached'],
      [baseCoupon({ minSubtotal: 5000 }), 'Add ₹4000 more to use this coupon'],
    ];
    for (const [coupon, message] of cases) {
      const { svc, state } = makeEnv({ coupon, price: 1000 });
      const err = await errorOf(svc.create(null, { ...input, couponCode: 'SAVE10' }));
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any)).toMatchObject({ message, field: 'couponCode' });
      expect(state.orders).toHaveLength(0);
      expect(state.stock).toBe(10);
      if (state.coupon) expect(state.coupon.usedCount).toBe(coupon && (coupon as any).usedCount ? 2 : 0);
    }
  });

  it('a 100% coupon cannot make the total free: below Rs 1 is refused, with free shipping and no GST', async () => {
    const { svc, state } = makeEnv({ price: 2000, coupon: baseCoupon({ value: 100 }) }); // free shipping (>=1499)
    const err = await errorOf(svc.create(null, { ...input, couponCode: 'SAVE10' }));
    expect((err.getResponse() as any)).toMatchObject({ field: 'couponCode' });
    expect((err.getResponse() as any).message).toMatch(/below ₹1/);
    expect(state.orders).toHaveLength(0);
    expect(state.coupon.usedCount).toBe(0);
    expect(state.stock).toBe(10);
  });

  it('a total of exactly Rs 1 is allowed', async () => {
    const { svc } = makeEnv({ price: 2, settings: { 'shipping.flatRate': '0' }, coupon: baseCoupon({ type: 'FLAT', value: 1 }) });
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(o.total).toBe(1);
  });

  it('a total just under Rs 1 is refused', async () => {
    const { svc } = makeEnv({ price: 2, settings: { 'shipping.flatRate': '0' }, coupon: baseCoupon({ type: 'FLAT', value: 1.01 }) });
    await expect(svc.create(null, { ...input, couponCode: 'SAVE10' })).rejects.toThrow(/below ₹1/);
  });

  it('rounds discount and total to paise', async () => {
    const { svc } = makeEnv({ price: 333.33, coupon: baseCoupon({ value: 15 }), settings: { 'shipping.flatRate': '0' } });
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10' });
    expect(o.discount).toBe(50);
    expect(o.total).toBe(283.33);
  });

  it('usage race: two concurrent creates for the last use -> one order, one clear failure, loser stock restored', async () => {
    const { svc, state } = makeEnv({ price: 1000, coupon: baseCoupon({ maxUses: 1 }), raceReads: 2 });
    const results = await Promise.allSettled([
      svc.create(null, { ...input, couponCode: 'SAVE10' }),
      svc.create(null, { ...input, couponCode: 'save10' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0].reason as BadRequestException).getResponse()).toMatchObject({ message: 'Coupon usage limit reached', field: 'couponCode' });
    expect(state.coupon.usedCount).toBe(1);
    expect(state.orders).toHaveLength(1);
    expect(state.stock).toBe(9); // only the winner holds stock
  });

  it('usage race with shared stock of 1: the stock loser also leaves the coupon use untouched', async () => {
    const { svc, state } = makeEnv({ price: 1000, stock: 1, coupon: baseCoupon({ maxUses: 5 }), raceReads: 2 });
    const results = await Promise.allSettled([
      svc.create(null, { ...input, couponCode: 'SAVE10' }),
      svc.create(null, { ...input, couponCode: 'SAVE10' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(state.coupon.usedCount).toBe(1); // loser's claim was rolled back with its transaction
    expect(state.stock).toBe(0);
  });

  it('a coupon deactivated between read and claim cannot be consumed', async () => {
    const env = makeEnv({ price: 1000 });
    const real = env.prisma.$transaction;
    env.prisma.$transaction = jest.fn(async (fn: any) =>
      real(async (tx: any) => {
        const find = tx.coupon.findUnique;
        tx.coupon.findUnique = jest.fn(async (a: any) => {
          const c = await find(a);
          env.state.coupon.active = false; // admin switches it off right after we read it
          return c;
        });
        return fn(tx);
      }),
    );
    await expect(env.svc.create(null, { ...input, couponCode: 'SAVE10' })).rejects.toThrow('Coupon not found');
    expect(env.state.coupon.usedCount).toBe(0);
    expect(env.state.orders).toHaveLength(0);
  });

  it('never trusts a client subtotal: the DTO has no such field and the discount derives from DB prices', async () => {
    const { svc } = makeEnv({ price: 500, coupon: baseCoupon({ value: 10 }) });
    const o: any = await svc.create(null, { ...input, couponCode: 'SAVE10', subtotal: 99999 } as any);
    expect(o.subtotal).toBe(500);
    expect(o.discount).toBe(50);
  });
});

describe('coupon give-back on cancellation (R19)', () => {
  async function placed(over: Record<string, unknown> = {}, couponOver: Record<string, unknown> = {}) {
    const env = makeEnv({ price: 1000, coupon: baseCoupon({ maxUses: 3, ...couponOver }), ...over });
    const o: any = await env.svc.create(null, { ...input, couponCode: 'SAVE10', paymentMethod: 'COD' });
    return { ...env, id: o.id as number };
  }

  it('cancelAndRestock gives the use back once and restocks once', async () => {
    const { svc, prisma, state, id } = await placed();
    expect(state.coupon.usedCount).toBe(1);
    expect(await prisma.$transaction((tx: any) => svc.cancelAndRestock(tx, id))).toBe(true);
    expect(state.coupon.usedCount).toBe(0);
    expect(state.stock).toBe(10);
    expect(await prisma.$transaction((tx: any) => svc.cancelAndRestock(tx, id))).toBe(false);
    expect(state.coupon.usedCount).toBe(0);
  });

  it('admin cancel via updateStatus returns the use; a repeat is a no-op', async () => {
    const { svc, state, id } = await placed();
    await svc.updateStatus(id, 'CANCELLED');
    expect(state.coupon.usedCount).toBe(0);
    await svc.updateStatus(id, 'CANCELLED');
    expect(state.coupon.usedCount).toBe(0);
    expect(state.stock).toBe(10);
  });

  it('adminUpdate cancel returns the use', async () => {
    const { svc, prisma, state, id } = await placed();
    prisma.order.findUnique.mockImplementation(async ({ where }: any) => {
      const o = state.orders.find((x: any) => x.id === where.id);
      return o ? { ...o, items: [] } : null;
    });
    await svc.adminUpdate(id, { status: 'CANCELLED' });
    expect(state.coupon.usedCount).toBe(0);
  });

  it('two concurrent cancels: exactly one decrement and one restock', async () => {
    const { svc, prisma, state, id } = await placed();
    const results = await Promise.all([
      prisma.$transaction((tx: any) => svc.cancelAndRestock(tx, id)),
      prisma.$transaction((tx: any) => svc.cancelAndRestock(tx, id)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(state.coupon.usedCount).toBe(0);
    expect(state.stock).toBe(10);
  });

  it('customer/admin cancel racing the stale-order sweep: one decrement, the loser conflicts or no-ops', async () => {
    const env = makeEnv({ price: 1000, coupon: baseCoupon({ maxUses: 3 }) });
    const o: any = await env.svc.create(null, { ...input, couponCode: 'SAVE10', paymentMethod: 'RAZORPAY' });
    Object.assign(env.state.orders[0], {
      paymentMethod: 'RAZORPAY', paymentStatus: 'UNPAID', razorpayPaymentId: null, createdAt: new Date(Date.now() - 3_600_000),
    });
        const job = new StaleOrdersJob(env.prisma, env.svc);
    const [sweep, admin] = await Promise.allSettled([job.run(), env.svc.updateStatus(o.id, 'CANCELLED')]);
    expect(env.state.coupon.usedCount).toBe(0);
    expect(env.state.stock).toBe(10);
    // exactly one of them did the cancelling
    const cancelledBySweep = sweep.status === 'fulfilled' && sweep.value === 1;
    const cancelledByAdmin = admin.status === 'fulfilled';
    expect([cancelledBySweep, cancelledByAdmin].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    if (admin.status === 'rejected') expect(admin.reason).toBeInstanceOf(ConflictException);
  });

  it('stale-order sweep alone gives the use back once, and a second sweep does nothing', async () => {
    const env = makeEnv({ price: 1000, coupon: baseCoupon({ maxUses: 3 }) });
    await env.svc.create(null, { ...input, couponCode: 'SAVE10', paymentMethod: 'RAZORPAY' });
    Object.assign(env.state.orders[0], {
      paymentMethod: 'RAZORPAY', paymentStatus: 'UNPAID', razorpayPaymentId: null,
    });
    const job = new StaleOrdersJob(env.prisma, env.svc);
    expect(await job.run()).toBe(1);
    expect(env.state.coupon.usedCount).toBe(0);
    expect(await job.run()).toBe(0);
    expect(env.state.coupon.usedCount).toBe(0);
  });

  it('never drives usedCount below zero (guarded decrement)', async () => {
    const { svc, prisma, state, id } = await placed();
    state.coupon.usedCount = 0; // e.g. admin data fix
    await prisma.$transaction((tx: any) => svc.cancelAndRestock(tx, id));
    expect(state.coupon.usedCount).toBe(0);
  });

  it('give-back still works after the admin deactivated the coupon', async () => {
    const { svc, prisma, state, id } = await placed();
    state.coupon.active = false;
    await prisma.$transaction((tx: any) => svc.cancelAndRestock(tx, id));
    expect(state.coupon.usedCount).toBe(0);
  });

  it('a paid-meanwhile order is not cancelled by the sweep and keeps its use', async () => {
    const env = makeEnv({ price: 1000, coupon: baseCoupon({ maxUses: 3 }) });
    await env.svc.create(null, { ...input, couponCode: 'SAVE10', paymentMethod: 'RAZORPAY' });
    Object.assign(env.state.orders[0], { paymentMethod: 'RAZORPAY', paymentStatus: 'PAID', razorpayPaymentId: 'pay_1' });
    const job = new StaleOrdersJob(env.prisma, env.svc);
    expect(await job.run()).toBe(0);
    expect(env.state.coupon.usedCount).toBe(1);
  });

  it('orders without a coupon never touch the coupon table on cancel', async () => {
    const env = makeEnv({ price: 1000 });
    const o: any = await env.svc.create(null, input);
    env.state.coupon.usedCount = 4;
    await env.prisma.$transaction((tx: any) => env.svc.cancelAndRestock(tx, o.id));
    expect(env.state.coupon.usedCount).toBe(4);
  });
});
