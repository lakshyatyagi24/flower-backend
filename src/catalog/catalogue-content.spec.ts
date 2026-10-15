/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const P = require('../../prisma/data/catalogue-plan');
const { parseArgs, makeFileExists } = require('../../prisma/apply-catalogue-content');
const { HERO_SLIDES, sliderRow } = require('../../prisma/data/seed-sliders');
const { PRODUCT_COPY } = require('../../prisma/data/product-copy');
const { cutFlowerProducts } = require('../../prisma/data/cut-flowers');

const COMPETITOR =
  'What you get\n\nBunch of 18 fresh roses wrapped in brown paper. The flowers are accompanied by flower food and a care card.\n\nKnow the story\n\nThe humble rose.';

describe('isCompetitorCopy', () => {
  it('detects the snapshot text and every real seeded description', () => {
    expect(P.isCompetitorCopy(COMPETITOR)).toBe(true);
    for (const p of cutFlowerProducts) expect([p.slug, P.isCompetitorCopy(p.description)]).toEqual([p.slug, true]);
  });
  it('does not flag original copy, hand-written text or blanks', () => {
    for (const p of Object.values(PRODUCT_COPY) as { description: string }[]) expect(P.isCompetitorCopy(p.description)).toBe(false);
    expect(P.isCompetitorCopy('Our own roses, picked for colour.')).toBe(false);
    expect(P.isCompetitorCopy('')).toBe(false);
    expect(P.isCompetitorCopy(null)).toBe(false);
  });
});

describe('planDescriptions', () => {
  const copy = {
    a: { description: 'New A.' },
    b: { description: 'New B.' },
    c: { description: 'New C.' },
    d: { description: 'New D.' },
    e: { description: 'New E.' },
  };
  const oldSeed = { b: 'Old seed B text', c: 'Old seed C' };
  const rows = [
    { id: 1, slug: 'a', description: COMPETITOR },
    { id: 2, slug: 'b', description: 'Old seed B text' },
    { id: 3, slug: 'c', description: 'The owner wrote this by hand.' },
    { id: 4, slug: 'd', description: null },
    { id: 5, slug: 'e', description: 'New E.' },
    { id: 6, slug: 'zzz', description: COMPETITOR },
  ];

  it('replaces competitor, old-seed and empty descriptions only', () => {
    const r = P.planDescriptions(rows, { copy, oldSeed });
    expect(r.changes.map((c: any) => [c.key, c.why])).toEqual([
      ['a', 'competitor-pattern'],
      ['b', 'old-seed'],
      ['d', 'empty'],
    ]);
    expect(r.changes[0].before.description).toBe(COMPETITOR);
    expect(r.changes[0].after.description).toBe('New A.');
  });

  it('does not overwrite a live-edited description, skips already-current and rows with no copy', () => {
    const r = P.planDescriptions(rows, { copy, oldSeed });
    const reason = (s: string) => r.skipped.find((x: any) => x.slug === s)?.reason;
    expect(reason('c')).toBe('live-edited');
    expect(reason('e')).toBe('already-current');
    expect(reason('zzz')).toBe('no-copy');
  });

  it('--force-descriptions overwrites the hand-edited one too', () => {
    const r = P.planDescriptions(rows, { copy, oldSeed, force: true });
    expect(r.changes.find((c: any) => c.key === 'c')?.why).toBe('forced');
  });

  it('treats whitespace-only differences as already current', () => {
    const r = P.planDescriptions([{ id: 1, slug: 'e', description: ' New   E.\n' }], { copy });
    expect(r.changes).toEqual([]);
  });

  it('is idempotent: applying the plan and planning again changes nothing', () => {
    const first = P.planDescriptions(rows, { copy, oldSeed });
    const applied = rows.map((r) => {
      const c = first.changes.find((x: any) => x.id === r.id);
      return c ? { ...r, ...c.after } : r;
    });
    expect(P.planDescriptions(applied, { copy, oldSeed }).changes).toEqual([]);
  });

  it('on the real seed: all 95 seeded descriptions are replaced, and then none', () => {
    const seeded = cutFlowerProducts.map((p: any, i: number) => ({ id: i + 1, slug: p.slug, description: p.description }));
    const old = Object.fromEntries(cutFlowerProducts.map((p: any) => [p.slug, p.description]));
    expect(P.planDescriptions(seeded, { copy: PRODUCT_COPY, oldSeed: old }).changes).toHaveLength(95);
    const after = seeded.map((r: any) => ({ ...r, description: PRODUCT_COPY[r.slug].description }));
    expect(P.planDescriptions(after, { copy: PRODUCT_COPY, oldSeed: old }).changes).toEqual([]);
  });
});

