import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns ok', () => {
    return request(app.getHttpServer()).get('/healthz').expect(200).expect({ status: 'ok' });
  });

  it('POST /auth/login rejects unknown fields', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'x', evil: true })
      .expect(400);
  });

  it('POST /auth/forgot-password for unknown email returns 200 {ok:true}', () => {
    return request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'nobody-here@example.com' })
      .expect(200)
      .expect({ ok: true });
  });

  it('POST /auth/reset-password with bogus 64-char token returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: 'newpassword123' })
      .expect(400);
    expect(res.body.message).toBe('Invalid or expired reset link');
  });

  it('POST /auth/reset-password with wrong-length token returns 400', () => {
    return request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: 'short', password: 'newpassword123' })
      .expect(400);
  });
});
