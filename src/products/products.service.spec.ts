import { BadRequestException } from '@nestjs/common';
import { ProductsService, normalizeTags } from './products.service';

function makeService(total = 0) {
  const findMany = jest.fn(async (_args?: any) => []);
  const count = jest.fn(async (_args?: any) => total);
  const create = jest.fn(async ({ data }: any) => ({ id: 1, ...data }));
  const update = jest.fn(async ({ data }: any) => ({ id: 1, ...data }));
  const prisma: any = {
    product: { findMany, count, create, update, findUnique: jest.fn(async () => ({ id: 1 })) },
    review: { groupBy: jest.fn(async () => []) },
  };
  return { svc: new ProductsService(prisma), findMany, count, create, update };
}

describe('normalizeTags', () => {
  it('accepts valid slugs', () => {
    expect(normalizeTags(['birthday', 'get-well-soon', 'roses2'])).toEqual(['birthday', 'get-well-soon', 'roses2']);
  });
  it('trims and lowercases', () => {
    expect(normalizeTags(['  Birthday ', 'ANNIVERSARY'])).toEqual(['birthday', 'anniversary']);
  });
  it('removes duplicates (after normalising) keeping first order', () => {
    expect(normalizeTags(['a', 'B', 'b', 'a'])).toEqual(['a', 'b']);
  });
  it('empty array is ok', () => {
    expect(normalizeTags([])).toEqual([]);
  });
  it.each([['has space'], ['under_score'], ['-lead'], ['trail-'], ['dou--ble'], [''], ['café'], ['a'.repeat(41)]])(
    'rejects invalid tag %p',
    (t) => {
      expect(() => normalizeTags([t])).toThrow(BadRequestException);
      expect(() => normalizeTags([t])).toThrow('Tags must be lowercase letters, numbers and hyphens');
    },
  );
  it('accepts a 40 char tag', () => {
    expect(normalizeTags(['a'.repeat(40)])).toHaveLength(1);
  });
  it('rejects more than 20 tags, allows exactly 20', () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(() => normalizeTags(many)).toThrow(BadRequestException);
    expect(normalizeTags(many.slice(0, 20))).toHaveLength(20);
  });
  it('rejects non-array / non-string members', () => {
    expect(() => normalizeTags('birthday' as any)).toThrow(BadRequestException);
    expect(() => normalizeTags([5 as any])).toThrow(BadRequestException);
  });
});

