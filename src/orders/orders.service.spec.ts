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
