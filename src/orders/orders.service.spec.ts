import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

function makeFakes(existingStatus = 'PAID') {
  const order = {
    id: 5, status: existingStatus, customerEmail: 'c@x.com', customerName: 'C', total: 100, subtotal: 100,
    shipping: 0, gst: 0, paymentMethod: 'COD', items: [],
  };
  const tx = {
    product: { updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn() },
    orderItem: { findMany: jest.fn(async () => []) },
    order: {
      create: jest.fn(async () => ({ ...order, status: 'PENDING' })),
      update: jest.fn(async ({ data }: any) => ({ ...order, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => ({ ...order, status: 'CANCELLED' })),
    },
  };
  const prisma: any = {
    product: {
      findMany: jest.fn(async () => [
        { id: 1, name: 'Rose', price: 100, stock: 10, active: true, saleMode: 'PURCHASE', gstRate: 0, minOrderQty: 1 },
      ]),
    },
    setting: { findUnique: jest.fn(async () => null) },
    user: { findUnique: jest.fn(async () => null) },
    order: { findUnique: jest.fn(async () => ({ ...order })) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const mail: any = {
    sendOrderPlaced: jest.fn(async () => undefined),
    sendOrderShipped: jest.fn(async () => undefined),
  };
  return { prisma, mail, svc: new OrdersService(prisma, mail) };
}

const input = {
  items: [{ productId: 1, quantity: 1 }], customerName: 'C', customerEmail: 'c@x.com',
  customerPhone: '9876543210', shippingAddress: '1 Road', city: 'Delhi', postalCode: '110001',
};

describe('OrdersService mail hooks', () => {
  it('create sends order-placed once with the created order', async () => {
    const { svc, mail } = makeFakes();
    const created = await svc.create(null, input);
    expect(mail.sendOrderPlaced).toHaveBeenCalledTimes(1);
    expect(mail.sendOrderPlaced).toHaveBeenCalledWith(created);
  });

  it('create does NOT send order-placed for a RAZORPAY order (unpaid until verified)', async () => {
    const { svc, mail } = makeFakes();
    await svc.create(null, { ...input, paymentMethod: 'RAZORPAY' });
    expect(mail.sendOrderPlaced).not.toHaveBeenCalled();
  });

  it('create still sends order-placed for an explicit COD order', async () => {
    const { svc, mail } = makeFakes();
    await svc.create(null, { ...input, paymentMethod: 'COD' });
    expect(mail.sendOrderPlaced).toHaveBeenCalledTimes(1);
  });

  it('track strips internal and payment reference fields from the public response', async () => {
    const { svc, prisma } = makeFakes();
    prisma.order.findUnique.mockResolvedValue({
      id: 5, customerEmail: 'c@x.com', adminNotes: 'secret', razorpayOrderId: 'order_1',
      razorpayPaymentId: 'pay_1', refundNote: 'refund me', paymentStatus: 'PAID', status: 'PAID', items: [],
    });
    const res: any = await svc.track(5, 'C@x.com');
    expect(res).not.toHaveProperty('adminNotes');
    expect(res).not.toHaveProperty('razorpayOrderId');
    expect(res).not.toHaveProperty('razorpayPaymentId');
    expect(res).not.toHaveProperty('refundNote');
    expect(res.paymentStatus).toBe('PAID');
  });

  it('getMine and listMine never expose refundNote but keep razorpayOrderId', async () => {
    const { svc, prisma } = makeFakes();
    const row = { id: 5, userId: 9, razorpayOrderId: 'order_1', refundNote: 'x', items: [] };
    prisma.order.findUnique.mockResolvedValue(row);
    prisma.order.findMany = jest.fn(async () => [row]);
    const one: any = await svc.getMine(9, 5);
    expect(one).not.toHaveProperty('refundNote');
    expect(one.razorpayOrderId).toBe('order_1');
    const list: any = await svc.listMine(9);
    expect(list[0]).not.toHaveProperty('refundNote');
  });

  it('create does not fail when the mail promise rejects', async () => {
    const { svc, mail } = makeFakes();
    mail.sendOrderPlaced.mockRejectedValue(new Error('boom'));
    await expect(svc.create(null, input)).resolves.toMatchObject({ id: 5 });
  });

  it('updateStatus to SHIPPED sends shipped mail once', async () => {
    const { svc, mail } = makeFakes('PAID');
    await svc.updateStatus(5, 'SHIPPED');
    expect(mail.sendOrderShipped).toHaveBeenCalledTimes(1);
  });

  it('updateStatus to the same status sends nothing', async () => {
    const { svc, mail } = makeFakes('SHIPPED');
    await svc.updateStatus(5, 'SHIPPED');
    expect(mail.sendOrderShipped).not.toHaveBeenCalled();
  });

  it('updateStatus to a non-SHIPPED status sends nothing', async () => {
    const { svc, mail } = makeFakes('PENDING');
    await svc.updateStatus(5, 'PAID');
    expect(mail.sendOrderShipped).not.toHaveBeenCalled();
  });

  it('adminUpdate sends shipped mail only on an actual change to SHIPPED', async () => {
    const a = makeFakes('PAID');
    await a.svc.adminUpdate(5, { status: 'SHIPPED', trackingNumber: 'T1' });
    expect(a.mail.sendOrderShipped).toHaveBeenCalledTimes(1);
    const b = makeFakes('SHIPPED');
    await b.svc.adminUpdate(5, { status: 'SHIPPED', trackingNumber: 'T2' });
    expect(b.mail.sendOrderShipped).not.toHaveBeenCalled();
  });
});

/** Stateful fake: status flips only through the guarded updateMany, stock only via increment. */
function makeCancelFakes(status = 'PAID', items: any[] = [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 3 }]) {
  const state = { status };
  const stock: Record<number, number> = { 1: 10, 2: 10 };
  const tx: any = {
    orderItem: { findMany: jest.fn(async () => items) },
    product: {
      update: jest.fn(async ({ where, data }: any) => {
        stock[where.id] += data.stock.increment;
        return {};
      }),
    },
    order: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const conds: any[] = where.AND ?? [where];
        const ok = conds.every((c) => {
          if (c.status === undefined) return true;
          if (typeof c.status === 'string') return state.status === c.status;
          return state.status !== c.status.not;
        });
        if (ok && data.status) state.status = data.status;
        return { count: ok ? 1 : 0 };
      }),
      update: jest.fn(async ({ data }: any) => ({ id: 5, ...data, status: data.status ?? state.status })),
      findUnique: jest.fn(async () => ({ id: 5, status: state.status })),
    },
  };
  const prisma: any = {
    order: { findUnique: jest.fn(async () => ({ id: 5, status: state.status })) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const mail: any = { sendOrderShipped: jest.fn(async () => undefined) };
  return { svc: new OrdersService(prisma, mail), tx, stock, state };
}

describe('OrdersService.cancelAndRestock', () => {
  it('guards the status write, restocks all items once when count===1, returns true', async () => {
    const { svc, tx, stock } = makeCancelFakes('PENDING');
    await expect(svc.cancelAndRestock(tx, 5)).resolves.toBe(true);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { AND: [{ id: 5, status: { not: 'CANCELLED' } }, {}] },
      data: { status: 'CANCELLED' },
    });
    expect(stock).toEqual({ 1: 12, 2: 13 });
  });

  it('merges extraWhere into the guarded write', async () => {
    const { svc, tx } = makeCancelFakes('PENDING');
    await svc.cancelAndRestock(tx, 5, { paymentStatus: 'UNPAID' });
    expect(tx.order.updateMany.mock.calls[0][0].where).toEqual({
      AND: [{ id: 5, status: { not: 'CANCELLED' } }, { paymentStatus: 'UNPAID' }],
    });
  });

  it('restocks nothing and returns false when already cancelled', async () => {
    const { svc, tx, stock } = makeCancelFakes('CANCELLED');
    await expect(svc.cancelAndRestock(tx, 5)).resolves.toBe(false);
    expect(tx.orderItem.findMany).not.toHaveBeenCalled();
    expect(stock).toEqual({ 1: 10, 2: 10 });
  });

  it('restocks nothing when the guarded write matches no row (extraWhere no longer true)', async () => {
    const { svc, tx, stock } = makeCancelFakes('PAID');
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.cancelAndRestock(tx, 5, { status: 'PENDING' })).resolves.toBe(false);
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(stock).toEqual({ 1: 10, 2: 10 });
  });

  it('skips items without a productId', async () => {
    const { svc, tx, stock } = makeCancelFakes('PENDING', [{ productId: null, quantity: 4 }, { productId: 1, quantity: 1 }]);
    await svc.cancelAndRestock(tx, 5);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(stock).toEqual({ 1: 11, 2: 10 });
  });
});

