import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    { rawBody: true },
  );

  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', {
    limit: '2mb',
    extended: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
