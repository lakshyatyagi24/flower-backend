import { BadRequestException } from '@nestjs/common';
import { addDays, IST_OFFSET_MINUTES, isIsoDate, istNow, toStoredDate } from '../delivery/delivery-date';

/** Longest search term we act on (a name / email / phone never needs more). */
export const MAX_SEARCH_LENGTH = 100;

/** Escape LIKE metacharacters. Prisma's `contains` does NOT, so `%` and `_` would act as wildcards. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Admin order search (`GET /orders?q=`). Returns a Prisma `where` fragment, or null for an empty term:
 *  - all digits (<= 9): order id, exact
 *  - customer email / name: case-insensitive partial, LIKE wildcards escaped
 *  - phone-looking input ("+91 98765-43210", "(987) 654"): digits only (a 12-digit 91xxxxxxxxxx or 11-digit
 *    0xxxxxxxxxx collapses to the stored 10-digit form), partial match, needs >= 3 digits
 */
export function buildOrderSearchWhere(raw: string | undefined | null): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim().replace(/^#/, '').trim().slice(0, MAX_SEARCH_LENGTH);
  if (!q) return null;
  const or: Record<string, unknown>[] = [];
  if (/^\d{1,9}$/.test(q)) or.push({ id: parseInt(q, 10) });
  const like = escapeLike(q);
  or.push({ customerEmail: { contains: like, mode: 'insensitive' } });
  or.push({ customerName: { contains: like, mode: 'insensitive' } });
  if (/^[\s+\-().\d]+$/.test(q)) {
    let digits = q.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length >= 3) or.push({ customerPhone: { contains: digits } });
  }
  return { OR: or };
}

export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;

export interface DayRange {
  /** Inclusive IST calendar dates, YYYY-MM-DD. */
  from: string;
  to: string;
  /** UTC instants: [fromUtc, toUtcExclusive) covers exactly the IST days from..to. */
  fromUtc: Date;
  toUtcExclusive: Date;
  days: string[];
}

function istMidnightUtc(isoDate: string): Date {
  // toStoredDate gives UTC midnight of the date; IST midnight is 5h30 earlier in UTC.
  return new Date(toStoredDate(isoDate).getTime() - IST_OFFSET_MINUTES * 60_000);
}

/** Validate `from`/`to` (IST dates). Default: the last 30 days ending today (IST). */
export function resolveDayRange(fromRaw: unknown, toRaw: unknown, now: Date = new Date()): DayRange {
  for (const [name, v] of [['from', fromRaw], ['to', toRaw]] as const) {
    if (v !== undefined && v !== '' && !isIsoDate(v)) {
      throw new BadRequestException(`${name} must be a valid date in YYYY-MM-DD format`);
    }
  }
  const today = istNow(now).date;
  const fromGiven = typeof fromRaw === 'string' && fromRaw ? fromRaw : null;
  const toGiven = typeof toRaw === 'string' && toRaw ? toRaw : null;
  const to = toGiven ?? (fromGiven && fromGiven > today ? fromGiven : today);
  const from = fromGiven ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) throw new BadRequestException('from must be on or before to');
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > MAX_RANGE_DAYS) throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }
  return { from, to, fromUtc: istMidnightUtc(from), toUtcExclusive: istMidnightUtc(addDays(to, 1)), days };
}

export interface SeriesPoint {
  date: string;
  orders: number;
  revenue: number;
}

/** One point for EVERY day in the range; days with no orders are zero. `rows` come from the grouped query. */
export function zeroFillSeries(
  days: string[],
  rows: { date: string; orders: number | bigint; revenue: number | null }[],
  round: (n: number) => number,
): SeriesPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return days.map((date) => {
    const r = byDate.get(date);
    return { date, orders: r ? Number(r.orders) : 0, revenue: r ? round(Number(r.revenue ?? 0)) : 0 };
  });
}
