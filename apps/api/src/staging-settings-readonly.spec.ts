import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { CompanySettingsController } from './company-settings.controller';
import { StagingAppModule } from './staging-app.module';

describe('MW1 read-only staging IA settings reuse', () => {
  const oldMode = process.env.MW1_STAGING_MODE;
  const oldKey = process.env.CHATPRO_INBOX_KEY;
  const controller = new CompanySettingsController({} as never, {} as never);
  beforeAll(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.CHATPRO_INBOX_KEY = 'mock-private-test-internal-key';
  });
  afterAll(() => {
    if (oldMode === undefined) delete process.env.MW1_STAGING_MODE;
    else process.env.MW1_STAGING_MODE = oldMode;
    if (oldKey === undefined) delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY = oldKey;
  });
  it('uses original settings controller in isolated API', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StagingAppModule) as unknown[];
    expect(controllers).toContain(CompanySettingsController);
  });
  it('requires internal authorization on GET', async () => {
    await expect(controller.getSettings('bad-key', 'mw1-demo-mercado'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('blocks all staging settings writes before any database operation', async () => {
    await expect(controller.saveSettings('mock-private-test-internal-key', 'mw1-demo-mercado', {}))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
