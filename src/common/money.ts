/**
 * Money is stored as Float rupees everywhere in this app (Order.subtotal/total, Product.price), so every
 * amount that is persisted or compared goes through this ONE helper: round half-up to 2 dp (paise).
 * The epsilon makes 1.005 round to 1.01 instead of 1.00 (binary floating point).
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Rupee amount for user-facing messages: at most 2 dp, trailing zeros trimmed ("50", "12.5", "0.75"). */
export function formatRupees(n: number): string {
  return String(round2(n));
}