describe('planStock', () => {
  const base = { active: true, saleMode: 'PURCHASE' };
  const rows = [
    { id: 1, slug: 'zero', stock: 0, ...base },
    { id: 2, slug: 'nul', stock: null, ...base },
    { id: 3, slug: 'some', stock: 7, ...base },
    { id: 4, slug: 'ordered', stock: 0, ...base },
    { id: 5, slug: 'off', stock: 0, active: false, saleMode: 'PURCHASE' },
    { id: 6, slug: 'enq', stock: 0, active: true, saleMode: 'ENQUIRY' },
  ];
  it('sets the default only for 0/null stock on active purchasable products never ordered', () => {
    const r = P.planStock(rows, { stock: 25, orderedIds: new Set([4]) });
    expect(r.changes.map((c: any) => [c.key, c.before.stock, c.after.stock])).toEqual([
      ['zero', 0, 25],
      ['nul', null, 25],
    ]);
    expect(r.counts).toEqual({ 'has-stock': 1, 'ordered-before-maybe-sold-out': 1, inactive: 1, 'enquiry-only': 1 });
  });
  it('leaves stock > 0 untouched and is idempotent', () => {
    const r1 = P.planStock(rows, { orderedIds: new Set([4]) });
    const applied = rows.map((x) => {
      const c = r1.changes.find((y: any) => y.id === x.id);
      return c ? { ...x, ...c.after } : x;
    });
    expect(P.planStock(applied, { orderedIds: new Set([4]) }).changes).toEqual([]);
    expect(applied.find((x) => x.slug === 'some')?.stock).toBe(7);
  });
  it('parses --stock strictly', () => {
    expect(P.parseStock(undefined)).toBe(25);
    expect(P.parseStock('40')).toBe(40);
    for (const bad of ['0', '-3', '2.5', 'abc', '1000000']) expect(() => P.parseStock(bad)).toThrow(/--stock/);
  });
});

describe('planFeatured', () => {
  it('turns curated products on, never off, and reports unknown slugs', () => {
    const rows = [
      { id: 1, slug: 'rose-ruby-red', featured: false, active: true },
      { id: 2, slug: 'sunflowers', featured: true, active: true },
      { id: 3, slug: 'liatris', featured: true, active: true }, // not curated: must stay on
      { id: 4, slug: 'hydrangea-powder-blue', featured: false, active: false },
    ];
    const r = P.planFeatured(rows, ['rose-ruby-red', 'sunflowers', 'hydrangea-powder-blue', 'ghost']);
    expect(r.changes.map((c: any) => c.key)).toEqual(['rose-ruby-red']);
    expect(r.changes.every((c: any) => c.after.featured === true)).toBe(true);
    expect(r.skipped.map((s: any) => s.reason)).toEqual(['already-featured', 'inactive', 'not-in-catalogue']);
    expect(r.existingFeatured).toBe(2);
  });
  it('the curated list is 8 real seeded slugs from several flower families', () => {
    expect(P.CURATED_FEATURED).toHaveLength(8);
    const slugs = new Set(cutFlowerProducts.map((p: any) => p.slug));
    for (const s of P.CURATED_FEATURED) expect(slugs.has(s)).toBe(true);
    expect(new Set(P.CURATED_FEATURED.map((s: string) => s.split('-')[0])).size).toBeGreaterThanOrEqual(6);
  });
});

