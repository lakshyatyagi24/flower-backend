import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { applyBodyParsers } from '../src/common/body-parsers';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { signJwt } from '../src/auth/jwt.util';

describe('Product tags, sort and pagination (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const run = `pt${Date.now()}`;
  const tagA = `${run}-alpha`;
  const tagB = `${run}-beta`;
  const ids: number[] = [];
  let cheap: { id: number; slug: string };
  let dear: { id: number; slug: string };
  const http = () => request(app.getHttpServer());
  const adminAuth = () => `Bearer ${signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' })}`;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestExpressApplication>({ rawBody: true });
    applyBodyParsers(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    cheap = await prisma.product.create({
      data: { name: 'PT Cheap', slug: `pt-cheap-${run}`, price: 11, stock: 5, tags: [tagA, 'common-' + run] },
      select: { id: true, slug: true },
    });
    dear = await prisma.product.create({
      data: { name: 'PT Dear', slug: `pt-dear-${run}`, price: 99, stock: 5, tags: [tagB, 'common-' + run] },
      select: { id: true, slug: true },
    });
    ids.push(cheap.id, dear.id);
  });
  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('filters by tag', async () => {
    const res = await http().get(`/products?tag=${tagA}`).expect(200);
    expect(res.body.items.map((p: any) => p.slug)).toEqual([cheap.slug]);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].tags).toEqual([tagA, `common-${run}`]);
  });

  it('returns empty items and total 0 for a non-matching tag', async () => {
    const res = await http().get(`/products?tag=${run}-nomatch`).expect(200);
    expect(res.body).toMatchObject({ items: [], total: 0, page: 1, pages: 1 });
  });

  it('ignores an invalid tag value (no filter)', async () => {
    const res = await http().get('/products?tag=Not%20A%20Slug').expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('sorts by price', async () => {
    const asc = await http().get(`/products?tag=common-${run}&sort=price_asc`).expect(200);
    expect(asc.body.items.map((p: any) => p.slug)).toEqual([cheap.slug, dear.slug]);
    const desc = await http().get(`/products?tag=common-${run}&sort=price_desc`).expect(200);
    expect(desc.body.items.map((p: any) => p.slug)).toEqual([dear.slug, cheap.slug]);
  });

  it('sort=popular runs against the DB and orders by review count', async () => {
    const user = await prisma.user.create({ data: { email: `${run}@example.com`, password: 'x', name: 'PT' } });
    try {
      await prisma.review.create({ data: { productId: cheap.id, userId: user.id, rating: 5, body: 'nice' } });
      const res = await http().get(`/products?tag=common-${run}&sort=popular`).expect(200);
      expect(res.body.items.map((p: any) => p.slug)).toEqual([cheap.slug, dear.slug]);
    } finally {
      await prisma.review.deleteMany({ where: { productId: cheap.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('paginates with page and take', async () => {
    const p2 = await http().get(`/products?tag=common-${run}&sort=price_asc&page=2&take=1`).expect(200);
    expect(p2.body.items.map((p: any) => p.slug)).toEqual([dear.slug]);
    expect(p2.body).toMatchObject({ total: 2, take: 1, skip: 1, page: 2, pages: 2 });
    const p1 = await http().get(`/products?tag=common-${run}&sort=price_asc&take=1`).expect(200);
    expect(p1.body.items.map((p: any) => p.slug)).toEqual([cheap.slug]);
    expect(p1.body).toMatchObject({ page: 1, pages: 2 });
  });

  it('get-by-slug and get-by-id include tags', async () => {
    const bySlug = await http().get(`/products/slug/${dear.slug}`).expect(200);
    expect(bySlug.body.tags).toEqual([tagB, `common-${run}`]);
    const byId = await http().get(`/products/${dear.id}`).expect(200);
    expect(byId.body.tags).toEqual([tagB, `common-${run}`]);
  });

  it('admin create normalises tags; update replaces; invalid tags are 400', async () => {
    const created = await http()
      .post('/products')
      .set('Authorization', adminAuth())
      .send({ name: 'PT Created', slug: `pt-created-${run}`, price: 5, tags: [' Birthday ', 'birthday', `${run}-ROSES`] })
      .expect(201);
    ids.push(created.body.id);
    expect(created.body.tags).toEqual(['birthday', `${run}-roses`]);

    const updated = await http()
      .put(`/products/${created.body.id}`)
      .set('Authorization', adminAuth())
      .send({ tags: ['Wedding', 'wedding', 'get-well-soon'] })
      .expect(200);
    expect(updated.body.tags).toEqual(['wedding', 'get-well-soon']);

    const untouched = await http()
      .put(`/products/${created.body.id}`)
      .set('Authorization', adminAuth())
      .send({ price: 6 })
      .expect(200);
    expect(untouched.body.tags).toEqual(['wedding', 'get-well-soon']);

    const bad = await http()
      .post('/products')
      .set('Authorization', adminAuth())
      .send({ name: 'PT Bad', slug: `pt-bad-${run}`, price: 5, tags: ['has space'] })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain('Tags must be lowercase letters, numbers and hyphens');
    await http()
      .put(`/products/${created.body.id}`)
      .set('Authorization', adminAuth())
      .send({ tags: ['Bad_Tag'] })
      .expect(400);
    await http()
      .post('/products')
      .set('Authorization', adminAuth())
      .send({ name: 'PT Many', slug: `pt-many-${run}`, price: 5, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })
      .expect(400);
    expect(await prisma.product.count({ where: { slug: { in: [`pt-bad-${run}`, `pt-many-${run}`] } } })).toBe(0);
  });
});
