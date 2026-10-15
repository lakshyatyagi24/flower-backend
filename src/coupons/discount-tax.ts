import { round2 } from '../common/money';

export interface TaxLine {
  /** price * quantity of one order line, before any discount. */
  lineTotal: number;
  /** GST percentage of that line (0 when none). */
  gstRate: number;
}

/**
 * Spread a coupon discount over the lines in proportion to their value, in whole paise so nothing drifts.
 *
 * Each line first gets floor(discount * line / subtotal). The few leftover paise (fewer than the number of lines)
 * go to the LARGEST line (ties: the later one), and every share is clamped to [0, line value]: whatever does not
 * fit on a line is passed on to the next largest line that still has room. So the shares always add up to the
 * discount exactly (the discount itself is clamped to the subtotal), none is negative and none exceeds its line.
 * Mirrored by the storefront (frontend/src/lib/coupon.ts); both are pinned by the same fixtures.
 */
export function allocateDiscount(lineTotals: number[], discount: number): number[] {
  const cents = lineTotals.map((l) => Math.max(Math.round(round2(l) * 100), 0));
  const subtotal = cents.reduce((s, c) => s + c, 0);
  const want = Math.min(Math.max(Math.round(round2(discount) * 100), 0), subtotal);
  if (want === 0 || subtotal === 0) return cents.map(() => 0);

  const share = cents.map((c) => Math.floor((want * c) / subtotal));
  let left = want - share.reduce((s, x) => s + x, 0);
  const order = cents.map((_, i) => i).sort((a, b) => cents[b] - cents[a] || b - a);
  for (const i of order) {
    if (left <= 0) break;
    const add = Math.min(left, cents[i] - share[i]);
    share[i] += add;
    left -= add;
  }
  return share.map((s) => s / 100);
}

/**
 * GST per line on the taxable value AFTER the discount (CGST Act s.15(3)(a): a discount known at the time of supply
 * reduces the value of supply): round2((line - lineDiscount) * rate / 100). Zero-rate lines stay zero.
 */
export function gstPerLine(lines: TaxLine[], discount: number): number[] {
  const alloc = allocateDiscount(lines.map((l) => l.lineTotal), discount);
  return lines.map((l, i) => round2((Math.max(round2(l.lineTotal) - alloc[i], 0) * (l.gstRate || 0)) / 100));
}
