import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { signJwt } from '../src/auth/jwt.util';
import { PrismaService } from '../src/prisma/prisma.service';

// Task 5.7: credential-looking Setting rows (e.g. left over from the original seed) must never be served.
describe('Settings never expose credentials (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const MARK = 'E2E_SECRET_MARKER_DO_NOT_LEAK';
  const keys = ['payment.razorpayKeyId', 'payment.razorpayKeySecret', 'payment.stripeKey', 'store.e2eApiToken', 'seo.e2ePassword'];
  const admin = () => signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' });

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    for (const key of keys) {
      await prisma.setting.upsert({ where: { key }, create: { key, value: MARK }, update: { value: MARK } });
    }
  });
  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: { in: keys } } });
    await app.close();
  });

  it('GET /settings (public) omits them', async () => {
    const res = await request(app.getHttpServer()).get('/settings').expect(200);
    expect(JSON.stringify(res.body)).not.toContain(MARK);
    for (const k of keys) expect(res.body).not.toHaveProperty(k);
  });

  it('GET /settings/admin omits them too', async () => {
    const res = await request(app.getHttpServer()).get('/settings/admin').set('Authorization', `Bearer ${admin()}`).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(MARK);
    for (const k of keys) expect(res.body).not.toHaveProperty(k);
    expect(res.body['store.name']).toBeDefined();
  });

  it('PUT /settings rejects credential-looking keys with 400 and does not change the row', async () => {
    await request(app.getHttpServer())
      .put('/settings').set('Authorization', `Bearer ${admin()}`)
      .send({ 'payment.razorpayKeySecret': 'changed' }).expect(400);
    const row = await prisma.setting.findUnique({ where: { key: 'payment.razorpayKeySecret' } });
    expect(row?.value).toBe(MARK);
  });

  it('PUT /settings still saves ordinary keys and its response is filtered', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings').set('Authorization', `Bearer ${admin()}`)
      .send({ 'store.instagram': '' }).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(MARK);
  });
});
