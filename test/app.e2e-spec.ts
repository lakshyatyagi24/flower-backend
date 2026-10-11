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
});
