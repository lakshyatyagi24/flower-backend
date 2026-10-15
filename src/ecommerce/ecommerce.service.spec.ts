import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EcommerceService } from './ecommerce.service';

function make() {
  const prisma: any = {
    category: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findUnique: jest.fn(async () => ({ id: 1, children: [], products: [] })),
      delete: jest.fn(async () => ({ id: 1 })),
    },
    slider: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => ({ id: 1, title: 'T', config: { a: 1 }, sortOrder: 2, active: true })),
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      delete: jest.fn(async () => ({ id: 1 })),
    },
  };
  return { svc: new EcommerceService(prisma), prisma };
}

const slugDup = Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['slug'] } });

describe('EcommerceService categories', () => {
  it('getCategories lists only active top-level categories and exposes productCount from ACTIVE products', async () => {
    const { svc, prisma } = make();
    prisma.category.findMany.mockResolvedValue([
      { id: 1, name: 'Roses', _count: { products: 3 }, children: [{ id: 2, name: 'Red', _count: { products: 1 } }] },
    ]);
    const out: any = await svc.getCategories();
    const args = prisma.category.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ parentId: null, active: true });
    expect(args.select._count).toEqual({ select: { products: { where: { active: true } } } });
    expect(out[0].productCount).toBe(3);
    expect(out[0]._count).toBeUndefined();
    expect(out[0].children[0]).toMatchObject({ id: 2, productCount: 1 });
  });

  it('create enforces the 8 active main-category limit but not for subcategories', async () => {
    const { svc, prisma } = make();
    prisma.category.count.mockResolvedValue(8);
    await expect(svc.createCategory({ name: 'N', slug: 'n' })).rejects.toThrow('Maximum 8 main categories allowed');
    expect(prisma.category.create).not.toHaveBeenCalled();
    await expect(svc.createCategory({ name: 'Sub', slug: 'sub', parentId: 3 })).resolves.toBeDefined();
    expect(prisma.category.count).toHaveBeenCalledTimes(1);
  });

  it('create applies defaults', async () => {
    const { svc, prisma } = make();
    await svc.createCategory({ name: 'N', slug: 'n' });
    expect(prisma.category.create.mock.calls[0][0].data).toMatchObject({
      parentId: null, productType: 'CUT_FLOWER', defaultSaleMode: 'PURCHASE', defaultGstRate: 0, sortOrder: 0, active: true,
    });
  });

  it('create and update map a duplicate slug to a friendly 400 and rethrow anything else', async () => {
    const { svc, prisma } = make();
    prisma.category.create.mockRejectedValue(slugDup);
    await expect(svc.createCategory({ name: 'N', slug: 'n' })).rejects.toThrow('A category with this slug already exists');
    prisma.category.update.mockRejectedValue(slugDup);
    await expect(svc.updateCategory(1, { slug: 'n' })).rejects.toBeInstanceOf(BadRequestException);
    const boom = new Error('db down');
    prisma.category.update.mockRejectedValue(boom);
    await expect(svc.updateCategory(1, { name: 'x' })).rejects.toBe(boom);
  });

  it('delete: 404 when missing, refuses with subcategories or products, otherwise deletes', async () => {
    const { svc, prisma } = make();
    prisma.category.findUnique.mockResolvedValueOnce(null);
    await expect(svc.deleteCategory(1)).rejects.toBeInstanceOf(NotFoundException);
    prisma.category.findUnique.mockResolvedValueOnce({ children: [{ id: 2 }], products: [] });
    await expect(svc.deleteCategory(1)).rejects.toThrow('Cannot delete category with subcategories');
    prisma.category.findUnique.mockResolvedValueOnce({ children: [], products: [{ id: 5 }] });
    await expect(svc.deleteCategory(1)).rejects.toThrow('Cannot delete category with associated products');
    expect(prisma.category.delete).not.toHaveBeenCalled();
    await svc.deleteCategory(1);
    expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe('EcommerceService sliders', () => {
  it('getSliders hides inactive ones unless asked, ordered by sortOrder then id', async () => {
    const { svc, prisma } = make();
    await svc.getSliders();
    expect(prisma.slider.findMany.mock.calls[0][0]).toMatchObject({
      where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    await svc.getSliders(true);
    expect(prisma.slider.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('getSlider 404s when missing', async () => {
    const { svc, prisma } = make();
    prisma.slider.findUnique.mockResolvedValue(null);
    await expect(svc.getSlider(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create parses a JSON-string config, rejects malformed JSON', async () => {
    const { svc, prisma } = make();
    await svc.createSlider({ title: 'x', config: '{"a":1}', sortOrder: 1 });
    expect(prisma.slider.create.mock.calls[0][0].data.config).toEqual({ a: 1 });
    await expect(svc.createSlider({ config: '{nope' })).rejects.toThrow('Invalid JSON in config field');
  });

  it('create appends after the current max sortOrder (1 when there are none)', async () => {
    const { svc, prisma } = make();
    prisma.slider.findFirst.mockResolvedValue({ sortOrder: 7 });
    await svc.createSlider({ title: 'x' });
    expect(prisma.slider.create.mock.calls[0][0].data.sortOrder).toBe(8);
    prisma.slider.findFirst.mockResolvedValue(null);
    await svc.createSlider({ title: 'y' });
    expect(prisma.slider.create.mock.calls[1][0].data.sortOrder).toBe(1);
  });

  it('create keeps an explicit sortOrder of 0 and defaults active to true', async () => {
    const { svc, prisma } = make();
    await svc.createSlider({ title: 'x', sortOrder: 0 });
    expect(prisma.slider.findFirst).not.toHaveBeenCalled();
    expect(prisma.slider.create.mock.calls[0][0].data).toMatchObject({ sortOrder: 0, active: true, config: {} });
  });

  it('update merges config over the stored config and keeps untouched fields', async () => {
    const { svc, prisma } = make();
    await svc.updateSlider(1, { config: { b: 2 }, active: false });
    expect(prisma.slider.update.mock.calls[0][0].data).toMatchObject({
      title: 'T', sortOrder: 2, active: false, config: { a: 1, b: 2 },
    });
  });

  it('update allows a duplicate sortOrder (reorder swaps) and 404s for a missing slider', async () => {
    const { svc, prisma } = make();
    await svc.updateSlider(1, { sortOrder: 2 });
    expect(prisma.slider.update).toHaveBeenCalled();
    prisma.slider.findUnique.mockResolvedValue(null);
    await expect(svc.updateSlider(9, { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete 404s when missing, deletes otherwise', async () => {
    const { svc, prisma } = make();
    await svc.deleteSlider(1);
    expect(prisma.slider.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    prisma.slider.findUnique.mockResolvedValue(null);
    await expect(svc.deleteSlider(2)).rejects.toBeInstanceOf(NotFoundException);
  });
});
