// Load .env into process.env FIRST, before anything reads it. The app has no
// ConfigModule; previously only the Prisma client (instantiated during module
// init) pulled in .env, which is too late for the startup secret check below.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import { assertJwtSecret } from './auth/jwt.util';
import { parseTrustProxy } from './common/trust-proxy';

async function bootstrap() {
  // Fail fast at startup if auth is misconfigured, rather than booting with a
  // missing/weak JWT secret and only erroring on the first token operation.
  assertJwtSecret();

  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Behind Caddy + nginx the socket peer is always local; trust N proxy hops so
  // req.ip (the throttler key) is the real client IP. Unset = no trust.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const extraOrigins = (process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3002',
      'http://127.0.0.1:3002',
      'https://freshpetalsindia.com',
      'https://www.freshpetalsindia.com',
      'https://admin.freshpetalsindia.com',
      ...extraOrigins,
    ],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