describe('planCategories', () => {
  const cat = (id: number, slug: string, name: string, sortOrder: number, productCount = 3) => ({ id, slug, name, sortOrder, active: true, productCount });
  it('orders categories that were never ordered (all 0)', () => {
    const r = P.planCategories([cat(1, 'cut-flowers', 'Cut Flowers', 0), cat(2, 'plants', 'Plants', 0), cat(3, 'hampers', 'Hampers', 0)]);
    expect(Object.fromEntries(r.changes.map((c: any) => [c.key, c.after.sortOrder]))).toEqual({ 'cut-flowers': 1, plants: 2, hampers: 5 });
  });
  it('orders colliding categories', () => {
    const r = P.planCategories([cat(1, 'cut-flowers', 'Cut Flowers', 1), cat(2, 'plants', 'Plants', 2), cat(3, 'hampers', 'Hampers', 2)]);
    expect(r.changes.map((c: any) => c.key)).toEqual(['hampers']);
  });
  it('leaves a deliberate, distinct order and a deliberate rename alone', () => {
    const r = P.planCategories([cat(1, 'cut-flowers', 'Fresh Flowers', 3), cat(2, 'plants', 'Plants', 1), cat(3, 'hampers', 'Hampers', 2)]);
    expect(r.changes).toEqual([]);
  });
  it('fixes case/space typos in names only, and is idempotent', () => {
    const rows = [cat(1, 'cut-flowers', 'cut flowers', 1), cat(2, 'plants', ' Plants ', 2)];
    const r = P.planCategories(rows);
    expect(r.changes.map((c: any) => [c.key, c.after.name])).toEqual([
      ['cut-flowers', 'Cut Flowers'],
      ['plants', 'Plants'],
    ]);
    const applied = rows.map((x) => ({ ...x, ...r.changes.find((c: any) => c.id === x.id).after }));
    expect(P.planCategories(applied).changes).toEqual([]);
  });
  it('notes active empty categories without changing them', () => {
    const r = P.planCategories([cat(1, 'cut-flowers', 'Cut Flowers', 1), cat(2, 'plants', 'Plants', 2, 0)]);
    expect(r.changes).toEqual([]);
    expect(r.observations).toHaveLength(1);
  });
});

describe('planSliders', () => {
  it('creates 3 slides, inactive when the image file is missing, active when present', () => {
    const present = new Set(['/images/hero/hero-2.webp']);
    const r = P.planSliders(0, HERO_SLIDES, sliderRow, (p: string) => present.has(p));
    expect(r.creates).toHaveLength(3);
    expect(r.creates.map((c: any) => c.row.active)).toEqual([false, true, false]);
    expect(r.creates[0].row.config).toEqual({ overlay: { cta: { label: 'Shop flowers' } } });
  });
  it('never creates anything when the table already has rows', () => {
    const r = P.planSliders(1, HERO_SLIDES, sliderRow, () => true);
    expect(r.creates).toEqual([]);
    expect(r.skippedReason).toMatch(/already has 1/);
  });
  it('slide copy is short, honest and links only to local pages', () => {
    for (const s of HERO_SLIDES) {
      expect(s.title.length).toBeLessThanOrEqual(80);
      expect(s.subtitle.length).toBeLessThanOrEqual(200);
      expect(s.ctaLabel.length).toBeLessThanOrEqual(24);
      expect(s.href).toMatch(/^\/(products|corporate|occasions\/[a-z-]+)$/);
      expect(s.image).toMatch(/^\/images\/hero\/hero-\d\.webp$/);
      const text = `${s.title} ${s.subtitle} ${s.eyebrow}`.toLowerCase();
      for (const b of ['same-day', 'same day', 'free delivery', 'farm-fresh', 'guarantee', 'limited time', 'premium', 'luxury', '!']) expect(text).not.toContain(b);
    }
  });
});

