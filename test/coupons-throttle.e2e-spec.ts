import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST /coupons/validate throttle (e2e)', () => {
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

  it('allows 10 per minute per IP, then answers 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await request(app.getHttpServer()).post('/coupons/validate').send({ code: 'NOSUCHCODE', subtotal: 100 });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
