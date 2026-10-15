import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { NOT_A_BUYER_MESSAGE, ReviewsService } from './reviews.service';

type Row = { id: number; productId: number; userId: number; rating: number; title: string | null; body: string; status: string; createdAt: Date; updatedAt: Date };

function makeService(opts: { orders?: Array<{ userId: number; status: string; productIds: number[] }>; reviews?: Row[]; mailThrows?: boolean } = {}) {
  const orders = opts.orders ?? [];
  const reviews: Row[] = [...(opts.reviews ?? [])];
  let nextId = 100;
  const withUser = (r: Row) => ({ ...r, user: { id: r.userId, name: 'Asha' } });
  const prisma: any = {
    product: { findUnique: jest.fn(async ({ where }: any) => (where.id === 404 ? null : { id: where.id, name: 'Rose <b>Box</b>' })) },
    order: {
      count: jest.fn(async ({ where }: any) =>
        orders.filter((o) => o.userId === where.userId && o.status === where.status && o.productIds.includes(where.items.some.productId)).length,
      ),
    },
    review: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.productId_userId
          ? ((r) => (r ? withUser(r) : null))(reviews.find((x) => x.productId === where.productId_userId.productId && x.userId === where.productId_userId.userId))
          : ((r) => (r ? withUser(r) : null))(reviews.find((x) => x.id === where.id)),
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => withUser(reviews.find((x) => x.id === where.id)!)),
      findMany: jest.fn(async ({ where }: any) => reviews.filter((r) => r.productId === where.productId && (!where.status || r.status === where.status)).map(withUser)),
      count: jest.fn(async ({ where }: any) => reviews.filter((r) => r.productId === where.productId && (!where.status || r.status === where.status)).length),
      aggregate: jest.fn(async ({ where }: any) => {
        const rs = reviews.filter((r) => r.productId === where.productId && (!where.status || r.status === where.status)).map((r) => r.rating);
        return { _avg: { rating: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null } };
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.productId_userId;
        const ex = reviews.find((x) => x.productId === k.productId && x.userId === k.userId);
        if (ex) { Object.assign(ex, update); return withUser(ex); }
        const row: Row = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...create };
        reviews.push(row);
        return withUser(row);
      }),
      update: jest.fn(async ({ where, data }: any) => { const r = reviews.find((x) => x.id === where.id)!; Object.assign(r, data); return withUser(r); }),
      delete: jest.fn(async ({ where }: any) => { reviews.splice(reviews.findIndex((x) => x.id === where.id), 1); }),
      groupBy: jest.fn(async () => {
        const g = new Map<string, number>();
        for (const r of reviews) g.set(r.status, (g.get(r.status) ?? 0) + 1);
        return [...g].map(([status, n]) => ({ status, _count: { _all: n } }));
      }),
    },
  };
  const mail: any = { sendReviewPending: jest.fn(async () => { if (opts.mailThrows) throw new Error('smtp down'); }) };
  return { svc: new ReviewsService(prisma, mail), prisma, mail, reviews };
}

const row = (o: Partial<Row>): Row => ({ id: 1, productId: 7, userId: 1, rating: 5, title: null, body: 'Lovely flowers indeed', status: 'APPROVED', createdAt: new Date(), updatedAt: new Date(), ...o });
const input = { rating: 5, title: 'Great', body: 'Lovely fresh flowers!' };

