import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SETTING_DEFAULTS } from './setting-defaults';
import { isSecretSettingKey } from './secret-keys';

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

describe('SettingsService.upsert blackout date count', () => {
  const makeWrite = () => {
    const upsert = jest.fn((args: any) => args);
    const prisma: any = { setting: { upsert, findMany: jest.fn(async () => []) }, $transaction: jest.fn(async (ops: any[]) => ops) };
    return { svc: new SettingsService(prisma), upsert };
  };
  const dates = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)).join(',');
  it('accepts 366 dates and rejects 367 without writing', async () => {
    const { svc, upsert } = makeWrite();
    await svc.upsert({ 'delivery.blackoutDates': dates(366) });
    expect(upsert).toHaveBeenCalledTimes(1);
    await expect(svc.upsert({ 'delivery.blackoutDates': dates(367) })).rejects.toThrow(/too many entries.*366/);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe('credential-looking settings keys (Task 5.7)', () => {
  const secretRows = [
    { key: 'payment.razorpayKeyId', value: 'rzp_FAKE_SHOULDNOTLEAK' },
    { key: 'payment.razorpayKeySecret', value: 'SHOULDNOTLEAK' },
    { key: 'payment.stripeKey', value: 'SHOULDNOTLEAK' },
    { key: 'payment.anything', value: 'SHOULDNOTLEAK' },
    { key: 'store.apiToken', value: 'SHOULDNOTLEAK' },
    { key: 'delivery.smsApiKey', value: 'SHOULDNOTLEAK' },
    { key: 'seo.clientSecret', value: 'SHOULDNOTLEAK' },
    { key: 'policies.adminPassword', value: 'SHOULDNOTLEAK' },
    { key: 'store.name', value: 'Shop' },
  ];

  it('getAll (admin) and getPublic never return them, even when rows exist in the table', async () => {
    const svc = make(secretRows);
    for (const out of [await svc.getAll(), await svc.getPublic()]) {
      expect(JSON.stringify(out)).not.toContain('SHOULDNOTLEAK');
      expect(Object.keys(out).filter((k) => isSecretSettingKey(k))).toEqual([]);
      expect(out['store.name']).toBe('Shop');
    }
  });

  it('upsert rejects writes to them and writes nothing', async () => {
    const upsert = jest.fn();
    const svc = new SettingsService({ setting: { upsert, findMany: jest.fn(async () => []) }, $transaction: jest.fn() } as any);
    for (const key of ['payment.razorpayKeySecret', 'Payment.Stripe', 'store.apiKey', 'x.TOKEN', 'a.password']) {
      await expect(svc.upsert({ 'store.name': 'ok', [key]: 'v' })).rejects.toThrow(/credential/);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not flag every legitimate default key', () => {
    for (const k of Object.keys(SETTING_DEFAULTS)) expect(isSecretSettingKey(k)).toBe(false);
    for (const k of ['homepage.announcement', 'trust.item1', 'seo.title', 'delivery.cutoffTime', 'store.whatsapp']) {
      expect(isSecretSettingKey(k)).toBe(false);
    }
  });

  it('the cleanup script classifies keys exactly like the service', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const script = require('../../prisma/cleanup-secret-settings.js');
    const samples = ['payment.x', 'payment', 'paymentTerms', 'store.name', 'a.key', 'a.KEY ', 'x.secret', 'seo.token', 'p.password', 'monkey.business', 'homepage.hero'];
    for (const s of samples) expect(script.isSecretSettingKey(s)).toBe(isSecretSettingKey(s));
  });
});
