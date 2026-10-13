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
