import { round2 } from '../common/money';

export interface TaxLine {
  /** price * quantity of one order line, before any discount. */
  lineTotal: number;
  /** GST percentage of that line (0 when none). */
  gstRate: number;
}

/**
 * Spread a coupon discount over the lines in proportion to their value. Every line but the last gets
 * round2(discount * line / subtotal); the last line takes the remainder, so the allocations add up to the discount
 * exactly (to the paisa) whatever the rounding did.
 */
export function allocateDiscount(lineTotals: number[], discount: number): number[] {
  const bases = lineTotals.map(round2);
  const subtotal = bases.reduce((s, b) => s + b, 0);
  if (!(discount > 0) || !(subtotal > 0) || bases.length === 0) return bases.map(() => 0);
  const out: number[] = [];
  let allocated = 0;
  bases.forEach((b, i) => {
    if (i === bases.length - 1) {
      out.push(round2(discount - allocated));
    } else {
      const part = round2((discount * b) / subtotal);
      out.push(part);
      allocated += part;
    }
  });
  return out;
}

/**
 * GST per line on the taxable value AFTER the discount (CGST Act s.15(3)(a): a discount known at the time of supply
 * reduces the value of supply): round2((line - lineDiscount) * rate / 100). Zero-rate lines stay zero.
 */
export function gstPerLine(lines: TaxLine[], discount: number): number[] {
  const alloc = allocateDiscount(lines.map((l) => l.lineTotal), discount);
  return lines.map((l, i) => round2((Math.max(round2(l.lineTotal) - alloc[i], 0) * (l.gstRate || 0)) / 100));
}
