import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configure body parser for larger payloads (10MB limit)
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  // Allow the frontend (localhost:3000) and admin panel (localhost:3002) to call this API during development
  app.enableCors({
    origin: [
      process.env.CORS_ORIGIN ?? 'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3002',
      'http://127.0.0.1:3002',
    ],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
