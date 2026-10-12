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

describe('OrdersService.adminUpdate payment fields', () => {
  const SW = 'Switched to COD; abandoned Razorpay order order_old';
  const CAP = 'PAYMENT pay_1 CAPTURED AFTER SWITCH TO COD - REFUND';
  const MIS = 'AMOUNT MISMATCH: payment pay_2 captured 1 vs expected 2 - review/refund manually';
  function setup(over: any = {}) {
    const row: any = { id: 5, status: 'PENDING', paymentStatus: 'PAID', refundNote: null, items: [], ...over };
    const tx: any = {
      order: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const conds: any[] = where.AND ?? [where];
          const ok = conds.every((c) => (c.id === undefined || row.id === c.id) &&
            (c.paymentStatus === undefined || row.paymentStatus === c.paymentStatus) &&
            (c.refundNote === undefined || (row.refundNote ?? null) === c.refundNote) &&
            (c.status === undefined || typeof c.status !== 'string' ? c.status === undefined || row.status !== c.status.not : row.status === c.status));
          if (ok) Object.assign(row, data);
          return { count: ok ? 1 : 0 };
        }),
        update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
        findUnique: jest.fn(async () => ({ ...row })),
      },
      product: { update: jest.fn() },
      orderItem: { findMany: jest.fn(async () => []) },
    };
    const prisma: any = {
      order: { findUnique: jest.fn(async () => ({ ...row })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const mail: any = { sendOrderShipped: jest.fn(async () => undefined), sendOrderPaid: jest.fn(), sendOrderPlaced: jest.fn() };
    return { row, tx, mail, prisma, svc: new OrdersService(prisma, mail) };
  }

  it('PAID -> REFUNDED via guarded CAS (bound to the paymentStatus and note read); status untouched, no restock, no mail', async () => {
    const { svc, row, tx, mail } = setup({ status: 'CANCELLED' });
    await svc.adminUpdate(5, { paymentStatus: 'REFUNDED' });
    expect(row).toMatchObject({ paymentStatus: 'REFUNDED', status: 'CANCELLED' });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 5, paymentStatus: 'PAID', refundNote: null },
      data: { paymentStatus: 'REFUNDED' },
    });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(Object.values(mail).some((m: any) => m.mock.calls.length)).toBe(false);
  });

  it.each(['UNPAID', 'REFUNDED', 'FAILED'])('plain %s -> REFUNDED is a Conflict and writes nothing', async (ps) => {
    const { svc, row } = setup({ paymentStatus: ps, refundNote: 'keep' });
    await expect(svc.adminUpdate(5, { paymentStatus: 'REFUNDED', refundNote: 'new' })).rejects.toThrow('Only a paid order can be marked refunded');
    await expect(svc.adminUpdate(5, { paymentStatus: 'REFUNDED' })).rejects.toBeInstanceOf(ConflictException);
    expect(row).toMatchObject({ paymentStatus: ps, refundNote: 'keep' });
  });

  it.each([['CAPTURED AFTER SWITCH trace', `${SW}\n${CAP}`], ['AMOUNT MISMATCH trace', MIS]])(
    'UNPAID + %s may be marked REFUNDED (money was captured per our own trace); note kept',
    async (_n, note) => {
      const { svc, row } = setup({ paymentStatus: 'UNPAID', status: 'PENDING', refundNote: note });
      await svc.adminUpdate(5, { paymentStatus: 'REFUNDED' });
      expect(row).toMatchObject({ paymentStatus: 'REFUNDED', status: 'PENDING', refundNote: note });
    },
  );

  it('UNPAID with only the switch marker (nothing captured) is refused', async () => {
    const { svc, row } = setup({ paymentStatus: 'UNPAID', refundNote: SW });
    await expect(svc.adminUpdate(5, { paymentStatus: 'REFUNDED' })).rejects.toThrow('Only a paid order can be marked refunded');
    expect(row.paymentStatus).toBe('UNPAID');
  });

  it('refundNote edits are trimmed; empty/whitespace/null clears only the admin part', async () => {
    const a = setup();
    await a.svc.adminUpdate(5, { refundNote: '  refunded via UPI  ' });
    expect(a.row.refundNote).toBe('refunded via UPI');
    expect(a.row.paymentStatus).toBe('PAID');
    await a.svc.adminUpdate(5, { refundNote: '   ' });
    expect(a.row.refundNote).toBeNull();
    const b = setup({ refundNote: 'old' });
    await b.svc.adminUpdate(5, { refundNote: null });
    expect(b.row.refundNote).toBeNull();
    const c = setup();
    await c.svc.adminUpdate(5, { paymentStatus: 'REFUNDED', refundNote: ' done ' });
    expect(c.row).toMatchObject({ paymentStatus: 'REFUNDED', refundNote: 'done' });
  });

  it('system lines survive an admin note edit and an admin clearing the note', async () => {
    const { svc, row } = setup({ paymentStatus: 'UNPAID', refundNote: `admin old\n${SW}\n${CAP}\n${MIS}` });
    await svc.adminUpdate(5, { refundNote: 'admin new' });
    expect(row.refundNote).toBe(`admin new\n${SW}\n${CAP}\n${MIS}`);
    await svc.adminUpdate(5, { refundNote: '' });
    expect(row.refundNote).toBe(`${SW}\n${CAP}\n${MIS}`);
    await svc.adminUpdate(5, { refundNote: null });
    expect(row.refundNote).toBe(`${SW}\n${CAP}\n${MIS}`);
  });

  it('client-echoed system lines are not duplicated and forged system-looking lines are stripped', async () => {
    const { svc, row } = setup({ paymentStatus: 'UNPAID', refundNote: `${SW}\n${CAP}` });
    await svc.adminUpdate(5, { refundNote: `mine\n${SW}\n${CAP}` });
    expect(row.refundNote).toBe(`mine\n${SW}\n${CAP}`);
    await svc.adminUpdate(5, { refundNote: `hello\n${MIS}\nPAYMENT pay_forged CAPTURED AFTER SWITCH TO COD - REFUND` });
    expect(row.refundNote).toBe(`hello\n${SW}\n${CAP}`);
    const plain = setup({ refundNote: null });
    await plain.svc.adminUpdate(5, { refundNote: `${MIS}` });
    expect(plain.row.refundNote).toBeNull();
  });

  it('a note changed between read and write (CAS count 0) -> 409 and the concurrent line is kept', async () => {
    const { svc, row, tx, prisma } = setup({ paymentStatus: 'UNPAID', refundNote: SW });
    // the admin read saw SW; a webhook appends CAP before the admin's write lands
    const stale = { ...row };
    prisma.order.findUnique.mockImplementationOnce(async () => stale);
    row.refundNote = `${SW}\n${CAP}`;
    await expect(svc.adminUpdate(5, { refundNote: 'late edit' })).rejects.toThrow('The note was changed meanwhile - reload and try again');
    expect(row.refundNote).toBe(`${SW}\n${CAP}`);
    await expect(svc.adminUpdate(5, { refundNote: 'late edit' })).resolves.toBeDefined(); // fresh read now succeeds
    expect(row.refundNote).toBe(`late edit\n${SW}\n${CAP}`);
    expect(tx.order.updateMany).toHaveBeenCalledTimes(2);
  });

  it('REFUNDED flip combined with a status change keeps the status transition rules', async () => {
    const { svc, row } = setup({ status: 'PENDING' });
    await svc.adminUpdate(5, { paymentStatus: 'REFUNDED', status: 'CANCELLED' });
    expect(row).toMatchObject({ paymentStatus: 'REFUNDED', status: 'CANCELLED' });
  });
});

