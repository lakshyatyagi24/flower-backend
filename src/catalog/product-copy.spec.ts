/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import * as fs from 'fs';
import * as path from 'path';

const { PRODUCT_COPY, COPY_STATUS, descriptionFor } = require('../../prisma/data/product-copy');
const { cutFlowerProducts } = require('../../prisma/data/cut-flowers');
const { isCompetitorCopy } = require('../../prisma/data/catalogue-plan');

/**
 * Same list the storefront claims test uses (frontend src/__tests__/claims.test.ts BANNED_PHRASES), plus claims specific to
 * product copy: packaging, sourcing, freshness timing, puffery, health. Keep this list in step with that file.
 */
const BANNED = [
  'same-day', 'same day', 'free delivery', 'within a few hours', 'limited time', 'farm-fresh', 'next-day', '24 hours', 'guarantee',
  'flower food', 'care card', 'brown paper', 'wrapped', 'packaged', 'packed', 'floral art', 'cone',
  'premium', 'luxury', 'luxurious', 'finest', 'best', 'handpicked', 'hand-picked', 'sourced', 'imported', 'mandi', 'farm',
  'freshly cut', 'fresh-cut', 'freshest', 'fresh from', 'delivered', 'delivery', 'shipping',
  'organic', 'sustainable', 'hypoallergenic', 'allergy', 'allergic', 'allergen', 'non-toxic', 'toxic', 'poison', 'safe for', 'healthy', 'cure',
  'stems per', 'dozen', 'award', 'rated', '100%', 'always', 'never fades', 'will last', 'lasts for',
];

describe('product copy (DRAFT, owner to review)', () => {
  const entries = Object.entries(PRODUCT_COPY) as [string, { description: string }][];

  it('is marked DRAFT and the file header says so', () => {
    expect(COPY_STATUS).toBe('DRAFT');
    const src = fs.readFileSync(path.join(__dirname, '../../prisma/data/product-copy.js'), 'utf8');
    expect(src.split('\n')[0]).toMatch(/DRAFT/);
  });

  it('covers exactly the 95 seeded cut-flower products', () => {
    expect(cutFlowerProducts).toHaveLength(95);
    expect(entries.map(([s]) => s).sort()).toEqual(cutFlowerProducts.map((p: { slug: string }) => p.slug).sort());
  });

  it('throws for a slug it has no rule for', () => {
    expect(() => descriptionFor('mystery-flower')).toThrow(/no copy rule/);
    expect(() => descriptionFor('rose-neon-green')).toThrow(/no copy rule/);
  });

  it('gives every product a distinct single-paragraph description of sensible length', () => {
    const seen = new Set<string>();
    for (const [, { description }] of entries) {
      expect(description.length).toBeGreaterThan(200);
      expect(description.length).toBeLessThan(620);
      expect(description).not.toMatch(/\n/);
      expect(description.trim()).toBe(description);
      expect(seen.has(description)).toBe(false);
      seen.add(description);
      const sentences = description.split(/(?<=\.)\s+/).length;
      expect(sentences).toBeGreaterThanOrEqual(3);
      expect(sentences).toBeLessThanOrEqual(6);
    }
  });

  it('contains none of the banned claims, no exclamation marks and no competitor-copy markers', () => {
    const offenders: string[] = [];
    for (const [slug, { description }] of entries) {
      const lower = description.toLowerCase();
      const words = lower.split(/[^a-z0-9%-]+/);
      for (const b of BANNED) {
        // single words match whole words only ("best" must not hit "bestow"); phrases match as substrings
        const hit = /^[a-z]+$/.test(b) ? words.includes(b) : lower.includes(b);
        if (hit) offenders.push(`${slug}: "${b}"`);
      }
      if (description.includes('!')) offenders.push(`${slug}: exclamation mark`);
      if (isCompetitorCopy(description)) offenders.push(`${slug}: competitor marker`);
    }
    expect(offenders).toEqual([]);
  });

  it('states no stem counts', () => {
    for (const [slug, { description }] of entries) {
      expect([slug, /\b\d+\s*stems?\b|bunch of \d/i.test(description)]).toEqual([slug, false]);
    }
  });

  it('is not derived from the competitor snapshot text (no 8-word run in common)', () => {
    const oldNorm = cutFlowerProducts
      .map((p: { description: string }) => p.description)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z ]+/g, ' ')
      .replace(/\s+/g, ' ');
    for (const [slug, { description }] of entries) {
      const w = description.toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
      for (let i = 0; i + 8 <= w.length; i += 1) {
        const run = w.slice(i, i + 8).join(' ');
        if (oldNorm.includes(run)) throw new Error(`${slug}: shares an 8-word run with the competitor text: "${run}"`);
      }
    }
  });
});
