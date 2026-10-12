import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Category productCount (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const run = `cpc${Date.now()}`;
  let parentId: number;
  let emptyId: number;
  let childId: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestExpressApplication>({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    const parent = await prisma.category.create({ data: { name: `P ${run}`, slug: `${run}-p`, sortOrder: 900 } });
    parentId = parent.id;
    const empty = await prisma.category.create({ data: { name: `E ${run}`, slug: `${run}-e`, sortOrder: 901 } });
    emptyId = empty.id;
    const child = await prisma.category.create({ data: { name: `C ${run}`, slug: `${run}-c`, parentId } });
    childId = child.id;
    await prisma.product.createMany({
      data: [
        { name: 'a', slug: `${run}-a`, price: 1, stock: 1, categoryId: parentId, active: true },
        { name: 'b', slug: `${run}-b`, price: 1, stock: 1, categoryId: parentId, active: true },
        { name: 'c', slug: `${run}-inactive`, price: 1, stock: 1, categoryId: parentId, active: false },
        { name: 'd', slug: `${run}-d`, price: 1, stock: 1, categoryId: childId, active: true },
        { name: 'x', slug: `${run}-x`, price: 1, stock: 1, categoryId: emptyId, active: false },
      ],
    });
  });
  afterAll(async () => {
    await prisma.product.deleteMany({ where: { slug: { startsWith: run } } });
    await prisma.category.deleteMany({ where: { id: { in: [childId, parentId, emptyId] } } });
    await app.close();
  });

  const find = (body: any[], id: number) => body.find((c) => c.id === id);

  it('GET /categories counts only ACTIVE products, for parents and children', async () => {
    const res = await http().get('/categories').expect(200);
    expect(find(res.body, parentId)).toMatchObject({ slug: `${run}-p`, productCount: 2, name: `P ${run}` });
    expect(find(res.body, parentId)).not.toHaveProperty('_count');
    expect(find(res.body, parentId).children).toEqual([
      expect.objectContaining({ id: childId, slug: `${run}-c`, productCount: 1, active: true }),
    ]);
    expect(find(res.body, emptyId).productCount).toBe(0);
  });

  it('GET /categories/all includes productCount too and keeps existing fields', async () => {
    const res = await http().get('/categories/all').expect(200);
    expect(find(res.body, parentId)).toMatchObject({ productCount: 2, parentId: null, defaultSaleMode: expect.any(String) });
    expect(find(res.body, childId)).toMatchObject({ productCount: 1, parentId });
    expect(find(res.body, parentId).children[0]).toMatchObject({ id: childId, productCount: 1 });
  });
});
