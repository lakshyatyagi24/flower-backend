import { BadRequestException } from '@nestjs/common';
import { round2, formatRupees } from '../common/money';
import { computeDiscount, CouponLike, evaluateCoupon, normalizeCouponCode } from './coupon-rules';

const coupon = (over: Partial<CouponLike> = {}): CouponLike => ({
  id: 1, code: 'SAVE10', type: 'PERCENT', value: 10, minSubtotal: 0, maxDiscount: null, expiresAt: null,
  maxUses: null, usedCount: 0, active: true, ...over,
});

const msg = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return String(((e as BadRequestException).getResponse() as any).message);
  }
  throw new Error('did not throw');
};

describe('money helpers', () => {
  it('round2 rounds half-up to paise and survives float noise', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10.004)).toBe(10);
    expect(round2(2.675)).toBe(2.68);
  });
  it('formatRupees trims zeros', () => {
    expect(formatRupees(50)).toBe('50');
    expect(formatRupees(12.5)).toBe('12.5');
    expect(formatRupees(0.75)).toBe('0.75');
    expect(formatRupees(100.1 - 0.0999999)).toBe('100');
  });
});

describe('normalizeCouponCode', () => {
  it('trims and upper-cases; non-strings are empty', () => {
    expect(normalizeCouponCode('  save10 \n')).toBe('SAVE10');
    expect(normalizeCouponCode(undefined)).toBe('');
    expect(normalizeCouponCode(42)).toBe('');
  });
});

describe('computeDiscount', () => {
  it('percent: value% of the subtotal, 2 dp', () => {
    expect(computeDiscount(coupon(), 999)).toBe(99.9);
    expect(computeDiscount(coupon({ value: 15 }), 333.33)).toBe(50);
    expect(computeDiscount(coupon({ value: 12.5 }), 99.99)).toBe(12.5);
  });
  it('percent: capped by maxDiscount', () => {
    expect(computeDiscount(coupon({ value: 50, maxDiscount: 100 }), 1000)).toBe(100);
    expect(computeDiscount(coupon({ value: 50, maxDiscount: 100 }), 100)).toBe(50);
  });
  it('flat: min(value, subtotal)', () => {
    expect(computeDiscount(coupon({ type: 'FLAT', value: 200 }), 1000)).toBe(200);
    expect(computeDiscount(coupon({ type: 'FLAT', value: 200 }), 150)).toBe(150);
  });
  it('100% takes exactly the subtotal and never more; zero or negative subtotal gives 0', () => {
    expect(computeDiscount(coupon({ value: 100 }), 480.5)).toBe(480.5);
    expect(computeDiscount(coupon(), 0)).toBe(0);
    expect(computeDiscount(coupon({ type: 'FLAT', value: 50 }), -10)).toBe(0);
  });
  it('rounds paise half-up', () => {
    expect(computeDiscount(coupon({ value: 7.5 }), 10.01)).toBe(0.75);
    expect(computeDiscount(coupon({ value: 33 }), 0.05)).toBe(0.02);
  });
});

describe('evaluateCoupon', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  it('unknown and inactive give the identical error (no oracle)', () => {
    expect(msg(() => evaluateCoupon(null, 500, now))).toBe('Coupon not found');
    expect(msg(() => evaluateCoupon(coupon({ active: false }), 500, now))).toBe('Coupon not found');
  });
  it('inactive wins over expired / exhausted so those states do not leak either', () => {
    const c = coupon({ active: false, expiresAt: new Date('2020-01-01'), maxUses: 1, usedCount: 1 });
    expect(msg(() => evaluateCoupon(c, 500, now))).toBe('Coupon not found');
  });
  it('expired (at or before now)', () => {
    expect(msg(() => evaluateCoupon(coupon({ expiresAt: new Date('2026-10-14T09:59:59Z') }), 500, now))).toBe('Coupon expired');
    expect(msg(() => evaluateCoupon(coupon({ expiresAt: now }), 500, now))).toBe('Coupon expired');
    expect(evaluateCoupon(coupon({ expiresAt: new Date('2026-10-14T10:00:01Z') }), 500, now)).toBe(50);
  });
  it('usage limit reached when usedCount >= maxUses', () => {
    expect(msg(() => evaluateCoupon(coupon({ maxUses: 5, usedCount: 5 }), 500, now))).toBe('Coupon usage limit reached');
    expect(msg(() => evaluateCoupon(coupon({ maxUses: 5, usedCount: 6 }), 500, now))).toBe('Coupon usage limit reached');
    expect(evaluateCoupon(coupon({ maxUses: 5, usedCount: 4 }), 500, now)).toBe(50);
  });
  it('minimum subtotal: tells how much more to add, 2 dp trimmed', () => {
    expect(msg(() => evaluateCoupon(coupon({ minSubtotal: 1000 }), 750, now))).toBe('Add ₹250 more to use this coupon');
    expect(msg(() => evaluateCoupon(coupon({ minSubtotal: 1000 }), 999.5, now))).toBe('Add ₹0.5 more to use this coupon');
    expect(msg(() => evaluateCoupon(coupon({ minSubtotal: 500.75 }), 100, now))).toBe('Add ₹400.75 more to use this coupon');
    expect(evaluateCoupon(coupon({ minSubtotal: 1000 }), 1000, now)).toBe(100);
  });
  it('error precedence: expired, then usage, then minimum', () => {
    const c = coupon({ expiresAt: new Date('2020-01-01'), maxUses: 1, usedCount: 1, minSubtotal: 9999 });
    expect(msg(() => evaluateCoupon(c, 1, now))).toBe('Coupon expired');
    expect(msg(() => evaluateCoupon({ ...c, expiresAt: null }, 1, now))).toBe('Coupon usage limit reached');
  });
  it('errors carry field=couponCode so the storefront can tell them from other 400s', () => {
    let body: any;
    try {
      evaluateCoupon(null, 1, now);
    } catch (e) {
      body = (e as BadRequestException).getResponse();
    }
    expect(body.field).toBe('couponCode');
  });
});