describe('ReviewsService buyer gate', () => {
  it('403 when the user has no order for the product', async () => {
    const { svc } = makeService();
    await expect(svc.upsertForProduct(7, 1, input)).rejects.toThrow(new ForbiddenException(NOT_A_BUYER_MESSAGE));
    expect(NOT_A_BUYER_MESSAGE).toBe('Only customers who received this product can review it');
  });
  it.each(['PENDING', 'PAID', 'SHIPPED', 'CANCELLED'])('403 when the order is %s (not COMPLETED)', async (status) => {
    const { svc } = makeService({ orders: [{ userId: 1, status, productIds: [7] }] });
    await expect(svc.upsertForProduct(7, 1, input)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('403 when only ANOTHER user has a completed order for it', async () => {
    const { svc } = makeService({ orders: [{ userId: 2, status: 'COMPLETED', productIds: [7] }] });
    await expect(svc.upsertForProduct(7, 1, input)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('403 when the completed order contains a different product', async () => {
    const { svc } = makeService({ orders: [{ userId: 1, status: 'COMPLETED', productIds: [8] }] });
    await expect(svc.upsertForProduct(7, 1, input)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows a COMPLETED order and creates the review as PENDING', async () => {
    const { svc, prisma } = makeService({ orders: [{ userId: 1, status: 'COMPLETED', productIds: [7] }] });
    const r = await svc.upsertForProduct(7, 1, input);
    expect(r.status).toBe('PENDING');
    expect(prisma.review.upsert.mock.calls[0][0].create.status).toBe('PENDING');
  });
  it('404 for an unknown product before the gate', async () => {
    const { svc } = makeService();
    await expect(svc.upsertForProduct(404, 1, input)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('validation runs first (rating / lengths)', async () => {
    const { svc } = makeService({ orders: [{ userId: 1, status: 'COMPLETED', productIds: [7] }] });
    await expect(svc.upsertForProduct(7, 1, { ...input, rating: 6 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertForProduct(7, 1, { ...input, body: 'x'.repeat(1001) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertForProduct(7, 1, { ...input, title: 'x'.repeat(101) })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('eligibility reports canReview and hasReview', async () => {
    const { svc } = makeService({ orders: [{ userId: 1, status: 'COMPLETED', productIds: [7] }], reviews: [row({ userId: 1 })] });
    expect(await svc.eligibility(7, 1)).toEqual({ canReview: true, hasReview: true });
    expect(await svc.eligibility(7, 2)).toEqual({ canReview: false, hasReview: false });
  });
});

describe('ReviewsService edit semantics', () => {
  const bought = [{ userId: 1, status: 'COMPLETED', productIds: [7] }];
  it('editing an APPROVED review through the form sets it back to PENDING and notifies', async () => {
    const { svc, mail } = makeService({ orders: bought, reviews: [row({ status: 'APPROVED' })] });
    const r = await svc.upsertForProduct(7, 1, { rating: 4, title: null, body: 'Changed my mind about these' });
    expect(r.status).toBe('PENDING');
    expect(mail.sendReviewPending).toHaveBeenCalledWith(expect.objectContaining({ edited: true }));
  });
  it('re-submitting identical content keeps status and sends no mail', async () => {
    const { svc, mail } = makeService({ orders: bought, reviews: [row({ status: 'APPROVED', rating: 5, title: null, body: 'Lovely flowers indeed' })] });
    const r = await svc.upsertForProduct(7, 1, { rating: 5, title: '', body: 'Lovely flowers indeed' });
    expect(r.status).toBe('APPROVED');
    expect(mail.sendReviewPending).not.toHaveBeenCalled();
  });
  it('a REJECTED review edited by its author goes back to PENDING', async () => {
    const { svc } = makeService({ orders: bought, reviews: [row({ status: 'REJECTED' })] });
    expect((await svc.upsertForProduct(7, 1, { rating: 3, body: 'More considered review text' })).status).toBe('PENDING');
  });
  it('PATCH by the author re-queues; unchanged PATCH does not', async () => {
    const { svc, reviews, mail } = makeService({ reviews: [row({ id: 5, status: 'APPROVED' })] });
    await svc.update(5, 1, 'CUSTOMER', {});
    expect(reviews[0].status).toBe('APPROVED');
    await svc.update(5, 1, 'CUSTOMER', { rating: 2 });
    expect(reviews[0].status).toBe('PENDING');
    expect(mail.sendReviewPending).toHaveBeenCalledTimes(1);
  });
  it('an admin correcting a different user review keeps its status', async () => {
    const { svc, reviews } = makeService({ reviews: [row({ id: 5, userId: 1, status: 'APPROVED' })] });
    await svc.update(5, 99, 'ADMIN', { body: 'Edited by the shop for typos' });
    expect(reviews[0].status).toBe('APPROVED');
  });
  it('another customer cannot edit or delete; the author can delete', async () => {
    const { svc, reviews } = makeService({ reviews: [row({ id: 5, userId: 1 })] });
    await expect(svc.update(5, 2, 'CUSTOMER', { rating: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove(5, 2, 'CUSTOMER')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove(5, 1, 'CUSTOMER')).resolves.toEqual({ success: true });
    expect(reviews).toHaveLength(0);
  });
});

describe('ReviewsService public list', () => {
  const all = [
    row({ id: 1, userId: 1, status: 'APPROVED', rating: 5 }),
    row({ id: 2, userId: 2, status: 'PENDING', rating: 1 }),
    row({ id: 3, userId: 3, status: 'REJECTED', rating: 1 }),
    row({ id: 4, userId: 4, status: 'APPROVED', rating: 3 }),
  ];
  it('anonymous: APPROVED only, no status field, average over APPROVED, no ownReview', async () => {
    const { svc } = makeService({ reviews: all });
    const res = await svc.listForProduct(7, {});
    expect(res.items.map((i) => i.id).sort()).toEqual([1, 4]);
    expect(res.total).toBe(2);
    expect(res.averageRating).toBe(4);
    expect(res.ownReview).toBeNull();
    expect(res.items.every((i) => !('status' in i))).toBe(true);
  });
  it('caller sees their OWN pending review flagged, never other users pending/rejected', async () => {
    const { svc } = makeService({ reviews: all });
    const res = await svc.listForProduct(7, {}, 2);
    expect(res.ownReview).toMatchObject({ id: 2, status: 'PENDING' });
    expect(res.items.map((i) => i.id).sort()).toEqual([1, 4]);
    const rej = await svc.listForProduct(7, {}, 3);
    expect(rej.ownReview).toMatchObject({ id: 3, status: 'REJECTED' });
    expect(JSON.stringify(res.items)).not.toContain('REJECTED');
  });
  it('queries filter status APPROVED for list, count and aggregate', async () => {
    const { svc, prisma } = makeService({ reviews: all });
    await svc.listForProduct(7, {});
    for (const fn of [prisma.review.findMany, prisma.review.count, prisma.review.aggregate]) {
      expect(fn.mock.calls[0][0].where).toEqual({ productId: 7, status: 'APPROVED' });
    }
  });
});

describe('ReviewsService admin moderation', () => {
  it('setStatus transitions and is idempotent (no second write)', async () => {
    const { svc, prisma, reviews } = makeService({ reviews: [row({ id: 5, status: 'PENDING' })] });
    expect((await svc.setStatus(5, 'APPROVED')).status).toBe('APPROVED');
    expect(prisma.review.update).toHaveBeenCalledTimes(1);
    expect((await svc.setStatus(5, 'APPROVED')).status).toBe('APPROVED');
    expect(prisma.review.update).toHaveBeenCalledTimes(1);
    await svc.setStatus(5, 'REJECTED');
    await svc.setStatus(5, 'PENDING');
    expect(reviews[0].status).toBe('PENDING');
  });
  it('setStatus: 404 unknown id, 400 bad enum', async () => {
    const { svc } = makeService();
    await expect(svc.setStatus(1, 'APPROVED')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setStatus(1, 'BOGUS' as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('listAll validates the status filter and returns counts', async () => {
    const { svc, prisma } = makeService({ reviews: [row({ id: 1, status: 'PENDING' }), row({ id: 2, userId: 2, status: 'APPROVED' })] });
    await expect(svc.listAll({ status: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    const res = await svc.listAll({ status: 'PENDING' });
    expect(res.counts).toEqual({ PENDING: 1, APPROVED: 1, REJECTED: 0 });
    expect(prisma.review.findMany.mock.calls[0][0].where).toEqual({ status: 'PENDING' });
  });
});

describe('ReviewsService mail failure isolation', () => {
  it('a throwing mailer never fails the review submission', async () => {
    const err = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc } = makeService({ orders: [{ userId: 1, status: 'COMPLETED', productIds: [7] }], mailThrows: true });
    await expect(svc.upsertForProduct(7, 1, input)).resolves.toMatchObject({ status: 'PENDING' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
