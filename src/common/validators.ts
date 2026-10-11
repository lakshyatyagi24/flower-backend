import { registerDecorator, ValidationOptions } from 'class-validator';

export function normalizeIndianPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function isIndianPin(raw: string): boolean {
  return typeof raw === 'string' && /^[1-9]\d{5}$/.test(raw);
}

export function IsIndianPhone(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIndianPhone',
      target: object.constructor,
      propertyName,
      options: { message: 'Enter a valid 10-digit Indian mobile number', ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && normalizeIndianPhone(v) !== null },
    });
  };
}

export function IsIndianPin(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isIndianPin',
      target: object.constructor,
      propertyName,
      options: { message: 'Enter a valid 6-digit PIN code', ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && isIndianPin(v) },
    });
  };
}
