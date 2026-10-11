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
