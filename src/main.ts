import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow the frontend (localhost:3000) to call this API during development
  app.enableCors({
    origin: [process.env.CORS_ORIGIN ?? 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
