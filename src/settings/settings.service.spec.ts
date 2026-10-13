import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SETTING_DEFAULTS } from './setting-defaults';

const make = (rows: { key: string; value: string }[] = []) =>
  new SettingsService({ setting: { findMany: jest.fn(async () => rows) } } as any);

describe('SettingsService defaults', () => {
  it('exposes blank email and address (no placeholder text) and the real phone', async () => {
    const pub = await make().getPublic();
    expect(pub['store.email']).toBe('');
    expect(pub['store.address']).toBe('');
    expect(pub['store.phone']).toBe('+91 93540 16059');
    expect(JSON.stringify(pub)).not.toMatch(/example\.com|please update/i);
  });

  it('exposes the same shipping defaults the orders service falls back to', async () => {
    const pub = await make().getPublic();
    expect(pub['shipping.flatRate']).toBe(SETTING_DEFAULTS['shipping.flatRate']);
    expect(pub['shipping.freeThreshold']).toBe(SETTING_DEFAULTS['shipping.freeThreshold']);
  });

  it('exposes homepage.announcement keys when set and lets rows override defaults', async () => {
    const pub = await make([
      { key: 'homepage.announcement', value: 'Hello' },
      { key: 'homepage.announcementHref', value: '/products' },
      { key: 'store.email', value: 'a@b.co' },
      { key: 'payment.secret', value: 'x' },
    ]).getPublic();
    expect(pub['homepage.announcement']).toBe('Hello');
    expect(pub['homepage.announcementHref']).toBe('/products');
    expect(pub['store.email']).toBe('a@b.co');
    expect(pub).not.toHaveProperty('payment.secret');
  });
});

describe('SettingsService.upsert delivery.supportedPincodes validation', () => {
  const makeWrite = () => {
    const upsert = jest.fn((args: any) => args);
    const prisma: any = {
      setting: { upsert, findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: any[]) => ops),
    };
    return { svc: new SettingsService(prisma), upsert };
  };

  it('accepts valid PINs, prefixes, separators, empty and zero-width characters', async () => {
    const { svc, upsert } = makeWrite();
    await svc.upsert({ 'delivery.supportedPincodes': '110001, 1100*\n560001;\u200B400001' });
    await svc.upsert({ 'delivery.supportedPincodes': '' });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid tokens with a 400 naming them, and writes nothing', async () => {
    const { svc, upsert } = makeWrite();
    await expect(svc.upsert({ 'delivery.supportedPincodes': '110001, TBD, 12345, *' })).rejects.toThrow(/"TBD".*"12345".*"\*"/);
    await expect(svc.upsert({ 'store.name': 'X', 'delivery.supportedPincodes': 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not validate when the key is absent', async () => {
    const { svc, upsert } = makeWrite();
    await svc.upsert({ 'store.name': 'X' });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsService.upsert delivery date settings validation', () => {
  const makeWrite = () => {
    const upsert = jest.fn((args: any) => args);
    const prisma: any = {
      setting: { upsert, findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: any[]) => ops),
    };
    return { svc: new SettingsService(prisma), upsert };
  };

  it('has defaults for all four keys', async () => {
    const pub = await make().getPublic();
    expect(pub['delivery.cutoffTime']).toBe('15:00');
    expect(pub['delivery.leadTimeDays']).toBe('0');
    expect(pub['delivery.blackoutDates']).toBe('');
    expect(pub['delivery.daysAhead']).toBe('14');
  });

  it('accepts valid values and blanks', async () => {
    const { svc, upsert } = makeWrite();
    await svc.upsert({
      'delivery.cutoffTime': '09:30', 'delivery.leadTimeDays': '2',
      'delivery.blackoutDates': '2026-10-31, 2026-11-01\n2026-11-02', 'delivery.daysAhead': '30',
    });
    await svc.upsert({
      'delivery.cutoffTime': '', 'delivery.leadTimeDays': '', 'delivery.blackoutDates': '', 'delivery.daysAhead': '',
    });
    expect(upsert).toHaveBeenCalledTimes(8);
  });

  it.each([
    [{ 'delivery.cutoffTime': '3pm' }, /"3pm".*HH:MM/],
    [{ 'delivery.cutoffTime': '24:00' }, /"24:00"/],
    [{ 'delivery.leadTimeDays': '31' }, /"31".*0 to 30/],
    [{ 'delivery.leadTimeDays': '1.5' }, /"1.5"/],
    [{ 'delivery.daysAhead': '0' }, /"0".*1 to 90/],
    [{ 'delivery.daysAhead': '91' }, /"91"/],
    [{ 'delivery.blackoutDates': '2026-10-31, tomorrow, 2026-02-30' }, /"tomorrow", "2026-02-30"/],
  ])('rejects %j with a 400 naming the bad value and writes nothing', async (values, message) => {
    const { svc, upsert } = makeWrite();
    await expect(svc.upsert({ 'store.name': 'X', ...values })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsert(values)).rejects.toThrow(message);
    expect(upsert).not.toHaveBeenCalled();
  });
});