describe('OrdersService cancel via updateStatus/adminUpdate', () => {
  it('updateStatus to CANCELLED restocks exactly once; a repeat does not restock again', async () => {
    const { svc, stock } = makeCancelFakes('PAID');
    await svc.updateStatus(5, 'CANCELLED');
    expect(stock).toEqual({ 1: 12, 2: 13 });
    await svc.updateStatus(5, 'CANCELLED');
    expect(stock).toEqual({ 1: 12, 2: 13 });
  });

  it('updateStatus loses a race to a concurrent cancel: Conflict, restocks nothing', async () => {
    const { svc, tx, stock } = makeCancelFakes('PAID');
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.updateStatus(5, 'CANCELLED')).rejects.toBeInstanceOf(ConflictException);
    expect(stock).toEqual({ 1: 10, 2: 10 });
  });

  it('adminUpdate cancel restocks once; admin cancel of an already-CANCELLED order is a validation no-op', async () => {
    const { svc, stock } = makeCancelFakes('PAID');
    await svc.adminUpdate(5, { status: 'CANCELLED', adminNotes: 'x' });
    expect(stock).toEqual({ 1: 12, 2: 13 });
    await svc.adminUpdate(5, { status: 'CANCELLED' });
    expect(stock).toEqual({ 1: 12, 2: 13 });
  });

  it('adminUpdate loses a race to a concurrent cancel: Conflict, restocks nothing', async () => {
    const { svc, tx, stock } = makeCancelFakes('PAID');
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.adminUpdate(5, { status: 'CANCELLED' })).rejects.toBeInstanceOf(ConflictException);
    expect(stock).toEqual({ 1: 10, 2: 10 });
  });
});

