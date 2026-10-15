/**
 * CSV helpers shared by every admin export.
 *
 * Two independent protections are applied to every STRING cell:
 *  1. Spreadsheet formula-injection neutralisation (OWASP "CSV injection"): a cell whose first non-blank
 *     character is = + - @ (or that starts with TAB / CR) is prefixed with a single quote, so Excel / Sheets
 *     show it as text instead of evaluating it.
 *  2. RFC 4180 quoting: cells containing a comma, double quote, CR or LF are wrapped in double quotes with
 *     inner quotes doubled.
 * Numbers are written verbatim (they are never attacker-controlled text), null/undefined become an empty cell.
 */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@])/;
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let v = FORMULA_START.test(value) ? `'${value}` : value;
  if (NEEDS_QUOTES.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',');
}

/** UTF-8 byte order mark: makes Excel open the file as UTF-8 (rupee signs, Devanagari names...). */
export const CSV_BOM = '﻿';
