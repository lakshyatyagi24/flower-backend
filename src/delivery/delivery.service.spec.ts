import { DeliveryService, parsePincodeRules } from './delivery.service';
import { findInvalidPincodeTokens } from './pincode-rules';

function make(value: string | null | undefined) {
  const prisma: any = {
    setting: { findUnique: jest.fn(async () => (value === undefined ? null : value === null ? null : { value })) },
  };
  return new DeliveryService(prisma);
}

describe('parsePincodeRules', () => {
  it('splits on commas, spaces, newlines and semicolons', () => {
    const r = parsePincodeRules('110001,110002 110003\n110004;1100*\r\n 4000*');
    expect([...r.exact].sort()).toEqual(['110001', '110002', '110003', '110004']);
    expect(r.prefixes).toEqual(['1100', '4000']);
  });
  it('ignores junk tokens', () => {
    const r = parsePincodeRules('TBD, 12345, *, 0123456, 1234567*');
    expect(r.exact.size).toBe(0);
    expect(r.prefixes).toEqual([]);
  });
});

describe('DeliveryService.isServiceable', () => {
  it('is unrestricted when the row is missing', async () => {
    expect(await make(undefined).isServiceable('560001')).toBe(true);
  });
  it('is unrestricted when the list is empty or whitespace', async () => {
    expect(await make('').isServiceable('560001')).toBe(true);
    expect(await make('  \n ').isServiceable('560001')).toBe(true);
  });
  it('does not restrict on placeholder text with no valid entries', async () => {
    expect(await make('TBD').isServiceable('560001')).toBe(true);
  });
  it('matches exact PINs', async () => {
    const s = make('110001, 110002');
    expect(await s.isServiceable('110001')).toBe(true);
    expect(await s.isServiceable('110003')).toBe(false);
  });
  it('matches prefix patterns', async () => {
    const s = make('1100*');
    expect(await s.isServiceable('110099')).toBe(true);
    expect(await s.isServiceable('110199')).toBe(false);
  });
  it('supports newline and mixed separators', async () => {
    const s = make('110001\n560*\r\n  400001 ,700001');
    expect(await s.isServiceable('560034')).toBe(true);
    expect(await s.isServiceable('400001')).toBe(true);
    expect(await s.isServiceable('700001')).toBe(true);
    expect(await s.isServiceable('600001')).toBe(false);
  });
  it('rejects malformed PINs regardless of config', async () => {
    const s = make('');
    for (const bad of ['', '12345', '1234567', 'abcdef', '012345', '11000 ', '1100*']) {
      expect(await s.isServiceable(bad)).toBe(false);
    }
    expect(await s.isServiceable(undefined as any)).toBe(false);
  });
});

describe('zero-width characters and invalid-token detection', () => {
  it('strips zero-width chars before splitting', async () => {
    const s = make('\u200B110001\uFEFF,\u200D1100*');
    expect(await s.isServiceable('110001')).toBe(true);
    expect(await s.isServiceable('110099')).toBe(true);
    expect(await s.isServiceable('400001')).toBe(false);
  });
  it('findInvalidPincodeTokens lists bad tokens only', () => {
    expect(findInvalidPincodeTokens('110001, 1100*, TBD, 12345, *, 1234567*\n560\u200B001')).toEqual([
      'TBD', '12345', '*', '1234567*',
    ]);
    expect(findInvalidPincodeTokens('')).toEqual([]);
    expect(findInvalidPincodeTokens(undefined)).toEqual([]);
  });
});

describe('DeliveryService.check restricted flag', () => {
  it('is unrestricted for empty, missing and all-invalid lists', async () => {
    expect(await make('').check('560001')).toEqual({ serviceable: true, restricted: false });
    expect(await make(undefined).check('560001')).toEqual({ serviceable: true, restricted: false });
    expect(await make('TBD').check('560001')).toEqual({ serviceable: true, restricted: false });
  });
  it('is restricted when a valid entry exists', async () => {
    expect(await make('110001').check('110001')).toEqual({ serviceable: true, restricted: true });
    expect(await make('110001').check('560001')).toEqual({ serviceable: false, restricted: true });
  });
});
