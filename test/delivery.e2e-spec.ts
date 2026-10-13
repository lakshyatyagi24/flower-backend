import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DeliveryService } from '../src/delivery/delivery.service';
import { SettingsService } from '../src/settings/settings.service';

const KEY = 'delivery.supportedPincodes';

describe('Delivery serviceability (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previous: string | null = null;
  let hadRow = false;

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    hadRow = !!row;
    previous = row?.value ?? null;
  });
  afterAll(async () => {
    if (hadRow) await prisma.setting.update({ where: { key: KEY }, data: { value: previous! } });
    else await prisma.setting.deleteMany({ where: { key: KEY } });
    await app.close();
  });

  const setList = (value: string) =>
    prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });

  it('GET /delivery/check honours the configured list', async () => {
    await setList('1100*, 560001');
    const http = app.getHttpServer();
    const ok = await request(http).get('/delivery/check').query({ pincode: '110045' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ serviceable: true, restricted: true, message: 'We deliver to this PIN code.' });
    const no = await request(http).get('/delivery/check').query({ pincode: '400001' });
    expect(no.body).toEqual({ serviceable: false, restricted: true, message: 'We do not deliver to this PIN code yet.' });
    const bad = await request(http).get('/delivery/check').query({ pincode: '12' });
    expect(bad.body.serviceable).toBe(false);
  });

  it('GET /delivery/check does not claim delivery when no list is configured', async () => {
    await setList('');
    const r = await request(app.getHttpServer()).get('/delivery/check').query({ pincode: '400001' });
    expect(r.body).toEqual({
      serviceable: true,
      restricted: false,
      message: "We'll confirm delivery to your PIN code at checkout.",
    });
  });

  it('SettingsService.upsert rejects invalid PIN entries', async () => {
    const settings = app.get(SettingsService);
    await expect(settings.upsert({ [KEY]: '110001, nope' })).rejects.toThrow(/"nope"/);
  });

  it('POST /orders rejects an unserviceable PIN and leaves stock untouched, accepts a serviceable one', async () => {
    const product = await prisma.product.create({
      data: { name: 'E2E Pin Rose', slug: `e2e-pin-${Date.now()}`, price: 100, stock: 5, active: true, saleMode: 'PURCHASE' },
    });
    let orderId: number | undefined;
    try {
      await setList('110001');
      const body = async (postalCode: string) => ({
        items: [{ productId: product.id, quantity: 2 }],
        customerName: 'E2E', customerEmail: 'e2e-pin@example.com', customerPhone: '9354016059',
        shippingAddress: '1 Test Road', city: 'Delhi', postalCode, paymentMethod: 'COD',
        deliveryDate: await app.get(DeliveryService).earliestDeliveryDate(),
      });
      const rejected = await request(app.getHttpServer()).post('/orders').send(await body('560001'));
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.body.message)).toMatch(/do not deliver to this PIN code yet/);
      expect((await prisma.product.findUnique({ where: { id: product.id } }))!.stock).toBe(5);

      const accepted = await request(app.getHttpServer()).post('/orders').send(await body('110001'));
      expect(accepted.status).toBe(201);
      orderId = accepted.body.id;
      expect((await prisma.product.findUnique({ where: { id: product.id } }))!.stock).toBe(3);
    } finally {
      if (orderId) {
        await prisma.orderItem.deleteMany({ where: { orderId } });
        await prisma.order.delete({ where: { id: orderId } });
      }
      await prisma.product.delete({ where: { id: product.id } });
    }
  });
});

describe('Delivery date (e2e)', () => {
  const KEYS = ['delivery.supportedPincodes', 'delivery.blackoutDates', 'delivery.cutoffTime', 'delivery.leadTimeDays', 'delivery.daysAhead'];
  let app: INestApplication;
  let prisma: PrismaService;
  let delivery: DeliveryService;
  let saved: { key: string; value: string }[] = [];
  let productId: number;
  const orderIds: number[] = [];

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    delivery = app.get(DeliveryService);
    saved = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
    await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
    const p = await prisma.product.create({
      data: { name: 'E2E Date Rose', slug: `e2e-date-${Date.now()}`, price: 100, stock: 10, active: true, saleMode: 'PURCHASE' },
    });
    productId = p.id;
  });
  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
    for (const r of saved) await prisma.setting.create({ data: r });
    for (const id of orderIds) {
      await prisma.orderItem.deleteMany({ where: { orderId: id } });
      await prisma.order.delete({ where: { id } });
    }
    await prisma.product.delete({ where: { id: productId } });
    await app.close();
  });

  const put = (key: string, value: string) =>
    prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const stock = async () => (await prisma.product.findUnique({ where: { id: productId } }))!.stock;
  const post = (deliveryDate?: unknown) => {
    const payload: Record<string, unknown> = {
      items: [{ productId, quantity: 2 }], customerName: 'E2E', customerEmail: 'e2e-date@example.com',
      customerPhone: '9354016059', shippingAddress: '1 Test Road', city: 'Delhi', postalCode: '110001', paymentMethod: 'COD',
    };
    if (deliveryDate !== undefined) payload.deliveryDate = deliveryDate;
    return request(app.getHttpServer()).post('/orders').send(payload);
  };
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it('GET /delivery/options returns the window and in-window blackout dates', async () => {
    const earliest = await delivery.earliestDeliveryDate();
    await put('delivery.blackoutDates', `${addDays(earliest, 3)}, ${addDays(earliest, 400)}`);
    const r = await request(app.getHttpServer()).get('/delivery/options');
    expect(r.status).toBe(200);
    expect(r.body.earliest).toBe(earliest);
    expect(r.body.latest).toBe(addDays(earliest, 14));
    expect(r.body.blackoutDates).toEqual([addDays(earliest, 3)]);
  });

  it('rejects a missing, malformed, out-of-range or blackout date and leaves stock untouched', async () => {
    const earliest = await delivery.earliestDeliveryDate();
    const before = await stock();
    const missing = await post();
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body.message)).toMatch(/choose a delivery date/);
    const stamp = await post(`${earliest}T00:00:00.000Z`);
    expect(stamp.status).toBe(400);
    expect(JSON.stringify(stamp.body.message)).toMatch(/YYYY-MM-DD/);
    const early = await post(addDays(earliest, -1));
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.body.message)).toMatch(/Please choose a delivery date between/);
    const late = await post(addDays(earliest, 15));
    expect(late.status).toBe(400);
    expect(JSON.stringify(late.body.message)).toMatch(/Please choose a delivery date between/);
    const blackout = await post(addDays(earliest, 3));
    expect(blackout.status).toBe(400);
    expect(JSON.stringify(blackout.body.message)).toMatch(/can't deliver on that date/);
    expect(await stock()).toBe(before);
  });

  it('accepts the earliest and the latest date and stores UTC midnight', async () => {
    const earliest = await delivery.earliestDeliveryDate();
    const before = await stock();
    const a = await post(earliest);
    expect(a.status).toBe(201);
    orderIds.push(a.body.id);
    expect(a.body.deliveryDate).toBe(`${earliest}T00:00:00.000Z`);
    const b = await post(addDays(earliest, 14));
    expect(b.status).toBe(201);
    orderIds.push(b.body.id);
    expect(await stock()).toBe(before - 4);

    const tracked = await request(app.getHttpServer()).get(`/orders/track/${a.body.id}`).query({ email: 'e2e-date@example.com' });
    expect(tracked.body.deliveryDate).toBe(`${earliest}T00:00:00.000Z`);
  });
});
