import { normalizeIndianPhone, isIndianPin } from './validators';

describe('validators', () => {
  it('normalizes +91, 91, 0 prefixes and spaces', () => {
    expect(normalizeIndianPhone('+91 93540 16059')).toBe('9354016059');
    expect(normalizeIndianPhone('09354016059')).toBe('9354016059');
    expect(normalizeIndianPhone('919354016059')).toBe('9354016059');
  });
  it('rejects numbers not starting 6-9 or wrong length', () => {
    expect(normalizeIndianPhone('1234567890')).toBeNull();
    expect(normalizeIndianPhone('93540')).toBeNull();
  });
  it('validates PIN', () => {
    expect(isIndianPin('110001')).toBe(true);
    expect(isIndianPin('010001')).toBe(false);
    expect(isIndianPin('11000')).toBe(false);
  });
});
