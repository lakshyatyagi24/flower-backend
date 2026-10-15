import { CSV_BOM, csvCell, csvRow } from './csv';

describe('csvCell', () => {
  it('leaves plain text alone and renders null/undefined as empty', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('writes numbers verbatim (never prefixed, even negative)', () => {
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(NaN)).toBe('');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralises a string starting with %j', (ch) => {
    const out = csvCell(`${ch}SUM(1,2)`);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('neutralises formulas hidden behind leading whitespace', () => {
    expect(csvCell(' =1+1')).toBe("' =1+1");
    expect(csvCell('\n=1+1')).toBe(`"'\n=1+1"`);
  });

  it('only neutralises at the START of a cell', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('x-y')).toBe('x-y');
  });

  it('quotes commas, quotes and newlines per RFC 4180 (inner quotes doubled)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('applies both protections together', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
});

describe('csvRow / BOM', () => {
  it('joins cells with commas', () => {
    expect(csvRow(['a', 1, null, 'b,c'])).toBe('a,1,,"b,c"');
  });
  it('exposes the UTF-8 BOM', () => {
    expect(CSV_BOM).toBe('﻿');
  });
});