describe('product image mapping', () => {
  const good = {
    version: 1,
    items: { 'rose-ruby-red': { image: '/images/products/roses.webp', alt: 'Red roses' } },
    groups: [{ slugPrefix: 'hydrangea-', image: '/images/products/hydrangea.jpg' }],
  };

  it('validates the format and rejects unsafe paths', () => {
    expect(P.validateImageMap(good)).toEqual([]);
    expect(P.validateImageMap(require('../../prisma/data/product-images.json'))).toEqual([]);
    const bad = (m: any) => P.validateImageMap(m).length > 0;
    expect(bad(null)).toBe(true);
    expect(bad({ version: 2, items: {} })).toBe(true);
    expect(bad({ version: 1, items: { x: { image: 'https://evil.example/a.jpg' } } })).toBe(true);
    expect(bad({ version: 1, items: { x: { image: '/images/products/../../etc/passwd.webp' } } })).toBe(true);
    expect(bad({ version: 1, items: { x: { image: '//evil.example/a.webp' } } })).toBe(true);
    expect(bad({ version: 1, items: { x: { image: '/images/hero/hero-1.webp' } } })).toBe(true);
    expect(bad({ version: 1, items: { x: { image: '/images/products/a.svg' } } })).toBe(true);
    expect(bad({ version: 1, items: { 'Bad Slug': { image: '/images/products/a.webp' } } })).toBe(true);
    expect(bad({ version: 1, groups: [{ slugPrefix: 'r', image: '/images/products/a.webp' }] })).toBe(true);
    expect(bad({ version: 1, items: { x: { image: '/images/products/a.webp', alt: 5 } } })).toBe(true);
  });

  it('resolves exact items before groups', () => {
    expect(P.resolveImage(good, 'rose-ruby-red')).toBe('/images/products/roses.webp');
    expect(P.resolveImage(good, 'hydrangea-fresh-green')).toBe('/images/products/hydrangea.jpg');
    expect(P.resolveImage(good, 'sunflowers')).toBeNull();
  });

  it('only empty / placeholder / competitor hotlinks are replaceable; Cloudinary and owner images never', () => {
    for (const v of [null, undefined, '', '  ', '/images/placeholder-bloom.jpg', 'https://cdn.shopify.com/s/files/1/x.jpg', 'https://theflora.in/a.jpg', '//cdn.shopify.com/a.jpg', 'cdn.shopify.com/a.jpg', 'https://www.theflora.in/a.jpg']) {
      expect([v, P.isReplaceableImage(v)]).toEqual([v, true]);
    }
    for (const v of ['https://res.cloudinary.com/demo/image/upload/v1/a.jpg', 'https://images.pexels.com/a.jpeg', 'https://example.com/notshopify.jpg', 'https://cdn.shopify.com.evil.example/a.jpg']) {
      expect([v, P.isReplaceableImage(v, { force: true })]).toEqual([v, false]);
    }
    expect(P.isReplaceableImage('/images/products/old.webp')).toBe(false);
    expect(P.isReplaceableImage('/images/products/old.webp', { force: true })).toBe(true);
  });

  it('plans images only for replaceable rows whose mapped file exists, and is idempotent', () => {
    const rows = [
      { id: 1, slug: 'rose-ruby-red', image: null },
      { id: 2, slug: 'hydrangea-fresh-green', image: 'https://cdn.shopify.com/a.jpg' },
      { id: 3, slug: 'hydrangea-blush-pink', image: 'https://res.cloudinary.com/demo/image/upload/v1/own.jpg' },
      { id: 4, slug: 'sunflowers', image: null },
      { id: 5, slug: 'hydrangea-pearl-white', image: '/images/placeholder-bloom.jpg' },
    ];
    const r = P.planImages(rows, good, { fileExists: (p: string) => p !== '/images/products/hydrangea.jpg' });
    expect(r.changes.map((c: any) => c.key)).toEqual(['rose-ruby-red']);
    expect(r.counts).toEqual({ 'file-missing': 2, 'has-own-image': 1, unmapped: 1 });
    const r2 = P.planImages(rows, good, { fileExists: () => true });
    expect(r2.changes.map((c: any) => c.key)).toEqual(['rose-ruby-red', 'hydrangea-fresh-green', 'hydrangea-pearl-white']);
    const applied = rows.map((x) => ({ ...x, ...(r2.changes.find((c: any) => c.id === x.id)?.after ?? {}) }));
    expect(P.planImages(applied, good, { fileExists: () => true }).changes).toEqual([]);
    expect(applied[2].image).toContain('res.cloudinary.com');
  });
});

