import { Logger } from '@nestjs/common';
import { StaleOrdersJob } from './stale-orders.job';

const NOW = new Date('2026-10-11T10:00:00Z');
const GUARD = {
  status: 'PENDING',
  paymentMethod: 'RAZORPAY',
  paymentStatus: { in: ['UNPAID', 'FAILED'] },
  razorpayPaymentId: null,
};

function make(candidates: Array<{ id: number }>, cancel?: (id: number) => Promise<boolean>) {
  const tx = { marker: 'tx' };
  const prisma: any = {
    order: { findMany: jest.fn(async () => candidates) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const orders: any = {
    cancelAndRestock: jest.fn(async (_tx: any, id: number) => (cancel ? cancel(id) : true)),
  };
  return { prisma, orders, tx, job: new StaleOrdersJob(prisma, orders) };
}

describe('StaleOrdersJob', () => {
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  const savedEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production-like'; // jest sets 'test', which disables tick()
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
    jest.restoreAllMocks();
  });

  it('tick does nothing under NODE_ENV=test and runs the sweep otherwise', async () => {
    const { job, prisma } = make([]);
    process.env.NODE_ENV = 'test';
    await job.tick();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'production';
    await job.tick();
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });

  it('TTL is 30 minutes', () => {
    expect(StaleOrdersJob.TTL_MS).toBe(30 * 60 * 1000);
  });

  it('selects exactly the stale unpaid online orders', async () => {
    const { job, prisma } = make([]);
    await job.run(NOW);
    const arg = prisma.order.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ ...GUARD, createdAt: { lt: new Date('2026-10-11T09:30:00.000Z') } });
    expect(arg.select).toEqual({ id: true });
  });

  it('cancels each candidate in its own transaction re-asserting the same criteria; returns the count', async () => {
    const { job, prisma, orders, tx } = make([{ id: 1 }, { id: 2 }]);
    await expect(job.run(NOW)).resolves.toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(orders.cancelAndRestock).toHaveBeenNthCalledWith(1, tx, 1, GUARD);
    expect(orders.cancelAndRestock).toHaveBeenNthCalledWith(2, tx, 2, GUARD);
  });

  it('does not count orders whose guarded cancel returned false (e.g. paid in between)', async () => {
    const { job } = make([{ id: 1 }, { id: 2 }, { id: 3 }], async (id) => id !== 2);
    await expect(job.run(NOW)).resolves.toBe(2);
  });

  it('payment confirmed between select and cancel: guarded write matches 0 rows -> no restock, count 0', async () => {
    const stock = { n: 10 };
    const tx: any = {
      order: { updateMany: jest.fn(async () => ({ count: 0 })) },
      orderItem: { findMany: jest.fn(async () => [{ productId: 1, quantity: 2 }]) },
      product: { update: jest.fn(async () => { stock.n += 2; }) },
    };
    const prisma: any = {
      order: { findMany: jest.fn(async () => [{ id: 9 }]) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    // Real cancelAndRestock against the fake tx.
    const { OrdersService } = jest.requireActual('../orders/orders.service');
    const job = new StaleOrdersJob(prisma, new OrdersService(prisma, {} as any));
    await expect(job.run(NOW)).resolves.toBe(0);
    expect(tx.order.updateMany.mock.calls[0][0].where).toEqual({ AND: [{ id: 9, status: { not: 'CANCELLED' } }, GUARD] });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(stock.n).toBe(10);
  });

  it('one failing order does not stop the others; logs only id and message', async () => {
    const { job, orders } = make([{ id: 1 }, { id: 2 }, { id: 3 }], async (id) => {
      if (id === 2) throw Object.assign(new Error('db down'), { secret: 'SECRET-DETAIL' });
      return true;
    });
    await expect(job.run(NOW)).resolves.toBe(2);
    expect(orders.cancelAndRestock).toHaveBeenCalledTimes(3);
    expect(errSpy).toHaveBeenCalledTimes(1);
    const msg = String(errSpy.mock.calls[0][0]);
    expect(msg).toContain('2');
    expect(msg).toContain('db down');
    expect(msg).not.toContain('SECRET-DETAIL');
  });

  it('tick logs only when something was cancelled', async () => {
    const a = make([]);
    await a.job.tick();
    expect(logSpy).not.toHaveBeenCalled();
    const b = make([{ id: 1 }, { id: 2 }]);
    await b.job.tick();
    expect(logSpy).toHaveBeenCalledWith('auto-cancelled 2 stale unpaid orders');
  });

  it('tick never throws, even if the select itself fails', async () => {
    const { job, prisma } = make([]);
    prisma.order.findMany.mockRejectedValue(new Error('conn lost'));
    await expect(job.tick()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
