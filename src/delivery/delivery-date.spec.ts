import {
  addDays, computeEarliest, computeOptions, findInvalidBlackoutTokens, formatDeliveryDate, isIsoDate, isValidCutoff,
  isValidDaysAhead, isValidLeadTimeDays, istNow, parseBlackoutDates, parseCutoff, parseDaysAhead, parseLeadTimeDays,
  toStoredDate, type DeliveryConfig,
} from './delivery-date';

const cfg = (over: Partial<DeliveryConfig> = {}): DeliveryConfig => ({
  cutoffMinutes: 15 * 60, leadTimeDays: 0, daysAhead: 14, blackout: [], ...over,
});

describe('istNow', () => {
  it('converts a UTC instant to the IST date and minutes', () => {
    expect(istNow(new Date('2026-10-13T05:00:00Z'))).toEqual({ date: '2026-10-13', minutes: 10 * 60 + 30 });
  });
  it('rolls the date over when UTC is late evening (19:00Z = 00:30 IST next day)', () => {
    expect(istNow(new Date('2026-10-13T19:00:00Z'))).toEqual({ date: '2026-10-14', minutes: 30 });
  });
  it('handles month and year rollover', () => {
    expect(istNow(new Date('2026-12-31T20:00:00Z')).date).toBe('2027-01-01');
  });
});

describe('computeEarliest', () => {
  it('before cut-off: same IST day', () => {
    // 14:59 IST = 09:29Z
    expect(computeEarliest(new Date('2026-10-13T09:29:00Z'), cfg())).toBe('2026-10-13');
  });
  it('exactly at cut-off: next day', () => {
    expect(computeEarliest(new Date('2026-10-13T09:30:00Z'), cfg())).toBe('2026-10-14');
  });
  it('after cut-off: next day', () => {
    expect(computeEarliest(new Date('2026-10-13T12:00:00Z'), cfg())).toBe('2026-10-14');
  });
  it('late-evening UTC is already the next IST day (00:30 IST, before cut-off)', () => {
    expect(computeEarliest(new Date('2026-10-13T19:00:00Z'), cfg())).toBe('2026-10-14');
  });
  it('22:30 IST on the 13th (after cut-off) gives the 14th', () => {
    expect(computeEarliest(new Date('2026-10-13T17:00:00Z'), cfg())).toBe('2026-10-14');
  });
  it('adds lead time days (after the cut-off day shift)', () => {
    expect(computeEarliest(new Date('2026-10-13T05:00:00Z'), cfg({ leadTimeDays: 2 }))).toBe('2026-10-15');
    expect(computeEarliest(new Date('2026-10-13T12:00:00Z'), cfg({ leadTimeDays: 2 }))).toBe('2026-10-16');
  });
  it('skips a blackout landing on the earliest date', () => {
    expect(computeEarliest(new Date('2026-10-13T05:00:00Z'), cfg({ blackout: ['2026-10-13'] }))).toBe('2026-10-14');
  });
  it('skips consecutive blackout dates', () => {
    const blackout = ['2026-10-13', '2026-10-14', '2026-10-15'];
    expect(computeEarliest(new Date('2026-10-13T05:00:00Z'), cfg({ blackout }))).toBe('2026-10-16');
  });
  it('ignores blackout dates that are not in the way', () => {
    expect(computeEarliest(new Date('2026-10-13T05:00:00Z'), cfg({ blackout: ['2026-10-20'] }))).toBe('2026-10-13');
  });
  it('terminates when blackouts cover more than the safety cap', () => {
    const blackout = Array.from({ length: 500 }, (_, i) => addDays('2026-10-13', i));
    expect(() => computeEarliest(new Date('2026-10-13T05:00:00Z'), cfg({ blackout }))).not.toThrow();
  });
  it('a 00:00 cut-off always moves to the next day', () => {
    // 2026-10-13T18:31Z = 00:01 IST on the 14th -> next day is the 15th
    expect(computeEarliest(new Date('2026-10-13T18:31:00Z'), cfg({ cutoffMinutes: 0 }))).toBe('2026-10-15');
  });
});

describe('computeOptions', () => {
  const now = new Date('2026-10-13T05:00:00Z');
  it('latest is earliest + daysAhead', () => {
    expect(computeOptions(now, cfg({ daysAhead: 14 }))).toEqual({
      earliest: '2026-10-13', latest: '2026-10-27', blackoutDates: [],
    });
  });
  it('lists only blackout dates inside the window (edges inclusive)', () => {
    const o = computeOptions(now, cfg({
      daysAhead: 3, blackout: ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-17'],
    }));
    expect(o.latest).toBe('2026-10-16');
    expect(o.blackoutDates).toEqual(['2026-10-14', '2026-10-16']);
  });
});

describe('settings parsing falls back to defaults', () => {
  it('cutoff', () => {
    expect(parseCutoff('09:30')).toEqual({ text: '09:30', minutes: 570 });
    for (const bad of ['', '25:00', '9:30', 'noon', '15:60', null, undefined]) {
      expect(parseCutoff(bad as any)).toEqual({ text: '15:00', minutes: 900 });
    }
  });
  it('lead time 0..30', () => {
    expect(parseLeadTimeDays('3')).toBe(3);
    for (const bad of ['', '-1', '31', '1.5', 'two', undefined]) expect(parseLeadTimeDays(bad as any)).toBe(0);
  });
  it('days ahead 1..90', () => {
    expect(parseDaysAhead('30')).toBe(30);
    for (const bad of ['', '0', '91', '7.5', 'x', undefined]) expect(parseDaysAhead(bad as any)).toBe(14);
  });
  it('blackout list ignores junk, impossible dates and duplicates, and sorts', () => {
    expect(parseBlackoutDates('2026-11-01, nope 2026-02-30\n2026-10-31;2026-11-01')).toEqual(['2026-10-31', '2026-11-01']);
    expect(parseBlackoutDates(undefined)).toEqual([]);
  });
});

describe('strict save-time validators', () => {
  it('accepts and rejects', () => {
    expect(isValidCutoff('15:00')).toBe(true);
    expect(isValidCutoff('24:00')).toBe(false);
    expect(isValidLeadTimeDays('30')).toBe(true);
    expect(isValidLeadTimeDays('31')).toBe(false);
    expect(isValidDaysAhead('1')).toBe(true);
    expect(isValidDaysAhead('0')).toBe(false);
    expect(findInvalidBlackoutTokens('2026-10-31, tomorrow, 2026-13-01')).toEqual(['tomorrow', '2026-13-01']);
  });
});

describe('formatting and storage', () => {
  it('isIsoDate is strict', () => {
    expect(isIsoDate('2026-10-14')).toBe(true);
    expect(isIsoDate('2026-10-14T00:00:00Z')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate(20261014)).toBe(false);
  });
  it('formats as a long date from a string or a stored Date', () => {
    expect(formatDeliveryDate('2026-10-14')).toBe('Wednesday, 14 October 2026');
    expect(formatDeliveryDate(toStoredDate('2026-10-14'))).toBe('Wednesday, 14 October 2026');
    expect(formatDeliveryDate(null)).toBe('');
    expect(formatDeliveryDate(new Date('invalid'))).toBe('');
  });
  it('stores UTC midnight', () => {
    expect(toStoredDate('2026-10-14').toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});
