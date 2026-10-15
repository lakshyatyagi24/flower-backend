/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Sentry event payloads are untyped by design */
/**
 * PII / secret scrubbing for Sentry events. Pure functions, no SDK import, so the
 * rules are unit-testable and shared in spirit with the storefront/admin copies.
 *
 * Policy: request bodies, cookies, auth headers, e-mail addresses, phone-like
 * numbers in free text, and anything keyed like a secret never leave the server.
 */

export const REDACTED = '[Filtered]';

const SENSITIVE_KEY =
  /pass(word)?|pwd|secret|token|authori[sz]ation|cookie|api[-_]?key|signature|otp|credential|card|cvv|jwt|session|email|phone|mobile|address|pincode|gstin/i;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-razorpay-signature',
  'x-forwarded-for',
  'x-real-ip',
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const QUERY_SECRET_RE =
  /([?&](?:[^=&#]*(?:token|key|secret|password|email|code|signature|otp)[^=&#]*)=)[^&#]*/gi;

export function redactString(value: string): string {
  return value
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(EMAIL_RE, REDACTED)
    .replace(QUERY_SECRET_RE, `$1${REDACTED}`);
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactDeep(v, depth + 1);
  }
  return out;
}

function scrubHeaders(headers: unknown): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    out[k] =
      SENSITIVE_HEADERS.has(k.toLowerCase()) || SENSITIVE_KEY.test(k)
        ? REDACTED
        : redactDeep(v);
  }
  return out;
}

/** Loose structural type: keeps this module free of SDK types. */

type AnyEvent = Record<string, any>;

export function scrubEvent<T extends AnyEvent>(event: T): T {
  const e = event as AnyEvent;

  if (e.request) {
    const r = e.request;
    delete r.data; // request bodies: never sent
    delete r.cookies;
    r.headers = scrubHeaders(r.headers);
    if (typeof r.url === 'string') r.url = redactString(r.url);
    if (typeof r.query_string === 'string') r.query_string = REDACTED;
    else if (r.query_string) r.query_string = REDACTED;
  }

  if (e.user) {
    // Keep only an opaque id if the app ever sets one; drop identifiers.
    e.user = e.user.id ? { id: String(e.user.id) } : undefined;
  }
  delete e.server_name;

  if (typeof e.message === 'string') e.message = redactString(e.message);
  if (e.logentry?.message)
    e.logentry.message = redactString(e.logentry.message);
  for (const ex of e.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = redactString(ex.value);
  }
  if (e.extra) e.extra = redactDeep(e.extra);
  if (e.contexts) e.contexts = redactDeep(e.contexts);
  if (e.tags) e.tags = redactDeep(e.tags);
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs.map((b: AnyEvent) => ({
      ...b,
      message:
        typeof b.message === 'string' ? redactString(b.message) : b.message,
      data: b.data ? redactDeep(b.data) : b.data,
    }));
  }
  return event;
}

/** Expected client errors that are not bugs: Nest HttpException < 500 (401/403/404/429 ...). */
export function isExpectedClientError(original: unknown): boolean {
  if (!original || typeof original !== 'object') return false;
  const getStatus = (original as { getStatus?: unknown }).getStatus;
  if (typeof getStatus !== 'function') return false;
  try {
    const status = (original as { getStatus: () => number }).getStatus();
    return typeof status === 'number' && status < 500;
  } catch {
    return false;
  }
}

export const IGNORED_ERRORS: Array<string | RegExp> = [
  /ThrottlerException/,
  /^NotFoundException/,
  /NEXT_REDIRECT/,
  /NEXT_NOT_FOUND/,
  /ECONNRESET/,
  /aborted/i,
];
