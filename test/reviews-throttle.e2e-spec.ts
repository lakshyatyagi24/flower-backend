import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { signJwt } from '../src/auth/jwt.util';

describe('POST /products/:id/reviews throttle (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('allows 5 per minute per IP, then answers 429', async () => {
    const token = `Bearer ${signJwt({ sub: 987654, email: 'thr@example.com', role: 'CUSTOMER' })}`;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await request(app.getHttpServer())
        .post('/products/999999999/reviews')
        .set('Authorization', token)
        .send({ rating: 5, body: 'a perfectly fine review body' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
