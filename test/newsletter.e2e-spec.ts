import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { signJwt } from '../src/auth/jwt.util';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Newsletter (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = 'e2e-newsletter-test@example.com';
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.subscriber.deleteMany({ where: { email } });
  });
  afterAll(async () => {
    await prisma.subscriber.deleteMany({ where: { email } });
    await app.close();
  });

  const admin = () => signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' });

  it('rejects an invalid email with 400', () =>
    request(app.getHttpServer()).post('/newsletter').send({ email: 'nope' }).expect(400));

  it('subscribes (200) and is idempotent: same email twice leaves one row', async () => {
    const a = await request(app.getHttpServer()).post('/newsletter').send({ email: email.toUpperCase() }).expect(200);
    const b = await request(app.getHttpServer()).post('/newsletter').send({ email }).expect(200);
    expect(a.body).toEqual({ ok: true });
    expect(b.body).toEqual({ ok: true });
    expect(await prisma.subscriber.count({ where: { email } })).toBe(1);
  });

  it('GET /newsletter without a token -> 401', () =>
    request(app.getHttpServer()).get('/newsletter').expect(401));

  it('GET /newsletter as a customer -> 403', () => {
    const token = signJwt({ sub: 999999, email: 'c@example.com', role: 'CUSTOMER' });
    return request(app.getHttpServer()).get('/newsletter').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('GET /newsletter as admin -> 200 including the row', async () => {
    const res = await request(app.getHttpServer())
      .get('/newsletter?take=500&skip=0').set('Authorization', `Bearer ${admin()}`).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items.some((i: any) => i.email === email)).toBe(true);
  });

  it('GET /newsletter ignores garbage paging values', () =>
    request(app.getHttpServer()).get('/newsletter?take=abc&skip=-5').set('Authorization', `Bearer ${admin()}`).expect(200));

  it('GET /newsletter/export.csv is admin only and returns CSV', async () => {
    await request(app.getHttpServer()).get('/newsletter/export.csv').expect(401);
    const res = await request(app.getHttpServer()).get('/newsletter/export.csv').set('Authorization', `Bearer ${admin()}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.startsWith('email,source,createdAt')).toBe(true);
    expect(res.text).toContain(email);
  });
});
