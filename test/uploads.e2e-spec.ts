import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { signJwt } from '../src/auth/jwt.util';

describe('Uploads (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(() => app.close());

  it('POST /uploads without a token -> 401', () =>
    request(app.getHttpServer()).post('/uploads').expect(401));

  it('POST /uploads as a customer -> 403', () => {
    const token = signJwt({ sub: 999999, email: 'c@example.com', role: 'CUSTOMER' });
    return request(app.getHttpServer()).post('/uploads').set('Authorization', `Bearer ${token}`).expect(403);
  });

  // The JWT guard is stateless (no DB lookup), so a signed token is enough; no user row is created.
  it('POST /uploads as admin with no file -> 400 No file uploaded', async () => {
    const token = signJwt({ sub: 999999, email: 'admin@example.com', role: 'ADMIN' });
    const res = await request(app.getHttpServer()).post('/uploads').set('Authorization', `Bearer ${token}`).expect(400);
    expect(res.body.message).toBe('No file uploaded');
  });
});
