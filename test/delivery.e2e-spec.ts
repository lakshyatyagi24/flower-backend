import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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
    expect(ok.body).toEqual({ serviceable: true, message: 'We deliver to this PIN code.' });
    const no = await request(http).get('/delivery/check').query({ pincode: '400001' });
    expect(no.body).toEqual({ serviceable: false, message: 'We do not deliver to this PIN code yet.' });
    const bad = await request(http).get('/delivery/check').query({ pincode: '12' });
    expect(bad.body.serviceable).toBe(false);
  });

  it('POST /orders rejects an unserviceable PIN and leaves stock untouched, accepts a serviceable one', async () => {
    const product = await prisma.product.create({
      data: { name: 'E2E Pin Rose', slug: `e2e-pin-${Date.now()}`, price: 100, stock: 5, active: true, saleMode: 'PURCHASE' },
    });
    let orderId: number | undefined;
    try {
      await setList('110001');
      const body = (postalCode: string) => ({
        items: [{ productId: product.id, quantity: 2 }],
        customerName: 'E2E', customerEmail: 'e2e-pin@example.com', customerPhone: '9354016059',
        shippingAddress: '1 Test Road', city: 'Delhi', postalCode, paymentMethod: 'COD',
      });
      const rejected = await request(app.getHttpServer()).post('/orders').send(body('560001'));
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.body.message)).toMatch(/do not deliver to this PIN code yet/);
      expect((await prisma.product.findUnique({ where: { id: product.id } }))!.stock).toBe(5);

      const accepted = await request(app.getHttpServer()).post('/orders').send(body('110001'));
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
