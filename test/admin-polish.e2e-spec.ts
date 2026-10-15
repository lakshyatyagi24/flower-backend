import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { applyBodyParsers } from '../src/common/body-parsers';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { signJwt } from '../src/auth/jwt.util';

// Task 5.3: dashboard series (IST day buckets), order search, CSV export, against the real database.
describe('Admin polish: stats series, order search, CSV export (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const ids: number[] = [];
  const tag = `AP${Date.now().toString(36)}`;
  const adminToken = () => signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' });
  const customerToken = () => signJwt({ sub: 999998, email: 'c@example.com', role: 'CUSTOMER' });
  const get = (url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${adminToken()}`);

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService).useValue({})
      .compile();
    app = m.createNestApplication<NestExpressApplication>({ rawBody: true });
    applyBodyParsers(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    if (ids.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
      await prisma.order.deleteMany({ where: { id: { in: ids } } });
    }
    await app.close();
  });

  async function mk(data: Record<string, unknown>) {
    const o = await prisma.order.create({
      data: { total: 100, subtotal: 100, status: 'PENDING', paymentMethod: 'COD', customerName: 'stats-fixture', ...data } as any,
    });
    ids.push(o.id);
    return o;
  }

  describe('GET /orders/stats series', () => {
    // A quiet historical window so other suites' orders cannot interfere.
    const FROM = '2020-03-10';
    const TO = '2020-03-13';

    beforeAll(async () => {
      // 2020-03-10 IST day: 2020-03-09T18:30:00Z .. 2020-03-10T18:29:59.999Z
      await mk({ createdAt: new Date('2020-03-09T18:29:59.999Z'), total: 999 }); // 03-09 IST: OUTSIDE (23:59:59.999)
      await mk({ createdAt: new Date('2020-03-09T18:30:00.000Z'), total: 100.1 }); // 03-10 00:00:00 IST: first instant
      await mk({ createdAt: new Date('2020-03-10T18:29:59.999Z'), total: 0.2 }); // 03-10 23:59:59.999 IST: last instant
      await mk({ createdAt: new Date('2020-03-10T18:30:00.000Z'), total: 50 }); // 03-11 00:00 IST
      // cancelled: no order, no revenue
      await mk({ createdAt: new Date('2020-03-11T05:00:00Z'), total: 7777, status: 'CANCELLED' });
      // unpaid online order: counts as an order, NOT as revenue
      await mk({ createdAt: new Date('2020-03-11T06:00:00Z'), total: 400, paymentMethod: 'RAZORPAY', paymentStatus: 'UNPAID' });
      // paid online: revenue; refunded online: order but no revenue
      await mk({ createdAt: new Date('2020-03-11T07:00:00Z'), total: 300, paymentMethod: 'RAZORPAY', paymentStatus: 'PAID', status: 'PAID' });
      await mk({ createdAt: new Date('2020-03-11T08:00:00Z'), total: 600, paymentMethod: 'RAZORPAY', paymentStatus: 'REFUNDED', status: 'COMPLETED' });
      // after the range (03-14 IST)
      await mk({ createdAt: new Date('2020-03-13T18:30:00.000Z'), total: 5555 });
    });

    it('zero-fills every day and buckets by IST day (midnight edges), excluding cancelled / unpaid / refunded revenue', async () => {
      const res = await get(`/orders/stats?from=${FROM}&to=${TO}`).expect(200);
      expect(res.body.range).toEqual({ from: FROM, to: TO });
      expect(res.body.series).toEqual([
        { date: '2020-03-10', orders: 2, revenue: 100.3 },
        { date: '2020-03-11', orders: 4, revenue: 350 }, // 50 + 300 (cancelled 7777 excluded entirely; refunded 600 and unpaid 400 are orders but not revenue)
        { date: '2020-03-12', orders: 0, revenue: 0 },
        { date: '2020-03-13', orders: 0, revenue: 0 },
      ]);
      // existing fields untouched
      for (const k of ['orderCount', 'productCount', 'customerCount', 'revenue', 'recentOrders', 'openEnquiries', 'unpaidOnline']) {
        expect(res.body).toHaveProperty(k);
      }
    });

    it('defaults to the last 30 days and validates the range', async () => {
      const def = await get('/orders/stats').expect(200);
      expect(def.body.series).toHaveLength(30);
      await get('/orders/stats?from=2026-13-01').expect(400);
      await get('/orders/stats?from=2026-10-05&to=2026-10-01').expect(400);
      await get('/orders/stats?from=2024-01-01&to=2026-01-01').expect(400);
      await get('/orders/stats?from=2025-01-01&to=2025-12-31').expect(200); // 365 days
    });

    it('is admin-only', async () => {
      await request(app.getHttpServer()).get('/orders/stats').expect(401);
      await request(app.getHttpServer()).get('/orders/stats').set('Authorization', `Bearer ${customerToken()}`).expect(403);
    });
  });

  describe('GET /orders?q= and GET /orders/export.csv', () => {
    let a: { id: number }; let wild: { id: number }; let wildDecoy: { id: number };

    beforeAll(async () => {
      a = await mk({
        customerName: `${tag} Asha Rao`, customerEmail: `Asha.${tag}@Example.com`, customerPhone: '9876543210',
        city: 'Delhi', postalCode: '110001', status: 'PAID', paymentStatus: 'PAID', paymentMethod: 'RAZORPAY',
      });
      await prisma.orderItem.create({ data: { orderId: a.id, productName: 'Red, "Roses"', quantity: 2, unitPrice: 50 } as any });
      wild = await mk({ customerName: `${tag} 100%_sure`, customerEmail: `w.${tag}@x.com`, customerPhone: '9123456780' });
      wildDecoy = await mk({ customerName: `${tag} 100Xasure`, customerEmail: `d.${tag}@x.com`, customerPhone: '9123456781' });
      await mk({ customerName: `=cmd|' /C calc'!A0 ${tag}`, customerEmail: `inj.${tag}@x.com`, customerPhone: '9000000001', city: '@evil' });
    });

    const idsOf = (body: any) => body.items.map((o: any) => o.id) as number[];

    it('finds by exact order id (with or without #)', async () => {
      expect(idsOf((await get(`/orders?q=${a.id}`).expect(200)).body)).toContain(a.id);
      expect(idsOf((await get(`/orders?q=${encodeURIComponent('#' + a.id)}`).expect(200)).body)).toContain(a.id);
    });

    it('finds by case-insensitive partial email and name', async () => {
      expect(idsOf((await get(`/orders?q=${encodeURIComponent(`asha.${tag}`.toLowerCase())}`).expect(200)).body)).toEqual([a.id]);
      expect(idsOf((await get(`/orders?q=${encodeURIComponent(`${tag} ASHA`)}`).expect(200)).body)).toEqual([a.id]);
    });

    it('finds by phone however it is typed', async () => {
      for (const q of ['9876543210', '+91 98765 43210', '98765-432', '098765 43210']) {
        const body = (await get(`/orders?q=${encodeURIComponent(q)}`).expect(200)).body;
        expect(idsOf(body)).toContain(a.id);
      }
    });

    it('treats % and _ literally (no wildcard matching)', async () => {
      expect(idsOf((await get(`/orders?q=${encodeURIComponent('100%_sure')}`).expect(200)).body)).toEqual([wild.id]);
      const pct = idsOf((await get(`/orders?q=${encodeURIComponent(`${tag} 100%`)}`).expect(200)).body);
      expect(pct).toContain(wild.id);
      expect(pct).not.toContain(wildDecoy.id);
      // a bare % must not match everything
      const all = (await get(`/orders?q=${encodeURIComponent('%')}&take=200`).expect(200)).body;
      expect(idsOf(all)).not.toContain(a.id);
      const us = idsOf((await get(`/orders?q=${encodeURIComponent('%_sure')}`).expect(200)).body);
      expect(us).toContain(wild.id);
      expect(us).not.toContain(wildDecoy.id);
    });

    it('combines with status filters and paginates', async () => {
      const paid = (await get(`/orders?q=${tag}&status=PAID`).expect(200)).body;
      expect(idsOf(paid)).toEqual([a.id]);
      const none = (await get(`/orders?q=${tag}&status=SHIPPED`).expect(200)).body;
      expect(none.total).toBe(0);
      const page = (await get(`/orders?q=${tag}&take=2&skip=0`).expect(200)).body;
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(4);
    });

    it('export: headers, BOM, CRLF, columns, and the order data', async () => {
      const res = await get(`/orders/export.csv?q=${encodeURIComponent(`asha.${tag}`)}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(res.headers['x-export-truncated']).toBe('false');
      expect(res.headers['x-export-total']).toBe('1');
      const text: string = res.text;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const lines = text.slice(1).split('\r\n');
      expect(lines[0]).toBe('id,createdAt (IST),status,paymentMethod,paymentStatus,name,email,phone,city,pincode,deliveryDate,items,subtotal,discount,coupon,shipping,gst,total,tracking');
      expect(lines[1]).toContain(`${a.id},`);
      expect(lines[1]).toContain(',PAID,RAZORPAY,PAID,');
      expect(lines[1]).toContain('"2 x Red, ""Roses"""');
      expect(lines[1]).toContain(',9876543210,Delhi,110001,');
    });

    it('export neutralises formula injection from customer-controlled fields', async () => {
      const res = await get(`/orders/export.csv?q=${encodeURIComponent(`inj.${tag}`)}`).expect(200);
      expect(res.text).toContain(`,'=cmd|' /C calc'!A0 ${tag},`); // guard quote first
      expect(res.text).toContain(",'@evil,");
      expect(res.text).not.toMatch(/,=cmd/);
    });

    it('export returns exactly the rows the list returns for the same filters', async () => {
      const filters = [
        `q=${tag}`,
        `q=${tag}&status=PAID`,
        `q=${tag}&paymentMethod=RAZORPAY`,
        `q=${encodeURIComponent('100%')}`,
        `q=${tag}&sort=deliveryDate`,
        `status=CANCELLED&q=${tag}`,
      ];
      for (const f of filters) {
        const list = (await get(`/orders?${f}&take=200`).expect(200)).body;
        const csv = await get(`/orders/export.csv?${f}`).expect(200);
        const rows = csv.text.slice(1).split('\r\n').slice(1).filter(Boolean);
        // ids are the leading numeric cell; multi-line cells never start a line with digits+comma in this data
        const csvIds = rows.map((r) => Number(r.split(',')[0])).filter((n) => Number.isInteger(n));
        expect(csvIds).toEqual(idsOf(list));
        expect(Number(csv.headers['x-export-total'])).toBe(list.total);
      }
    });

    it('export is admin-only', async () => {
      await request(app.getHttpServer()).get('/orders/export.csv').expect(401);
      await request(app.getHttpServer()).get('/orders/export.csv').set('Authorization', `Bearer ${customerToken()}`).expect(403);
    });

    it('GET /orders/export.csv is not swallowed by GET /orders/:id', async () => {
      const res = await get('/orders/export.csv?q=nomatch-' + tag).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
    });
  });
});
