import { BadRequestException } from '@nestjs/common';
import { buildOrderSearchWhere, escapeLike, resolveDayRange, zeroFillSeries } from './orders-query';
import { round2 } from '../common/money';

const orOf = (q: string) => (buildOrderSearchWhere(q) as any).OR as any[];

describe('buildOrderSearchWhere', () => {
  it('returns null for empty / non-string input', () => {
    expect(buildOrderSearchWhere('')).toBeNull();
    expect(buildOrderSearchWhere('   ')).toBeNull();
    expect(buildOrderSearchWhere('#')).toBeNull();
    expect(buildOrderSearchWhere(undefined)).toBeNull();
    expect(buildOrderSearchWhere(['a'] as any)).toBeNull();
  });

  it('digits search by exact id as well as partial phone', () => {
    const or = orOf('12345');
    expect(or).toContainEqual({ id: 12345 });
    expect(or).toContainEqual({ customerPhone: { contains: '12345' } });
    expect(orOf('#77')).toContainEqual({ id: 77 });
  });

  it('short digit strings (< 3) do not partial-match phones', () => {
    expect(orOf('42').some((c) => 'customerPhone' in c)).toBe(false);
  });

  it('huge digit strings are not treated as ids (avoids int overflow)', () => {
    expect(orOf('12345678901').some((c) => 'id' in c)).toBe(false);
  });

  it('normalises phone input: spaces, +91, dashes, leading 0', () => {
    expect(orOf('+91 98765-43210')).toContainEqual({ customerPhone: { contains: '9876543210' } });
    expect(orOf('098765 43210')).toContainEqual({ customerPhone: { contains: '9876543210' } });
    expect(orOf('(987) 654')).toContainEqual({ customerPhone: { contains: '987654' } });
  });

  it('email and name are case-insensitive partial matches', () => {
    const or = orOf('Asha@Example');
    expect(or).toContainEqual({ customerEmail: { contains: 'Asha@Example', mode: 'insensitive' } });
    expect(or).toContainEqual({ customerName: { contains: 'Asha@Example', mode: 'insensitive' } });
    expect(or.some((c) => 'customerPhone' in c || 'id' in c)).toBe(false);
  });

  it('escapes LIKE wildcards and the escape char itself', () => {
    expect(escapeLike('100%_off\\x')).toBe('100\\%\\_off\\\\x');
    expect(orOf('a%b_c')).toContainEqual({ customerName: { contains: 'a\\%b\\_c', mode: 'insensitive' } });
  });

  it('caps very long terms', () => {
    const or = orOf('x'.repeat(500));
    expect(or[0].customerEmail.contains).toHaveLength(100);
  });
});

describe('resolveDayRange', () => {
  const now = new Date('2026-10-15T20:00:00Z'); // 01:30 IST on the 16th

  it('defaults to the last 30 IST days ending today (IST, not UTC)', () => {
    const r = resolveDayRange(undefined, undefined, now);
    expect(r.to).toBe('2026-10-16');
    expect(r.from).toBe('2026-09-17');
    expect(r.days).toHaveLength(30);
    expect(r.fromUtc.toISOString()).toBe('2026-09-16T18:30:00.000Z');
    expect(r.toUtcExclusive.toISOString()).toBe('2026-10-16T18:30:00.000Z');
  });

  it('accepts an explicit range, inclusive on both ends', () => {
    const r = resolveDayRange('2026-10-01', '2026-10-03', now);
    expect(r.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('only `to`: 30 days ending there; only `from`: through today', () => {
    expect(resolveDayRange(undefined, '2026-03-31', now).days).toHaveLength(30);
    expect(resolveDayRange('2026-10-10', undefined, now).to).toBe('2026-10-16');
  });

  it('allows exactly 366 days and rejects 367', () => {
    expect(resolveDayRange('2025-10-16', '2026-10-16', now).days).toHaveLength(366);
    expect(() => resolveDayRange('2025-10-15', '2026-10-16', now)).toThrow(BadRequestException);
  });

  it.each([['2026-13-01'], ['2026-02-30'], ['10/01/2026'], ['yesterday'], [['2026-10-01']]])('rejects invalid date %j', (bad) => {
    expect(() => resolveDayRange(bad, undefined, now)).toThrow(BadRequestException);
    expect(() => resolveDayRange(undefined, bad, now)).toThrow(BadRequestException);
  });

  it('rejects from > to', () => {
    expect(() => resolveDayRange('2026-10-05', '2026-10-04', now)).toThrow('from must be on or before to');
  });
});

describe('zeroFillSeries', () => {
  it('returns a point for every day, zero where there are no rows, revenue rounded', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
    const out = zeroFillSeries(
      days,
      [{ date: '2026-10-03', orders: 2, revenue: 10.005 }, { date: '2026-10-01', orders: 1, revenue: null }],
      round2,
    );
    expect(out).toEqual([
      { date: '2026-10-01', orders: 1, revenue: 0 },
      { date: '2026-10-02', orders: 0, revenue: 0 },
      { date: '2026-10-03', orders: 2, revenue: 10.01 },
    ]);
  });
});
