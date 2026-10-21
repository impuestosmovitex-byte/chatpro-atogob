import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { assertStagingIsolation } from './staging-safety';

async function bootstrap() {
  assertStagingIsolation();
  const rootModule = process.env.MW1_STAGING_MODE === 'true'
    ? (await import('./staging-app.module')).StagingAppModule
    : (await import('./app.module')).AppModule;
  const app = await NestFactory.create<NestExpressApplication>(
    rootModule,
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
