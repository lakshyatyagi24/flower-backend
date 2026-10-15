import { allocateDiscount, gstPerLine } from './discount-tax';

// require() keeps tsconfig untouched (no resolveJsonModule needed).
interface Fixtures {
  allocations: Array<{ lines: number[]; discount: number; shares: number[] }>;
  gst: Array<{ lines: Array<{ lineTotal: number; gstRate: number }>; discount: number; gst: number[] }>;
  fuzz: { seed: number; baskets: number };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fixtures: Fixtures = require('./discount-fixtures.json');

// discount-fixtures.json is byte-identical to frontend/src/lib/__tests__/discount-fixtures.json: the storefront
// asserts the same cases, so the checkout total can never drift from what the server charges.
const paise = (n: number) => Math.round(n * 100);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocateDiscount (shared fixtures)', () => {
  it.each(fixtures.allocations.map((c) => [JSON.stringify(c.lines) + ' / ' + c.discount, c] as const))(
    '%s',
    (_name, c) => {
      expect(allocateDiscount(c.lines, c.discount)).toEqual(c.shares);
    },
  );

  it('the near-zero line case that used to give -0.01 on the last line', () => {
    const shares = allocateDiscount([4181.78, 755.7, 3.34, 0], 2749.95);
    expect(shares).toEqual([2327.5, 420.6, 1.85, 0]);
    expect(shares.every((s) => s >= 0)).toBe(true);
  });

  it('the rounding remainder goes to the largest line', () => {
    expect(allocateDiscount([100, 100, 100], 10)).toEqual([3.33, 3.33, 3.34]);
    expect(allocateDiscount([50, 100, 50], 0.01)).toEqual([0, 0.01, 0]);
  });

  it('what does not fit on a line moves to another line with room', () => {
    expect(allocateDiscount([0.01, 0.01, 0.01], 0.02)).toEqual([0, 0.01, 0.01]);
  });

  it('no discount, no value, or an oversized discount (clamped to the subtotal)', () => {
    expect(allocateDiscount([100, 50], 0)).toEqual([0, 0]);
    expect(allocateDiscount([], 10)).toEqual([]);
    expect(allocateDiscount([0, 0], 10)).toEqual([0, 0]);
    expect(allocateDiscount([10, 20], 999)).toEqual([10, 20]);
  });
});

describe('gstPerLine (shared fixtures)', () => {
  it.each(fixtures.gst.map((c) => [JSON.stringify(c.lines) + ' / ' + c.discount, c] as const))('%s', (_name, c) => {
    expect(gstPerLine(c.lines, c.discount)).toEqual(c.gst);
  });
});

// Deterministic PRNG so a failure is reproducible (the storefront uses the same generator and seed).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('discount split invariants (seeded fuzz)', () => {
  it(`holds for ${fixtures.fuzz.baskets} random baskets`, () => {
    const rnd = mulberry32(fixtures.fuzz.seed);
    const rates = [0, 5, 12, 18, 28];
    for (let b = 0; b < fixtures.fuzz.baskets; b++) {
      const n = 1 + Math.floor(rnd() * 6);
      const lines = Array.from({ length: n }, () => ({
        lineTotal: (rnd() < 0.1 ? 0 : 1 + Math.floor(rnd() * 500000)) / 100,
        gstRate: rates[Math.floor(rnd() * rates.length)],
      }));
      const subtotalPaise = sum(lines.map((l) => paise(l.lineTotal)));
      const pick = rnd();
      const discountPaise = pick < 0.1 ? subtotalPaise : Math.floor(rnd() * (subtotalPaise + 1));
      const discount = discountPaise / 100;
      const ctx = JSON.stringify({ lines, discount });

      const shares = allocateDiscount(lines.map((l) => l.lineTotal), discount);
      expect([ctx, paise(sum(shares))]).toEqual([ctx, discountPaise]);
      shares.forEach((s, i) => {
        expect([ctx, s >= 0 && paise(s) <= paise(lines[i].lineTotal)]).toEqual([ctx, true]);
      });

      const gst = gstPerLine(lines, discount);
      gst.forEach((g, i) => {
        const taxable = paise(lines[i].lineTotal) - paise(shares[i]);
        expect([ctx, Math.abs(g * 100 - (taxable * lines[i].gstRate) / 100) <= 0.5 + 1e-9]).toEqual([ctx, true]);
      });
      // the order's gst is the sum of its persisted lines
      const orderGst = Math.round(sum(gst) * 100) / 100;
      expect([ctx, paise(orderGst)]).toEqual([ctx, paise(sum(gst))]);
    }
  });
});
