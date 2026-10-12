// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OCCASION_TAGS, tagsForProduct, categoryDescriptions, LEGACY_CATEGORY_DESCRIPTIONS, isBlank, applyTaxonomy } =
  require('../../prisma/data/seed-taxonomy');

const BANNED = ['same-day', 'same day', 'free delivery', 'guarantee', 'award', 'rated', 'within', 'hours'];
const words = (s: string) => s.trim().split(/\s+/).length;

describe('tagsForProduct', () => {
  const t = (name: string, slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) => tagsForProduct({ name, slug });

  it('tags roses for anniversary, just-because and wedding', () => {
    expect(t('Ruby Red Roses')).toEqual(['anniversary', 'just-because', 'wedding']);
    expect(t('Blush Pink Spray Roses')).toEqual(['anniversary', 'just-because', 'wedding']);
    expect(t('Jumilla Roses')).toEqual(['anniversary', 'just-because', 'wedding']);
  });

  it('matches tuberose before rose', () => {
    expect(t('Tube Roses "Rajnigandha"', 'tube-roses-rajnigandha')).not.toContain('just-because');
    expect(t('Tube Roses "Rajnigandha"', 'tube-roses-rajnigandha')).toContain('wedding');
  });

  it('tags lilies, sunflowers, orchids, chrysanthemums (incl. santini), carnations', () => {
    expect(t('Pearl White Oriental Lily')).toEqual(['sympathy', 'congratulations', 'wedding']);
    expect(t('Ruby Red Oriental Lily')).toEqual(['congratulations', 'wedding']);
    expect(t('Sunflowers (Bi-Colour)')).toEqual(['get-well-soon', 'birthday', 'just-because']);
    expect(t('Royal Purple Dendrobium Orchids')).toEqual(['corporate', 'congratulations', 'anniversary']);
    expect(t('White Santini Chrysanthemum')).toEqual(['sympathy', 'corporate']);
    expect(t('Orange Santini Chrysanthemum')).toEqual(['corporate']);
    expect(t('Blush Pink Spray Carnations')).toEqual(['birthday', 'just-because', 'get-well-soon']);
  });

  it('tags gerbera and tulips', () => {
    expect(t('Gerbera Daisy')).toEqual(['birthday', 'get-well-soon', 'congratulations']);
    expect(t('Red Tulips')).toEqual(['anniversary', 'just-because', 'birthday']);
  });

  it('does not treat helichrysum as a chrysanthemum', () => {
    expect(t('Bi-colour Helichrysums')).not.toContain('sympathy');
  });

  it('gives foliage and fillers no tags, and unknown products none', () => {
    expect(t('Eucalyptus Foliage')).toEqual([]);
    expect(t('Gypsophila Filler')).toEqual([]);
    expect(t('Mystery Item')).toEqual([]);
  });

  it('only emits known occasion tags, no duplicates', () => {
    for (const n of ['Rose', 'Lily', 'Sunflowers', 'Orchids', 'Chrysanthemum', 'Hydrangea', 'Gladioli', 'Lisianthus', 'Liatris', 'Anthuriums']) {
      const tags: string[] = t(n);
      expect(tags.length).toBeGreaterThan(0);
      expect(new Set(tags).size).toBe(tags.length);
      for (const x of tags) expect(OCCASION_TAGS).toContain(x);
    }
  });
});

