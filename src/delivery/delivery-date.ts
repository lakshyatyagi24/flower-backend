/**
 * Pure delivery-date helpers. Everything is computed in Asia/Kolkata using a fixed +05:30 offset (India has no
 * DST), so results never depend on the host timezone.
 *
 * Storage convention: `Order.deliveryDate` holds UTC midnight of the IST calendar date the customer chose
 * (e.g. 2026-10-14 -> 2026-10-14T00:00:00.000Z). Read it back with UTC accessors / `formatDeliveryDate`.
 */

export const IST_OFFSET_MINUTES = 330;

export const DELIVERY_DEFAULTS = {
  cutoffTime: '15:00',
  leadTimeDays: 0,
  daysAhead: 14,
} as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ZERO_WIDTH = /[​-‍﻿]/g;
const MS_DAY = 86_400_000;

/** Safety cap for the blackout-skipping loop. */
export const MAX_SKIP_DAYS = 400;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUtcMs(iso: string): number {
  const m = ISO_DATE.exec(iso)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * MS_DAY);
}

/** The IST calendar date and minutes-since-midnight for an instant. */
export function istNow(now: Date): { date: string; minutes: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    date: fromUtcMs(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function tokens(raw: string | null | undefined): string[] {
  return (raw ?? '').replace(ZERO_WIDTH, '').split(/[\s,;]+/).filter(Boolean);
}

export function parseCutoff(raw: string | null | undefined): { text: string; minutes: number } {
  const t = (raw ?? '').replace(ZERO_WIDTH, '').trim();
  const m = HHMM.exec(t);
  const text = m ? t : DELIVERY_DEFAULTS.cutoffTime;
  const mm = HHMM.exec(text)!;
  return { text, minutes: Number(mm[1]) * 60 + Number(mm[2]) };
}

function parseIntIn(raw: string | null | undefined, min: number, max: number, fallback: number): number {
  const t = (raw ?? '').replace(ZERO_WIDTH, '').trim();
  if (!/^\d+$/.test(t)) return fallback;
  const n = Number(t);
  return n >= min && n <= max ? n : fallback;
}

export const parseLeadTimeDays = (raw: string | null | undefined) =>
  parseIntIn(raw, 0, 30, DELIVERY_DEFAULTS.leadTimeDays);
export const parseDaysAhead = (raw: string | null | undefined) =>
  parseIntIn(raw, 1, 90, DELIVERY_DEFAULTS.daysAhead);

/** Valid, de-duplicated, sorted ISO dates; junk tokens are ignored (runtime is defensive). */
export function parseBlackoutDates(raw: string | null | undefined): string[] {
  return [...new Set(tokens(raw).filter(isIsoDate))].sort();
}

// ---- Validation helpers used when the owner saves settings (strict, unlike runtime parsing) ----
export const isValidCutoff = (s: string) => HHMM.test(s.trim());
export const isValidLeadTimeDays = (s: string) => /^\d+$/.test(s.trim()) && Number(s.trim()) <= 30;
export const isValidDaysAhead = (s: string) => /^\d+$/.test(s.trim()) && Number(s.trim()) >= 1 && Number(s.trim()) <= 90;
/** Upper bound on blackout entries accepted on save (a year of dates). */
export const MAX_BLACKOUT_DATES = 366;
export const countBlackoutTokens = (raw: string | null | undefined) => tokens(raw).length;
export const findInvalidBlackoutTokens = (raw: string | null | undefined) =>
  tokens(raw).filter((t): boolean => !isIsoDate(t));

export interface DeliveryConfig {
  cutoffMinutes: number;
  leadTimeDays: number;
  daysAhead: number;
  blackout: string[];
}

/** Thrown when blackout dates leave no deliverable day within the safety cap. */
export class NoDeliveryDatesError extends Error {
  constructor() {
    super('No delivery dates are available right now');
  }
}

export function computeEarliest(now: Date, cfg: DeliveryConfig): string {
  const { date, minutes } = istNow(now);
  let candidate = addDays(date, (minutes >= cfg.cutoffMinutes ? 1 : 0) + cfg.leadTimeDays);
  const blocked = new Set(cfg.blackout);
  for (let i = 0; i < MAX_SKIP_DAYS && blocked.has(candidate); i++) candidate = addDays(candidate, 1);
  if (blocked.has(candidate)) throw new NoDeliveryDatesError();
  return candidate;
}

export interface DeliveryOptions {
  earliest: string;
  latest: string;
  blackoutDates: string[];
}

export function computeOptions(now: Date, cfg: DeliveryConfig): DeliveryOptions {
  const earliest = computeEarliest(now, cfg);
  const latest = addDays(earliest, cfg.daysAhead);
  return {
    earliest,
    latest,
    blackoutDates: cfg.blackout.filter((d) => d >= earliest && d <= latest),
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November',
  'December',
];

/** 'Tuesday, 14 October 2026' from an ISO date string or a stored UTC-midnight Date. */
export function formatDeliveryDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const iso = value instanceof Date ? (isNaN(value.getTime()) ? '' : fromUtcMs(value.getTime())) : value.slice(0, 10);
  if (!isIsoDate(iso)) return '';
  const d = new Date(toUtcMs(iso));
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Stored form of a chosen ISO date: UTC midnight. */
export const toStoredDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
