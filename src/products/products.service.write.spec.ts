import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

function make(existing: any = { id: 1 }) {
  const prisma: any = {
    product: {
      findUnique: jest.fn(async () => existing),
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      delete: jest.fn(async () => ({ id: 1 })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    review: {
      groupBy: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({ _avg: { rating: null }, _count: { _all: 0 } })),
    },
  };
  return { svc: new ProductsService(prisma), prisma };
}

const dupSlug = Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['slug'] } });
const badCategory = Object.assign(new Error('fk'), { code: 'P2003' });

describe('ProductsService.create validation and defaults', () => {
  it('requires a name', async () => {
    const { svc, prisma } = make();
    await expect(svc.create({ name: '   ', price: 10 } as any)).rejects.toThrow('Name is required');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it.each([[undefined], [-1], ['100' as any]])('a purchasable product needs a valid numeric price (%p)', async (price) => {
    const { svc } = make();
    await expect(svc.create({ name: 'Rose', price } as any)).rejects.toThrow('Valid price is required');
  });

  it('an ENQUIRY product needs no price and is stored with price 0', async () => {
    const { svc, prisma } = make();
    await svc.create({ name: 'Wedding Arch', saleMode: 'ENQUIRY' } as any);
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({ saleMode: 'ENQUIRY', price: 0 });
  });

  it('an unknown saleMode / productType falls back to the safe defaults', async () => {
    const { svc, prisma } = make();
    await svc.create({ name: 'Rose', price: 10, saleMode: 'FREE' as any, productType: 'GADGET' as any });
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({ saleMode: 'PURCHASE', productType: 'CUT_FLOWER' });
  });

  it('applies storefront defaults: piece, minimum 1, active, not featured, no negative GST', async () => {
    const { svc, prisma } = make();
    await svc.create({ name: 'Rose', price: 10, gstRate: -5, unit: '  ', minOrderQty: 0 });
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      unit: 'piece', minOrderQty: 1, active: true, featured: false, gstRate: 0, stock: 0, categoryId: null,
    });
  });

  it('floors a fractional minimum order quantity', async () => {
    const { svc, prisma } = make();
    await svc.create({ name: 'Rose', price: 10, minOrderQty: 12.9 });
    expect(prisma.product.create.mock.calls[0][0].data.minOrderQty).toBe(12);
  });

  it('maps a duplicate slug and a missing category to friendly 400s; rethrows anything else', async () => {
    const { svc, prisma } = make();
    prisma.product.create.mockRejectedValueOnce(dupSlug);
    await expect(svc.create({ name: 'Rose', price: 10 })).rejects.toThrow('A product with this slug already exists');
    prisma.product.create.mockRejectedValueOnce(badCategory);
    await expect(svc.create({ name: 'Rose', price: 10, categoryId: 99 })).rejects.toThrow('Selected category does not exist');
    const boom = new Error('db down');
    prisma.product.create.mockRejectedValueOnce(boom);
    await expect(svc.create({ name: 'Rose', price: 10 })).rejects.toBe(boom);
  });
});

describe('ProductsService.update validation', () => {
  it('404s for a missing product', async () => {
    const { svc } = make(null);
    await expect(svc.update(1, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([[-1], ['5' as any]])('rejects an invalid price %p and writes nothing', async (price) => {
    const { svc, prisma } = make();
    await expect(svc.update(1, { price })).rejects.toThrow('Invalid price');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('allows a price of 0 (free sample) and re-slugifies a slug change', async () => {
    const { svc, prisma } = make();
    await svc.update(1, { price: 0, slug: ' Red & Roses! ' });
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({ price: 0, slug: 'red-roses' });
  });

  it('rejects an invalid productType, saleMode and gstRate', async () => {
    const { svc } = make();
    await expect(svc.update(1, { productType: 'X' as any })).rejects.toThrow('Invalid productType');
    await expect(svc.update(1, { saleMode: 'X' as any })).rejects.toThrow('Invalid saleMode');
    await expect(svc.update(1, { gstRate: -1 })).rejects.toThrow('Invalid gstRate');
  });

  it('never stores negative stock and floors fractional stock', async () => {
    const a = make();
    await a.svc.update(1, { stock: -4 });
    expect(a.prisma.product.update.mock.calls[0][0].data.stock).toBe(0);
    const b = make();
    await b.svc.update(1, { stock: 7.8 });
    expect(b.prisma.product.update.mock.calls[0][0].data.stock).toBe(7);
  });

  it('only writes the fields it was given', async () => {
    const { svc, prisma } = make();
    await svc.update(1, { featured: true });
    expect(prisma.product.update.mock.calls[0][0].data).toEqual({ featured: true });
  });

  it('maps duplicate slug and missing category on update too', async () => {
    const { svc, prisma } = make();
    prisma.product.update.mockRejectedValueOnce(dupSlug);
    await expect(svc.update(1, { slug: 'taken' })).rejects.toBeInstanceOf(BadRequestException);
    prisma.product.update.mockRejectedValueOnce(badCategory);
    await expect(svc.update(1, { categoryId: 99 })).rejects.toThrow('Selected category does not exist');
  });
});

describe('ProductsService.remove', () => {
  it('404s for a missing product', async () => {
    const { svc } = make(null);
    await expect(svc.remove(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hard-deletes a product that was never ordered', async () => {
    const { svc, prisma } = make({ id: 1, orderItems: [] });
    expect(await svc.remove(1)).toEqual({ success: true });
    expect(prisma.product.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('soft-disables an ordered product so order history survives', async () => {
    const { svc, prisma } = make({ id: 1, orderItems: [{ id: 5 }] });
    await svc.remove(1);
    expect(prisma.product.delete).not.toHaveBeenCalled();
    expect(prisma.product.update.mock.calls[0][0]).toMatchObject({ where: { id: 1 }, data: { active: false } });
  });
});

describe('ProductsService image URL normalisation on read', () => {
  async function imageFor(raw: string | null) {
    const { svc } = make({ id: 1, image: raw });
    return (await svc.getBySlug('x')).image;
  }

  it.each([
    ['https://res.cloudinary.com/x/a.jpg', 'https://res.cloudinary.com/x/a.jpg'],
    ['/images/a.jpg', '/images/a.jpg'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    ['//cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg'],
    ['cdn.shopify.com/s/files/a.jpg', 'https://cdn.shopify.com/s/files/a.jpg'],
    ['http://cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg'],
    ['http://localhost:3000/a.jpg', 'http://localhost:3000/a.jpg'],
    ['https%3A%2F%2Fcdn.example.com%2Fa.jpg', 'https://cdn.example.com/a.jpg'],
    ['https:://cdn.example.com/a.jpg', 'https://cdn.example.com/a.jpg'],
  ])('%s -> %s', async (raw, expected) => {
    expect(await imageFor(raw)).toBe(expected);
  });

  it.each([[null], [''], ['   '], ['not a url'], ['ftp://x/a.jpg'], ['javascript:alert(1)']])(
    'unusable value %p becomes null (storefront shows the placeholder)',
    async (raw) => {
      expect(await imageFor(raw as string | null)).toBeNull();
    },
  );

  it('a malformed percent-escape does not throw', async () => {
    expect(await imageFor('%E0%A4%A')).toBeNull();
  });

  it('getBySlug / getById 404 for an unknown product', async () => {
    const { svc } = make(null);
    await expect(svc.getBySlug('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getById(9)).rejects.toBeInstanceOf(NotFoundException);
  });
});
