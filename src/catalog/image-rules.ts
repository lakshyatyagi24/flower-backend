export interface ImageRule {
  match: string;
  key: string;
}

export interface InterimImage {
  source: string;
  file: string;
  photographer?: string;
  photographerUrl?: string;
}

export interface InterimManifest {
  licence?: string;
  rules: ImageRule[];
  images: Record<string, InterimImage>;
}

/**
 * Returns the interim-photo key for a product name, or null when no rule
 * matches. Rules are tried in order (most specific first); matching is
 * case-insensitive.
 */
export function matchKey(name: string, rules: ImageRule[]): string | null {
  const n = (name ?? '').toLowerCase();
  for (const r of rules) {
    if (new RegExp(r.match, 'i').test(n)) return r.key;
  }
  return null;
}
