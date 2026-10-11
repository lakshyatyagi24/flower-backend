/** Parse TRUST_PROXY (integer hop count). Unset/empty/NaN/<=0 -> null (no trust). */
export function parseTrustProxy(value: string | undefined): number | null {
  if (!value || !/^\s*\d+\s*$/.test(value)) return null;
  const n = parseInt(value, 10);
  return n > 0 ? n : null;
}