describe('planRestore', () => {
  const backup = {
    changes: [
      { table: 'product', id: 1, key: 'a', before: { description: 'old' }, after: { description: 'new' } },
      { table: 'product', id: 2, key: 'b', before: { stock: 0 }, after: { stock: 25 } },
    ],
    createdSliders: [{ id: 9, after: { title: 'T', image: '/i.webp', href: '/p', active: false } }],
  };
  it('reverts untouched fields, leaves later edits alone, deletes unedited created sliders', () => {
    const cur = {
      product: new Map<number, any>([
        [1, { id: 1, description: 'new' }],
        [2, { id: 2, stock: 3 }],
      ]),
      category: new Map<number, any>(),
      slider: new Map<number, any>([[9, { id: 9, title: 'T', image: '/i.webp', href: '/p', active: false }]]),
    };
    const r = P.planRestore(backup, cur);
    expect(r.updates).toEqual([{ table: 'product', id: 1, key: 'a', data: { description: 'old' } }]);
    expect(r.conflicts).toEqual([{ table: 'product', key: 'b', reason: 'stock-changed-since-apply' }]);
    expect(r.deletes).toEqual([{ id: 9, title: 'T' }]);
    expect(P.planRestore(backup, cur, { force: true }).updates).toHaveLength(2);
  });
  it('keeps an edited slider and reports missing rows', () => {
    const cur = {
      product: new Map<number, any>(),
      category: new Map<number, any>(),
      slider: new Map<number, any>([[9, { id: 9, title: 'Edited', image: '/i.webp', href: '/p', active: false }]]),
    };
    const r = P.planRestore(backup, cur);
    expect(r.deletes).toEqual([]);
    expect(r.conflicts.map((c: any) => c.reason)).toEqual(['row-missing', 'row-missing', 'edited-since-apply']);
  });
});

describe('script helpers', () => {
  it('parses flags in both --k=v and --k v forms and rejects junk', () => {
    const a = parseArgs(['--apply', '--stock=40', '--skip', 'featured,categories', '--sliders']);
    expect(a.flags.has('--apply')).toBe(true);
    expect(a.stock).toBe(40);
    expect([...a.skip]).toEqual(['featured', 'categories']);
    expect(parseArgs([]).stock).toBe(25);
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--stock'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--backup', '--apply'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--skip=bogus'])).toThrow(/unknown section/);
    expect(() => parseArgs(['--apply=1'])).toThrow(/takes no value/);
  });
  it('fileExists never escapes the public dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-'));
    fs.mkdirSync(path.join(dir, 'images'));
    fs.writeFileSync(path.join(dir, 'images', 'a.webp'), 'x');
    const ex = makeFileExists(path.resolve(dir));
    expect(ex('/images/a.webp')).toBe(true);
    expect(ex('/images/missing.webp')).toBe(false);
    expect(ex('/images')).toBe(false);
    const outside = `esc-${path.basename(dir)}.txt`;
    fs.writeFileSync(path.join(dir, '..', outside), 'x');
    expect(ex('/../' + outside)).toBe(false);
    fs.rmSync(path.join(dir, '..', outside), { force: true });
    expect(makeFileExists(null)('/images/a.webp')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
