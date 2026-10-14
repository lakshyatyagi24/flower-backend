import { BadRequestException } from '@nestjs/common';
import { formatRupees, round2 } from '../common/money';

export type CouponType = 'PERCENT' | 'FLAT';

export interface CouponLike {
  id: number;
  code: string;
  type: CouponType;
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
}

/** Razorpay will not create an order below 1 rupee, and a free order has nothing to pay: floor for a discounted total. */
export const MIN_DISCOUNTED_TOTAL = 1;

export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** Trim + upper-case. Every entry point (validate, order create, admin save) uses this. */
export function normalizeCouponCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

/** Thrown for every coupon problem so the storefront can tell a coupon error from any other 400. */
export function couponError(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, message, error: 'Bad Request', field: 'couponCode' });
}

/** Discount for a subtotal, ignoring eligibility. 2 dp, never negative, never above the subtotal. */
export function computeDiscount(c: Pick<CouponLike, 'type' | 'value' | 'maxDiscount'>, subtotal: number): number {
  const base = round2(Math.max(subtotal, 0));
  const raw = c.type === 'PERCENT' ? (base * c.value) / 100 : c.value;
  const capped = c.type === 'PERCENT' && c.maxDiscount != null ? Math.min(raw, c.maxDiscount) : raw;
  return Math.min(Math.max(round2(capped), 0), base);
}

/**
 * Eligibility + amount for a coupon row that was just read. Pure; `subtotal` is the PRE-discount, pre-shipping,
 * pre-GST item subtotal (R19: minSubtotal is judged on it). An inactive coupon is reported exactly like an
 * unknown one so the endpoint is not an oracle for which codes exist but are switched off.
 */
export function evaluateCoupon(c: CouponLike | null, subtotal: number, now: Date = new Date()): number {
  if (!c || !c.active) throw couponError('Coupon not found');
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) throw couponError('Coupon expired');
  if (c.maxUses != null && c.usedCount >= c.maxUses) throw couponError('Coupon usage limit reached');
  const base = round2(subtotal);
  if (base < c.minSubtotal) {
    throw couponError(`Add ₹${formatRupees(c.minSubtotal - base)} more to use this coupon`);
  }
  return computeDiscount(c, base);
}

export function belowMinimumTotalError(): BadRequestException {
  return couponError(
    `This coupon would bring your total below ₹${MIN_DISCOUNTED_TOTAL}. Add more items to use it.`,
  );
}