describe('OrdersService.listAll / stats payment filters', () => {
  function setup() {
    const count = jest.fn(async (_a?: any) => 0);
    const findMany = jest.fn(async (_a?: any) => []);
    const prisma: any = {
      order: { findMany, count, aggregate: jest.fn(async () => ({ _sum: { total: 0 } })) },
      product: { count: jest.fn(async () => 0) },
      user: { count: jest.fn(async () => 0) },
      enquiry: { count: jest.fn(async () => 0) },
    };
    return { svc: new OrdersService(prisma, {} as any), findMany, count };
  }
  const whereOf = (findMany: jest.Mock) => findMany.mock.calls[0][0].where;

  it('builds where for paymentStatus and paymentMethod; ignores invalid values', async () => {
    const { svc, findMany } = setup();
    await svc.listAll({ paymentStatus: 'REFUNDED', paymentMethod: 'COD' } as any);
    expect(whereOf(findMany)).toEqual({ paymentStatus: 'REFUNDED', paymentMethod: 'COD' });
    findMany.mockClear();
    await svc.listAll({ paymentStatus: 'nope', paymentMethod: 'CASH', attention: 'bogus', status: 'x' } as any);
    expect(whereOf(findMany)).toEqual({});
  });

  it.each([
    ['refund', { paymentStatus: 'PAID', status: 'CANCELLED' }],
    ['mismatch', {
      OR: [{ refundNote: { contains: 'AMOUNT MISMATCH' } }, { refundNote: { contains: 'CAPTURED AFTER SWITCH' } }],
      paymentStatus: { not: 'REFUNDED' },
    }],
    ['awaiting', { paymentMethod: 'RAZORPAY', paymentStatus: { in: ['UNPAID', 'FAILED'] }, status: 'PENDING' }],
  ])('attention=%s builds the expected condition (ANDed with other filters) and count uses the same where', async (a, cond) => {
    const { svc, findMany, count } = setup();
    await svc.listAll({ attention: a, status: 'PENDING' } as any);
    expect(whereOf(findMany)).toEqual({ status: 'PENDING', AND: [cond] });
    expect(count.mock.calls[0][0].where).toEqual(whereOf(findMany));
  });

  it('keeps take/skip clamping', async () => {
    const { svc } = setup();
    await expect(svc.listAll({ take: 9999, skip: -5 } as any)).resolves.toMatchObject({ take: 200, skip: 0 });
  });

  it('stats exposes unpaidOnline, refundsDue and mismatches using exactly the list criteria (key order irrelevant)', async () => {
    const { svc, count } = setup();
    const { isDeepStrictEqual } = require('util');
    const sortOr = (w: any): any =>
      w.OR ? { ...w, OR: [...w.OR].sort((x: any, y: any) => JSON.stringify(x).localeCompare(JSON.stringify(y))) } : w;
    const answers: [any, number][] = [
      [{ paymentStatus: { in: ['UNPAID', 'FAILED'] }, status: 'PENDING', paymentMethod: 'RAZORPAY' }, 3],
      [{ status: 'CANCELLED', paymentStatus: 'PAID' }, 4],
      [{
        paymentStatus: { not: 'REFUNDED' },
        OR: [{ refundNote: { contains: 'CAPTURED AFTER SWITCH' } }, { refundNote: { contains: 'AMOUNT MISMATCH' } }],
      }, 5],
    ];
    count.mockImplementation(async (a: any) => {
      const hit = answers.find(([w]) => a?.where && isDeepStrictEqual(sortOr(a.where), sortOr(w)));
      return hit ? hit[1] : 0;
    });
    const res: any = await svc.stats();
    expect(res).toMatchObject({ unpaidOnline: 3, refundsDue: 4, mismatches: 5 });
    for (const k of ['orderCount', 'productCount', 'customerCount', 'revenue', 'recentOrders', 'openEnquiries']) {
      expect(res).toHaveProperty(k);
    }
  });

  it('stats counts reuse the exact attention where-shapes used by the list', async () => {
    const { svc, count, findMany } = setup();
    const wheres: any[] = [];
    for (const a of ['refund', 'mismatch', 'awaiting']) {
      findMany.mockClear();
      await svc.listAll({ attention: a } as any);
      wheres.push(findMany.mock.calls[0][0].where.AND[0]);
    }
    count.mockClear();
    await svc.stats();
    const used = count.mock.calls.map((c: any[]) => JSON.stringify(c[0]?.where));
    for (const w of wheres) expect(used).toContain(JSON.stringify(w));
  });
});