describe('OrdersService guarded status transitions (stale read)', () => {
  /** Orders read says PENDING, but the DB row was already cancelled+restocked by the job. */
  function staleRead() {
    const f = makeCancelFakes('CANCELLED');
    f.svc['prisma'].order.findUnique = jest.fn(async () => ({ id: 5, status: 'PENDING' }));
    return f;
  }

  it.each(['SHIPPED', 'PAID'])('updateStatus PENDING->%s on a row cancelled meanwhile: Conflict, no mail, no restock, stays CANCELLED', async (to) => {
    const { svc, tx, stock, state } = staleRead();
    const mail = (svc as any).mail;
    await expect(svc.updateStatus(5, to)).rejects.toBeInstanceOf(ConflictException);
    expect(mail.sendOrderShipped).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(state.status).toBe('CANCELLED');
    expect(stock).toEqual({ 1: 10, 2: 10 });
  });

  it('adminUpdate PENDING->SHIPPED on a row cancelled meanwhile: Conflict, no mail, stays CANCELLED', async () => {
    const { svc, state } = staleRead();
    await expect(svc.adminUpdate(5, { status: 'SHIPPED', trackingNumber: 'T' })).rejects.toBeInstanceOf(ConflictException);
    expect((svc as any).mail.sendOrderShipped).not.toHaveBeenCalled();
    expect(state.status).toBe('CANCELLED');
  });

  it('cancel with a stale from (another admin completed it) is a Conflict and restocks nothing', async () => {
    const f = makeCancelFakes('COMPLETED');
    f.svc['prisma'].order.findUnique = jest.fn(async () => ({ id: 5, status: 'SHIPPED' }));
    await expect(f.svc.updateStatus(5, 'CANCELLED')).rejects.toBeInstanceOf(ConflictException);
    expect(f.state.status).toBe('COMPLETED');
    expect(f.stock).toEqual({ 1: 10, 2: 10 });
  });

  it('adminUpdate without a status change stays unguarded and works', async () => {
    const { svc, tx } = makeCancelFakes('CANCELLED');
    await expect(svc.adminUpdate(5, { trackingNumber: 'X' })).resolves.toBeDefined();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalled();
  });
});

