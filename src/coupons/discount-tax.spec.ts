import { allocateDiscount, gstPerLine } from './discount-tax';

// The same fixtures are asserted by the storefront (frontend/src/lib/__tests__/coupon.test.ts).
describe('allocateDiscount', () => {
  it('splits in proportion and the last line takes the remainder so the sum is exact', () => {
    expect(allocateDiscount([333.33, 333.33, 333.34], 100)).toEqual([33.33, 33.33, 33.34]);
    expect(allocateDiscount([100, 100, 100], 10)).toEqual([3.33, 3.33, 3.34]);
    expect(allocateDiscount([1000], 200)).toEqual([200]);
  });
  it('always adds up to the discount', () => {
    for (const [lines, d] of [
      [[19.99, 5.01, 74.5], 17.77],
      [[0.01, 0.01, 0.01], 0.02],
      [[250, 125.5, 99.99, 10], 100],
    ] as Array<[number[], number]>) {
      const sum = allocateDiscount(lines, d).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(d * 100));
    }
  });
  it('no discount or no value gives zeros', () => {
    expect(allocateDiscount([100, 50], 0)).toEqual([0, 0]);
    expect(allocateDiscount([], 10)).toEqual([]);
  });
});

describe('gstPerLine', () => {
  it('taxes the value after the discount: 1000 less 200 at 18% is 144', () => {
    expect(gstPerLine([{ lineTotal: 1000, gstRate: 18 }], 200)).toEqual([144]);
  });
  it('without a discount it is line * rate', () => {
    expect(gstPerLine([{ lineTotal: 1000, gstRate: 18 }], 0)).toEqual([180]);
  });
  it('zero-rate lines stay zero', () => {
    expect(gstPerLine([{ lineTotal: 500, gstRate: 0 }, { lineTotal: 500, gstRate: 18 }], 100)).toEqual([0, 81]);
  });
  it('multi-line fixture: taxable 300 each', () => {
    expect(
      gstPerLine(
        [{ lineTotal: 333.33, gstRate: 18 }, { lineTotal: 333.33, gstRate: 12 }, { lineTotal: 333.34, gstRate: 5 }],
        100,
      ),
    ).toEqual([54, 36, 15]);
  });
});