describe('OrdersService.switchToCod abandoned-order marker', () => {
  function setup(order: any) {
    const matches = (where: any) =>
      Object.entries(where).every(([k, v]: [string, any]) =>
        v && typeof v === 'object' && 'in' in v ? v.in.includes(order[k]) : (order[k] ?? null) === v,
      );
    const prisma: any = {
      order: {
        findUnique: jest.fn(async () => ({ ...order })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ok = matches(where);
          if (ok) Object.assign(order, data);
          return { count: ok ? 1 : 0 };
        }),
      },
    };
    return { svc: new OrdersService(prisma, { sendOrderPlaced: jest.fn(async () => undefined) } as any), prisma };
  }
  const base = (over: any = {}) => ({
    id: 5, userId: null, status: 'PENDING', paymentStatus: 'UNPAID', paymentMethod: 'RAZORPAY',
    razorpayOrderId: 'order_old', razorpayPaymentId: null, customerEmail: 'c@x.com', refundNote: null, items: [], ...over,
  });

  it('writes the marker with the abandoned razorpay order id', async () => {
    const order = base();
    await setup(order).svc.switchToCod(5, null, 'c@x.com');
    expect(order.refundNote).toBe('Switched to COD; abandoned Razorpay order order_old');
    expect(order.razorpayOrderId).toBeNull();
  });

  it('appends to (never clobbers) an existing refundNote with a newline', async () => {
    const order = base({ refundNote: 'owner note' });
    await setup(order).svc.switchToCod(5, null, 'c@x.com');
    expect(order.refundNote).toBe('owner note\nSwitched to COD; abandoned Razorpay order order_old');
  });

  it('the CAS is bound to the id and note it read; a concurrent change retries with fresh values', async () => {
    const order: any = base();
    const { svc, prisma } = setup(order);
    const real = prisma.order.updateMany.getMockImplementation()!;
    let first = true;
    prisma.order.updateMany.mockImplementation(async (args: any) => {
      if (first) { first = false; order.razorpayOrderId = 'order_new'; } // createRazorpayOrder raced in
      return real(args);
    });
    await svc.switchToCod(5, null, 'c@x.com');
    expect(order.refundNote).toBe('Switched to COD; abandoned Razorpay order order_new');
    expect(prisma.order.updateMany.mock.calls[0][0].where).toMatchObject({ razorpayOrderId: 'order_old', refundNote: null });
  });

  it('second call does not append again', async () => {
    const order = base();
    const { svc } = setup(order);
    await svc.switchToCod(5, null, 'c@x.com');
    const note = order.refundNote;
    await svc.switchToCod(5, null, 'c@x.com');
    expect(order.refundNote).toBe(note);
  });
});