describe('OrdersService.switchToCod', () => {
  const rzpOrder = (over: any = {}) => ({
    id: 5, userId: null, status: 'PENDING', paymentStatus: 'UNPAID', paymentMethod: 'RAZORPAY',
    razorpayOrderId: 'order_x', razorpayPaymentId: null, customerEmail: 'c@x.com', refundNote: 'owner note', items: [], ...over,
  });
  function setup(order: any) {
    const matches = (where: any) =>
      Object.entries(where).every(([k, v]: [string, any]) =>
        v && typeof v === 'object' && 'in' in v ? v.in.includes(order[k]) : (order[k] ?? null) === v,
      );
    const prisma: any = {
      order: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === order.id ? { ...order } : null)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ok = order.id === where.id && matches(where);
          if (ok) Object.assign(order, data);
          return { count: ok ? 1 : 0 };
        }),
      },
    };
    const mail: any = { sendOrderPlaced: jest.fn(async () => undefined) };
    return { svc: new OrdersService(prisma, mail), prisma, mail };
  }

  it('success: CAS switch, nulls razorpayOrderId, one placed mail, customer-safe shape', async () => {
    const order = rzpOrder();
    const { svc, mail } = setup(order);
    const res: any = await svc.switchToCod(5, null, 'C@X.com');
    expect(order).toMatchObject({ paymentMethod: 'COD', razorpayOrderId: null, paymentStatus: 'UNPAID' });
    expect(mail.sendOrderPlaced).toHaveBeenCalledTimes(1);
    expect(res.paymentMethod).toBe('COD');
    expect(res).not.toHaveProperty('refundNote');
    expect(res.razorpayOrderId ?? null).toBeNull();
  });

  it('FAILED payment status can switch too and resets to UNPAID', async () => {
    const order = rzpOrder({ paymentStatus: 'FAILED' });
    await setup(order).svc.switchToCod(5, null, 'c@x.com');
    expect(order).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'UNPAID' });
  });

  it('second call is idempotent: 200-shape result, no second mail', async () => {
    const { svc, mail } = setup(rzpOrder());
    await svc.switchToCod(5, null, 'c@x.com');
    const again: any = await svc.switchToCod(5, null, 'c@x.com');
    expect(again.paymentMethod).toBe('COD');
    expect(mail.sendOrderPlaced).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['paid', { paymentStatus: 'PAID', status: 'PAID' }],
    ['has a payment id', { razorpayPaymentId: 'pay_1' }],
    ['cancelled', { status: 'CANCELLED' }],
    ['shipped', { status: 'SHIPPED' }],
  ])('409 when %s, no mail, order untouched', async (_n, over) => {
    const order = rzpOrder(over);
    const { svc, mail } = setup(order);
    await expect(svc.switchToCod(5, null, 'c@x.com')).rejects.toThrow(ConflictException);
    await expect(svc.switchToCod(5, null, 'c@x.com')).rejects.toThrow('Order can no longer be switched to cash on delivery');
    expect(order.paymentMethod).toBe('RAZORPAY');
    expect(mail.sendOrderPlaced).not.toHaveBeenCalled();
  });

  it('403 for unknown order, wrong/missing guest email, and logged-in non-owner', async () => {
    const { svc, mail } = setup(rzpOrder({ userId: null }));
    await expect(svc.switchToCod(999, null, 'c@x.com')).rejects.toThrow(ForbiddenException);
    await expect(svc.switchToCod(5, null, 'other@x.com')).rejects.toThrow('Not your order');
    await expect(svc.switchToCod(5, null, null)).rejects.toThrow(ForbiddenException);
    const owned = setup(rzpOrder({ userId: 3 }));
    await expect(owned.svc.switchToCod(5, 4, 'c@x.com')).rejects.toThrow(ForbiddenException);
    await expect(owned.svc.switchToCod(5, 3, null)).resolves.toMatchObject({ paymentMethod: 'COD' });
    expect(mail.sendOrderPlaced).not.toHaveBeenCalled();
  });
});
