const EXACT = /^[1-9]\d{5}$/;
// Prefix pattern: 1-5 leading digits followed by '*', e.g. "1100*".
const PREFIX = /^[1-9]\d{0,4}\*$/;
// Zero-width / BOM characters that sneak in when pasting from documents or chat apps.
const ZERO_WIDTH = /[​-‍﻿]/g;

export interface ParsedPincodeRules {
  exact: Set<string>;
  prefixes: string[];
}

function tokens(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .replace(ZERO_WIDTH, '')
    .split(/[\s,;]+/)
    .filter(Boolean);
}

/** Parse `delivery.supportedPincodes`. Separators: commas, whitespace, newlines, semicolons. Junk tokens are ignored. */
export function parsePincodeRules(raw: string | null | undefined): ParsedPincodeRules {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const token of tokens(raw)) {
    if (EXACT.test(token)) exact.add(token);
    else if (PREFIX.test(token)) prefixes.push(token.slice(0, -1));
  }
  return { exact, prefixes };
}

/** Tokens that are neither an exact 6-digit PIN nor a prefix like `1100*`. Used to reject bad admin input. */
export function findInvalidPincodeTokens(raw: string | null | undefined): string[] {
  return tokens(raw).filter((t) => !EXACT.test(t) && !PREFIX.test(t));
}
