// Sentry instrumentation must load before everything else (no-op without SENTRY_DSN_API).
import './instrument';
// Load .env into process.env FIRST, before anything reads it. The app has no
// ConfigModule; previously only the Prisma client (instantiated during module
// init) pulled in .env, which is too late for the startup secret check below.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { applyBodyParsers } from './common/body-parsers';
import { assertJwtSecret } from './auth/jwt.util';
import { parseTrustProxy } from './common/trust-proxy';
import { buildCorsOrigins } from './common/cors-origins';

async function bootstrap() {
  // Fail fast at startup if auth is misconfigured, rather than booting with a
  // missing/weak JWT secret and only erroring on the first token operation.
  assertJwtSecret();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Behind Caddy + nginx the socket peer is always local; trust N proxy hops so
  // req.ip (the throttler key) is the real client IP. Unset = no trust.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  applyBodyParsers(app);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.enableCors({
    origin: buildCorsOrigins(process.env.NODE_ENV, process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN),
    credentials: true,
  });

  // The test stack (seed admin, test-only endpoint) must not be reachable from the LAN; production keeps the default bind.
  if (process.env.NODE_ENV === 'test') await app.listen(process.env.PORT ?? 3001, '127.0.0.1');
  else await app.listen(process.env.PORT ?? 3001);
}
bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