describe('ProductsService.list query building', () => {
  it('defaults: newest, id tiebreaker, take 50, skip 0, page 1', async () => {
    const { svc, findMany } = makeService(0);
    const res = await svc.list({});
    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.where).toEqual({});
    expect(args.take).toBe(50);
    expect(args.skip).toBe(0);
    expect(res).toMatchObject({ items: [], total: 0, take: 50, skip: 0, page: 1, pages: 1 });
  });
  it.each([
    ['price_asc', [{ price: 'asc' }, { id: 'desc' }]],
    ['price_desc', [{ price: 'desc' }, { id: 'desc' }]],
    ['newest', [{ createdAt: 'desc' }, { id: 'desc' }]],
    ['popular', [{ reviews: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]],
    ['bogus', [{ createdAt: 'desc' }, { id: 'desc' }]],
  ])('sort=%s', async (sort, expected) => {
    const { svc, findMany } = makeService();
    await svc.list({ sort });
    expect(findMany.mock.calls[0][0].orderBy).toEqual(expected);
  });
  it('tag filter uses has and combines with other filters', async () => {
    const { svc, findMany, count } = makeService();
    await svc.list({ tag: 'birthday', category: 'roses', active: true, featured: true });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({ tags: { has: 'birthday' }, category: { slug: 'roses' }, active: true, featured: true });
    expect(count.mock.calls[0][0].where).toEqual(where);
  });
  it('invalid tag value is ignored', async () => {
    const { svc, findMany } = makeService();
    await svc.list({ tag: 'Not A Slug!' });
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });
  it('page converts to skip and wins over skip', async () => {
    const { svc, findMany } = makeService(100);
    const res = await svc.list({ page: 3, take: 10, skip: 99 });
    expect(findMany.mock.calls[0][0].skip).toBe(20);
    expect(res).toMatchObject({ page: 3, pages: 10, skip: 20, take: 10 });
  });
  it('invalid page (<1, NaN) falls back to skip handling', async () => {
    const { svc, findMany } = makeService();
    await svc.list({ page: 0, take: 10, skip: 5 });
    expect(findMany.mock.calls[0][0].skip).toBe(5);
    await svc.list({ page: NaN, take: 10 });
    expect(findMany.mock.calls[1][0].skip).toBe(0);
  });
  it('derives page from skip when page not given', async () => {
    const { svc } = makeService(100);
    const res = await svc.list({ take: 10, skip: 30 });
    expect(res.page).toBe(4);
  });
  it('pages is ceil(total/take), min 1', async () => {
    expect((await makeService(0).svc.list({ take: 10 })).pages).toBe(1);
    expect((await makeService(10).svc.list({ take: 10 })).pages).toBe(1);
    expect((await makeService(11).svc.list({ take: 10 })).pages).toBe(2);
  });
  it('clamps take to 1..200', async () => {
    expect((await makeService().svc.list({ take: 9999 })).take).toBe(200);
    expect((await makeService().svc.list({ take: 0 })).take).toBe(1);
  });
  it('NaN / non-finite take falls back to the default 50', async () => {
    expect((await makeService().svc.list({ take: NaN })).take).toBe(50);
    expect((await makeService().svc.list({ take: Infinity })).take).toBe(50);
  });
  it('caps page so a huge ?page= cannot produce an absurd skip', async () => {
    const { svc, findMany } = makeService();
    const res = await svc.list({ page: 1e20, take: 10 });
    expect(res.page).toBe(100000);
    expect(findMany.mock.calls[0][0].skip).toBe(99999 * 10);
  });
  it('caps skip and ignores non-finite skip', async () => {
    const { svc, findMany } = makeService();
    await svc.list({ skip: 1e20, take: 200 });
    expect(findMany.mock.calls[0][0].skip).toBe(100000 * 200);
    await svc.list({ skip: NaN });
    expect(findMany.mock.calls[1][0].skip).toBe(0);
  });
  it('page beyond the last returns an empty slice with the real page count', async () => {
    const res = await makeService(5).svc.list({ page: 50, take: 10 });
    expect(res.pages).toBe(1);
    expect(res.page).toBe(50);
  });
  it('float page is treated as invalid (falls back to skip)', async () => {
    const { svc, findMany } = makeService();
    await svc.list({ page: 2.5, take: 10, skip: 7 });
    expect(findMany.mock.calls[0][0].skip).toBe(7);
  });
});

describe('ProductsService slug on create', () => {
  it('slugifies an explicit slug (no & < spaces or uppercase can reach URLs or the sitemap)', async () => {
    const { svc, create } = makeService();
    await svc.create({ name: 'Rose', price: 10, slug: ' Rose & Lily <3>! ' });
    expect(create.mock.calls[0][0].data.slug).toBe('rose-lily-3');
  });
  it('derives the slug from the name when none is given', async () => {
    const { svc, create } = makeService();
    await svc.create({ name: 'Red Rose Bouquet', price: 10 });
    expect(create.mock.calls[0][0].data.slug).toBe('red-rose-bouquet');
  });
  it('falls back to the name when the given slug has no usable characters', async () => {
    const { svc, create } = makeService();
    await svc.create({ name: 'Red Rose', price: 10, slug: '!!!' });
    expect(create.mock.calls[0][0].data.slug).toBe('red-rose');
  });
  it('rejects when no slug can be derived at all', async () => {
    const { svc } = makeService();
    await expect(svc.create({ name: '***', price: 10 })).rejects.toThrow(BadRequestException);
  });
});

describe('ProductsService tags on write', () => {
  it('create normalises tags', async () => {
    const { svc, create } = makeService();
    await svc.create({ name: 'Rose', price: 10, tags: [' Birthday', 'birthday', 'Roses'] });
    expect(create.mock.calls[0][0].data.tags).toEqual(['birthday', 'roses']);
  });
  it('create defaults to empty tags', async () => {
    const { svc, create } = makeService();
    await svc.create({ name: 'Rose', price: 10 });
    expect(create.mock.calls[0][0].data.tags).toEqual([]);
  });
  it('create rejects invalid tags', async () => {
    const { svc } = makeService();
    await expect(svc.create({ name: 'Rose', price: 10, tags: ['bad tag'] })).rejects.toThrow(BadRequestException);
  });
  it('update normalises tags, leaves them alone when omitted, rejects invalid', async () => {
    const { svc, update } = makeService();
    await svc.update(1, { tags: ['A', 'a'] });
    expect(update.mock.calls[0][0].data.tags).toEqual(['a']);
    await svc.update(1, { name: 'x' });
    expect(update.mock.calls[1][0].data).not.toHaveProperty('tags');
    await expect(svc.update(1, { tags: ['_'] })).rejects.toThrow(BadRequestException);
  });
});
