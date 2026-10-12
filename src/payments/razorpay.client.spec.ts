import { RazorpaySdkClient } from './razorpay.client';

describe('RazorpaySdkClient', () => {
  it('creates orders with payment_capture: true so capture never depends on a dashboard setting', async () => {
    const create = jest.fn(async () => ({ id: 'order_1' }));
    const client = new RazorpaySdkClient();
    (client as any).sdk = { orders: { create } }; // inject a fake SDK
    await expect(client.createOrder(124950, 'order_7')).resolves.toEqual({ id: 'order_1' });
    expect(create).toHaveBeenCalledWith({ amount: 124950, currency: 'INR', receipt: 'order_7', payment_capture: true });
  });
});
