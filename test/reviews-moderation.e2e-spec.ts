import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { signJwt } from '../src/auth/jwt.util';

// NOTE: POST /products/:id/reviews is throttled to 5/min/IP; this file deliberately issues exactly 5 POSTs.
describe('Review moderation and verified buyers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const ids = { buyer: 0, other: 0, nonBuyer: 0, admin: 0, p1: 0, p2: 0, p3: 0 };
  const auth = (id: number, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') =>
    `Bearer ${signJwt({ sub: id, email: `u${id}@example.com`, role })}`;
  const http = () => request(app.getHttpServer());
  const goodReview = { rating: 5, title: 'Lovely', body: 'Fresh, long lasting and beautifully wrapped.' };

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const mkUser = (tag: string, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') =>
      prisma.user.create({ data: { email: `rev-${tag}-${stamp}@example.com`, password: 'x', name: tag, role } });
    ids.buyer = (await mkUser('buyer')).id;
    ids.other = (await mkUser('other')).id;
    ids.nonBuyer = (await mkUser('nonbuyer')).id;
    ids.admin = (await mkUser('admin', 'ADMIN')).id;
    const mkProduct = (n: number) =>
      prisma.product.create({ data: { name: `E2E Review Product ${n}`, slug: `e2e-review-${n}-${stamp}`, price: 100, stock: 5, active: true } });
    ids.p1 = (await mkProduct(1)).id;
    ids.p2 = (await mkProduct(2)).id;
    ids.p3 = (await mkProduct(3)).id;
    const mkOrder = (userId: number, productId: number, status: 'COMPLETED' | 'PAID') =>
      prisma.order.create({
        data: { userId, status, total: 100, subtotal: 100, items: { create: [{ productId, productName: 'x', quantity: 1, unitPrice: 100 }] } },
      });
    await mkOrder(ids.buyer, ids.p1, 'COMPLETED');
    await mkOrder(ids.buyer, ids.p2, 'PAID'); // not fulfilled yet
    await mkOrder(ids.other, ids.p1, 'COMPLETED');
  });

  afterAll(async () => {
    const productIds = [ids.p1, ids.p2, ids.p3];
    const userIds = [ids.buyer, ids.other, ids.nonBuyer, ids.admin];
    await prisma.review.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.orderItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('requires authentication to post', async () => {
    await http().post(`/products/${ids.p1}/reviews`).send(goodReview).expect(401);
  });

  it('403 for a user who never bought the product (exact message)', async () => {
    const r = await http().post(`/products/${ids.p1}/reviews`).set('Authorization', auth(ids.nonBuyer)).send(goodReview).expect(403);
    expect(r.body.message).toBe('Only customers who received this product can review it');
  });

  it('403 when the order exists but is not COMPLETED', async () => {
    await http().post(`/products/${ids.p2}/reviews`).set('Authorization', auth(ids.buyer)).send(goodReview).expect(403);
  });

  it('eligibility endpoint mirrors the gate and needs a token', async () => {
    await http().get(`/products/${ids.p1}/reviews/eligibility`).expect(401);
    const yes = await http().get(`/products/${ids.p1}/reviews/eligibility`).set('Authorization', auth(ids.buyer)).expect(200);
    expect(yes.body).toEqual({ canReview: true, hasReview: false });
    const no = await http().get(`/products/${ids.p2}/reviews/eligibility`).set('Authorization', auth(ids.buyer)).expect(200);
    expect(no.body.canReview).toBe(false);
  });

  let reviewId: number;
  it('a completed-order buyer posts: stored PENDING, hidden from the public, visible to the author', async () => {
    const r = await http().post(`/products/${ids.p1}/reviews`).set('Authorization', auth(ids.buyer)).send(goodReview).expect(201);
    expect(r.body.status).toBe('PENDING');
    reviewId = r.body.id;

    const pub = await http().get(`/products/${ids.p1}/reviews`).expect(200);
    expect(pub.body.items).toEqual([]);
    expect(pub.body.total).toBe(0);
    expect(pub.body.ownReview).toBeNull();

    const mine = await http().get(`/products/${ids.p1}/reviews`).set('Authorization', auth(ids.buyer)).expect(200);
    expect(mine.body.items).toEqual([]);
    expect(mine.body.ownReview).toMatchObject({ id: reviewId, status: 'PENDING' });

    const someoneElse = await http().get(`/products/${ids.p1}/reviews`).set('Authorization', auth(ids.other)).expect(200);
    expect(someoneElse.body.ownReview).toBeNull();
    expect(JSON.stringify(someoneElse.body)).not.toContain('Fresh, long lasting');
  });

  it('pending reviews do not count towards ratings or detail', async () => {
    const detail = await http().get(`/products/${ids.p1}`).expect(200);
    expect(detail.body.reviewCount).toBe(0);
    expect(detail.body.averageRating).toBe(0);
  });

  it('only ADMIN can list the queue or change status', async () => {
    await http().get('/reviews').expect(401);
    await http().get('/reviews').set('Authorization', auth(ids.buyer)).expect(403);
    await http().patch(`/reviews/${reviewId}/status`).set('Authorization', auth(ids.buyer)).send({ status: 'APPROVED' }).expect(403);
    await http().patch(`/reviews/${reviewId}/status`).send({ status: 'APPROVED' }).expect(401);
  });

  it('admin queue filters by status, includes product and author, and returns counts', async () => {
    const r = await http().get('/reviews?status=PENDING&productId=' + ids.p1).set('Authorization', auth(ids.admin, 'ADMIN')).expect(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ id: reviewId, status: 'PENDING', product: { id: ids.p1 }, user: { id: ids.buyer } });
    expect(r.body.items[0].user.email).toContain('rev-buyer');
    expect(r.body.counts).toEqual({ PENDING: 1, APPROVED: 0, REJECTED: 0 });
    await http().get('/reviews?status=BOGUS').set('Authorization', auth(ids.admin, 'ADMIN')).expect(400);
  });

  it('admin validates the enum, 404s unknown ids, and approving is idempotent', async () => {
    const admin = auth(ids.admin, 'ADMIN');
    await http().patch(`/reviews/${reviewId}/status`).set('Authorization', admin).send({ status: 'NOPE' }).expect(400);
    await http().patch(`/reviews/999999999/status`).set('Authorization', admin).send({ status: 'APPROVED' }).expect(404);
    await http().patch(`/reviews/${reviewId}/status`).set('Authorization', admin).send({ status: 'APPROVED' }).expect(200);
    const again = await http().patch(`/reviews/${reviewId}/status`).set('Authorization', admin).send({ status: 'APPROVED' }).expect(200);
    expect(again.body.status).toBe('APPROVED');
  });

  it('approved review is public, counted, and the item carries no status field', async () => {
    const pub = await http().get(`/products/${ids.p1}/reviews`).expect(200);
    expect(pub.body.items).toHaveLength(1);
    expect(pub.body.items[0]).not.toHaveProperty('status');
    expect(pub.body.averageRating).toBe(5);
    const detail = await http().get(`/products/${ids.p1}`).expect(200);
    expect(detail.body).toMatchObject({ reviewCount: 1, averageRating: 5 });
  });

  it('editing an approved review sets it back to PENDING and removes it from the aggregates', async () => {
    const r = await http().post(`/products/${ids.p1}/reviews`).set('Authorization', auth(ids.buyer)).send({ ...goodReview, rating: 1, body: 'Actually changed my mind completely.' }).expect(201);
    expect(r.body.status).toBe('PENDING');
    expect((await http().get(`/products/${ids.p1}/reviews`).expect(200)).body.items).toEqual([]);
    expect((await http().get(`/products/${ids.p1}`).expect(200)).body.reviewCount).toBe(0);
  });

  it('REJECTED stays hidden publicly but the author sees it; author may delete own review', async () => {
    const admin = auth(ids.admin, 'ADMIN');
    await http().patch(`/reviews/${reviewId}/status`).set('Authorization', admin).send({ status: 'REJECTED' }).expect(200);
    expect((await http().get(`/products/${ids.p1}/reviews`).expect(200)).body.items).toEqual([]);
    const mine = await http().get(`/products/${ids.p1}/reviews`).set('Authorization', auth(ids.buyer)).expect(200);
    expect(mine.body.ownReview.status).toBe('REJECTED');
    await http().delete(`/reviews/${reviewId}`).set('Authorization', auth(ids.other)).expect(403);
    await http().delete(`/reviews/${reviewId}`).set('Authorization', auth(ids.buyer)).expect(200);
  });

  it('popular ordering and listing ratings count APPROVED reviews only', async () => {
    // p3: 3 PENDING/REJECTED reviews (must not count). p2: 1 APPROVED. p1: nothing.
    const mk = (productId: number, userId: number, status: 'PENDING' | 'APPROVED' | 'REJECTED', rating = 5) =>
      prisma.review.create({ data: { productId, userId, rating, body: 'seeded review body', status } });
    await mk(ids.p3, ids.buyer, 'PENDING');
    await mk(ids.p3, ids.other, 'REJECTED');
    await mk(ids.p3, ids.nonBuyer, 'PENDING');
    await mk(ids.p2, ids.buyer, 'APPROVED', 4);

    const list = await http().get(`/products?sort=popular&take=200&active=true`).expect(200);
    const mine = list.body.items.filter((i: any) => [ids.p1, ids.p2, ids.p3].includes(i.id));
    const byId = Object.fromEntries(mine.map((i: any) => [i.id, i]));
    expect(byId[ids.p2]).toMatchObject({ reviewCount: 1, averageRating: 4 });
    expect(byId[ids.p3]).toMatchObject({ reviewCount: 0, averageRating: 0 });
    const order = list.body.items.map((i: any) => i.id);
    expect(order.indexOf(ids.p2)).toBeLessThan(order.indexOf(ids.p3));
    expect(order.indexOf(ids.p2)).toBeLessThan(order.indexOf(ids.p1));
    // Pagination of the popular ranking stays consistent with the full order.
    const page1 = await http().get(`/products?sort=popular&take=1`).expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.total).toBeGreaterThanOrEqual(3);
  });
});
