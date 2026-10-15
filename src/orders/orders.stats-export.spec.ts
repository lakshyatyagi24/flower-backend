import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

const allowAll: any = {
  isServiceable: jest.fn(async () => true),
  validateDeliveryDate: jest.fn(async (d: string) => d),
};

function setup() {
  const findMany = jest.fn(async (_a?: any): Promise<any[]> => []);
  const count = jest.fn(async (_a?: any) => 0);
  const queryRaw = jest.fn(async (..._a: any[]): Promise<any[]> => []);
  const prisma: any = {
    order: { findMany, count, aggregate: jest.fn(async () => ({ _sum: { total: 0 } })) },
    $queryRaw: queryRaw,
    product: { count: jest.fn(async () => 0) },
    user: { count: jest.fn(async () => 0) },
    enquiry: { count: jest.fn(async () => 0) },
  };
  return { svc: new OrdersService(prisma, {} as any, allowAll), findMany, count, queryRaw };
}

const NOW = new Date('2026-10-15T20:00:00Z'); // 01:30 IST on the 16th

describe('OrdersService.stats series', () => {
  it('keeps its existing fields and adds a zero-filled 30 day series (IST) by default', async () => {
    const { svc, queryRaw } = setup();
    queryRaw.mockResolvedValue([{ date: '2026-10-16', orders: 3, revenue: 1500.5 }]);
    const res: any = await svc.stats(undefined, NOW);
    for (const k of ['orderCount', 'productCount', 'customerCount', 'revenue', 'recentOrders', 'openEnquiries']) {
      expect(res).toHaveProperty(k);
    }
    expect(res.range).toEqual({ from: '2026-09-17', to: '2026-10-16' });
    expect(res.series).toHaveLength(30);
    expect(res.series[0]).toEqual({ date: '2026-09-17', orders: 0, revenue: 0 });
    expect(res.series[29]).toEqual({ date: '2026-10-16', orders: 3, revenue: 1500.5 });
    expect(queryRaw).toHaveBeenCalledTimes(1); // ONE grouped query
  });

  it('queries IST day boundaries: [IST midnight of from, IST midnight after to) expressed in UTC', async () => {
    const { svc, queryRaw } = setup();
    await svc.stats({ from: '2026-10-01', to: '2026-10-02' }, NOW);
    const [, fromUtc, toUtc] = queryRaw.mock.calls[0];
    expect(fromUtc).toBe('2026-09-30T18:30:00.000Z');
    expect(toUtc).toBe('2026-10-02T18:30:00.000Z');
  });

  it('the SQL buckets by IST day and mirrors the revenue + cancelled rules of the all-time total', async () => {
    const { svc, queryRaw } = setup();
    await svc.stats({ from: '2026-10-01', to: '2026-10-01' }, NOW);
    const sql = (queryRaw.mock.calls[0][0] as string[]).join('?').replace(/\s+/g, ' ');
    expect(sql).toContain(`"createdAt" + interval '330 minutes'`);
    expect(sql).toContain(`"status" <> 'CANCELLED'`);
    expect(sql).toContain(`"paymentStatus" <> 'REFUNDED'`);
    expect(sql).toContain(`"paymentMethod" = 'COD' OR "paymentStatus" = 'PAID'`);
    expect(sql).toContain(`::timestamptz AT TIME ZONE 'UTC'`); // session-timezone independent bounds
    expect(sql).toContain('GROUP BY 1');
  });

  it('rounds each day revenue with the shared money helper', async () => {
    const { svc, queryRaw } = setup();
    queryRaw.mockResolvedValue([{ date: '2026-10-01', orders: 1, revenue: 100.1 + 0.2 }]);
    const res: any = await svc.stats({ from: '2026-10-01', to: '2026-10-01' }, NOW);
    expect(res.series).toEqual([{ date: '2026-10-01', orders: 1, revenue: 100.3 }]);
  });

  it.each([
    [{ from: 'nope' }], [{ to: '2026-02-30' }], [{ from: '2026-10-05', to: '2026-10-01' }], [{ from: '2024-01-01', to: '2026-01-01' }],
  ])('rejects invalid range %j before touching the database', async (range) => {
    const { svc, count, queryRaw } = setup();
    await expect(svc.stats(range as any, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(count).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('OrdersService.listAll q / exportCsv', () => {
  it('listAll ANDs the q search with attention and the other filters, and count uses the same where', async () => {
    const { svc, findMany, count } = setup();
    await svc.listAll({ q: 'asha', attention: 'refund', status: 'PAID' });
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PAID');
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual({ paymentStatus: 'PAID', status: 'CANCELLED' });
    expect(where.AND[1].OR).toContainEqual({ customerName: { contains: 'asha', mode: 'insensitive' } });
    expect(count.mock.calls[0][0].where).toEqual(where);
  });

  it('listAll q combines with sort=deliveryDate (upcoming filter + ordering kept)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-13T19:00:00Z') });
    try {
      const { svc, findMany } = setup();
      await svc.listAll({ q: '98765', sort: 'deliveryDate' });
      const args = findMany.mock.calls[0][0];
      expect(args.where.deliveryDate.gte.toISOString()).toBe('2026-10-14T00:00:00.000Z');
      expect(args.where.AND[0].OR).toContainEqual({ customerPhone: { contains: '98765' } });
      expect(args.orderBy).toEqual([{ deliveryDate: 'asc' }, { createdAt: 'desc' }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('exportCsv uses EXACTLY the where the list would, no paging, capped at 5000', async () => {
    const { svc, findMany, count } = setup();
    const filters = { q: '100%', status: 'PAID', paymentMethod: 'COD', attention: 'awaiting' };
    await svc.listAll(filters);
    const listWhere = findMany.mock.calls[0][0].where;
    findMany.mockClear();
    count.mockResolvedValue(1);
    await svc.exportCsv(filters);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual(listWhere);
    expect(count.mock.calls.at(-1)![0].where).toEqual(listWhere);
    expect(args.take).toBe(5000);
    expect(args.skip).toBeUndefined();
  });

  it('exportCsv reports truncation when more rows match than the cap', async () => {
    const { svc, count } = setup();
    count.mockResolvedValue(7000);
    const out = await svc.exportCsv({}, new Date('2026-10-15T00:00:00Z'));
    expect(out).toMatchObject({ total: 7000, exported: 0, truncated: true, filename: 'orders-2026-10-15.csv' });
    expect(out.csv.startsWith('﻿id,')).toBe(true);
    count.mockResolvedValue(0);
    expect((await svc.exportCsv({})).truncated).toBe(false);
  });
});