describe('sympathy tagging (white / cream / ivory / pearl or tuberose only)', () => {
  const t = (name: string) => tagsForProduct({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
  it('gives sympathy to pale products and tuberose', () => {
    expect(t('Pearl White Oriental Lily')).toContain('sympathy');
    expect(t('White Santini Chrysanthemum')).toContain('sympathy');
    expect(t('Pearl White Gladioli')).toContain('sympathy');
    expect(t('Tube Roses "Rajnigandha"')).toContain('sympathy');
  });
  it('never gives sympathy to red, pink, yellow, orange or purple items', () => {
    for (const n of ['Ruby Red Gladioli', 'Hot Pink Asiatic Lily', 'Blazing Yellow Asiatic Lily', 'Red Button Chrysanthemums',
      'Sunset Orange Chrysanthemum', 'Royal Purple Chrysanthemum', 'Blush Pink Oriental Lily', 'Ruby Red Roses', 'Pink and White Chrysanthemum']) {
      expect(t(n)).not.toContain('sympathy');
    }
  });
  it('never gives get-well-soon to chrysanthemums', () => {
    for (const n of ['White Santini Chrysanthemum', 'Red Button Chrysanthemums', 'Orange Disbud Chrysanthemums']) {
      expect(t(n)).not.toContain('get-well-soon');
      expect(t(n)).toContain('corporate');
    }
  });
});

describe('applyTaxonomy', () => {
  const fakePrisma = (products: any[], categories: any[] = []) => {
    const updates: any[] = [];
    return {
      updates,
      category: {
        findUnique: async ({ where }: any) => categories.find((c) => c.slug === where.slug) ?? null,
        update: async () => ({}),
      },
      product: {
        findMany: async () => products,
        update: async ({ where, data }: any) => {
          updates.push({ id: where.id, tags: data.tags });
          products.find((p) => p.id === where.id).tags = data.tags;
        },
      },
    };
  };
  const mk = (id: number, name: string, cat: string, tags: string[] = []) => ({ id, name, slug: name.toLowerCase().replace(/ /g, '-'), tags, category: { slug: cat } });

  it('tags only cut-flowers products; other categories are never auto-tagged', async () => {
    const products = [mk(1, 'Rose Hamper', 'hampers'), mk(2, 'Ruby Red Roses', 'cut-flowers'), mk(3, 'Rose Plant', 'plants')];
    const prisma = fakePrisma(products);
    const r = await applyTaxonomy(prisma);
    expect(prisma.updates.map((u: any) => u.id)).toEqual([2]);
    expect(r.tagged).toBe(1);
    expect(products[0].tags).toEqual([]);
  });

  it('re-tags an admin-cleared cut flower (empty = untagged), keeps existing tags, and is idempotent', async () => {
    const products = [mk(1, 'Ruby Red Roses', 'cut-flowers'), mk(2, 'Red Lily', 'cut-flowers', ['birthday'])];
    const prisma = fakePrisma(products);
    await applyTaxonomy(prisma);
    expect(products[0].tags).toEqual(['anniversary', 'just-because', 'wedding']);
    expect(products[1].tags).toEqual(['birthday']);
    const again = await applyTaxonomy(prisma);
    expect(again.tagged).toBe(0);
  });

  it('does not touch an admin-edited category description', async () => {
    const prisma = fakePrisma([], [{ id: 1, slug: 'plants', description: 'Written by admin' }]);
    expect((await applyTaxonomy(prisma)).descriptions).toBe(0);
  });
});

describe('category descriptions', () => {
  it('have no repeated sentence of 8+ words and no unverifiable superlatives', () => {
    const seen = new Set<string>();
    for (const d of Object.values(categoryDescriptions) as string[]) {
      for (const sent of d.split(/(?<=\.)\s+/)) {
        if (sent.split(/\s+/).length < 8) continue;
        expect(seen.has(sent)).toBe(false);
        seen.add(sent);
      }
      for (const b of ['most popular', 'best', 'finest', 'premium', 'widely chosen', 'sensible budget']) expect(d.toLowerCase()).not.toContain(b);
    }
  });

  it('covers the 5 seeded categories with 60-90 words and no banned claims', () => {
    const slugs = ['cut-flowers', 'plants', 'corporate-bouquets', 'arrangements', 'hampers'];
    expect(Object.keys(categoryDescriptions).sort()).toEqual([...slugs].sort());
    for (const s of slugs) {
      const d: string = categoryDescriptions[s];
      expect(words(d)).toBeGreaterThanOrEqual(60);
      expect(words(d)).toBeLessThanOrEqual(90);
      for (const b of BANNED) expect(d.toLowerCase()).not.toContain(b);
    }
  });

  it('knows the legacy seed placeholders so they can be replaced but admin text cannot', () => {
    expect(LEGACY_CATEGORY_DESCRIPTIONS).toContain('Indoor and outdoor plants. Real photos to be uploaded by the store admin.');
    expect(isBlank('')).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('Hand written by admin')).toBe(false);
  });
});
