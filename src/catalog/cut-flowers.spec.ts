// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isShopifyUrl, pickImageSrc, transformSnapshot, cutFlowerProducts, cutFlowerCategory } =
  require('../../prisma/data/cut-flowers');

describe('cut-flowers catalogue images', () => {
  const product = (src: string) => ({ images: [{ src }] });

  it('emits null for a Shopify CDN image', () => {
    expect(pickImageSrc(product('https://cdn.shopify.com/s/files/1/x/y.jpg?v=1'), null)).toBeNull();
    expect(pickImageSrc(product('//cdn.shopify.com/s/files/1/x/y.jpg'), null)).toBeNull();
  });

  it('passes through non-Shopify https URLs', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/a.jpg';
    expect(pickImageSrc(product(url), null)).toBe(url);
  });

  it('isShopifyUrl detects only cdn.shopify.com', () => {
    expect(isShopifyUrl('https://cdn.shopify.com/a.jpg')).toBe(true);
    expect(isShopifyUrl('https://example.com/a.jpg')).toBe(false);
    expect(isShopifyUrl(null)).toBe(false);
  });

  it('seeded catalogue and category contain no Shopify hotlinks', () => {
    for (const p of cutFlowerProducts) expect(isShopifyUrl(p.image)).toBe(false);
    expect(cutFlowerCategory.image).toBeNull();
    expect(typeof transformSnapshot).toBe('function');
  });
});

describe('seedCutFlowers is non-destructive', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { seedCutFlowers } = require('../../prisma/data/cut-flowers');
  function fakePrisma() {
    const cats = new Map<string, any>();
    const prods = new Map<string, any>();
    let id = 1;
    return {
      cats,
      prods,
      category: {
        upsert: async ({ where, create, update }: any) => {
          const cur = cats.get(where.slug);
          if (!cur) cats.set(where.slug, { id: id++, ...create });
          else Object.assign(cur, update);
        },
        findUnique: async ({ where }: any) => cats.get(where.slug) ?? null,
      },
      product: {
        findUnique: async ({ where }: any) => prods.get(where.slug) ?? null,
        upsert: async ({ where, create, update }: any) => {
          const cur = prods.get(where.slug);
          if (!cur) prods.set(where.slug, { id: id++, ...create });
          else Object.assign(cur, update);
        },
      },
    };
  }

  it('is idempotent and never overwrites admin-edited rows', async () => {
    const prisma = fakePrisma();
    await seedCutFlowers(prisma);
    const slug = cutFlowerProducts[0].slug;
    const row = prisma.prods.get(slug);
    const count = prisma.prods.size;
    Object.assign(row, { price: 777, name: 'Edited', description: 'Mine', featured: !row.featured, gstRate: 5, unit: 'bunch', saleMode: 'ENQUIRY', image: 'https://res.cloudinary.com/x/live.jpg' });
    const cat = prisma.cats.get(cutFlowerCategory.slug);
    Object.assign(cat, { name: 'Renamed', sortOrder: 42 });
    const before = JSON.stringify([...prisma.prods.entries()]);
    await seedCutFlowers(prisma);
    expect(prisma.prods.size).toBe(count);
    expect(JSON.stringify([...prisma.prods.entries()])).toBe(before);
    expect(prisma.prods.get(slug)).toMatchObject({ price: 777, name: 'Edited', description: 'Mine', gstRate: 5, unit: 'bunch', saleMode: 'ENQUIRY' });
    expect(prisma.cats.get(cutFlowerCategory.slug)).toMatchObject({ name: 'Renamed', sortOrder: 42 });
  });

  it('back-fills an image only when the row has none', async () => {
    const prisma = fakePrisma();
    await seedCutFlowers(prisma);
    const withImg = cutFlowerProducts.find((p: any) => p.image);
    if (!withImg) return; // snapshot currently ships no hotlinked images
    prisma.prods.get(withImg.slug).image = null;
    await seedCutFlowers(prisma);
    expect(prisma.prods.get(withImg.slug).image).toBe(withImg.image);
  });
});

describe('seed.js categories', () => {
  it('upserts categories with an empty update (no overwrite of live rows)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../prisma/seed.js'), 'utf8');
    const block = src.slice(src.indexOf('for (const c of categorySeed)'), src.indexOf('Seeded ${categorySeed'));
    expect(block).toMatch(/update:\s*\{\s*\}/);
    expect(block).not.toMatch(/sortOrder:\s*c\.sortOrder/);
  });
});
