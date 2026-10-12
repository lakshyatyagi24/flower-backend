// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OCCASION_TAGS, tagsForProduct, categoryDescriptions, LEGACY_CATEGORY_DESCRIPTIONS, isBlank } =
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
    expect(t('Sunflowers (Bi-Colour)')).toEqual(['get-well-soon', 'birthday', 'just-because']);
    expect(t('Royal Purple Dendrobium Orchids')).toEqual(['corporate', 'congratulations', 'anniversary']);
    expect(t('Orange Santini Chrysanthemum')).toEqual(['sympathy', 'corporate', 'get-well-soon']);
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

describe('category descriptions', () => {
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
