import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { SupabaseService } from './supabase.service';
import { StagingAppModule } from './staging-app.module';
import { MODULE_METADATA } from '@nestjs/common/constants';

describe('staging existing roles controller read-only integration', () => {
  const priorMode = process.env.MW1_STAGING_MODE;
  const priorKey = process.env.CHATPRO_INBOX_KEY;
  const controller = new RolesController({} as SupabaseService);
  beforeAll(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.CHATPRO_INBOX_KEY = 'synthetic-internal-test-key';
  });
  afterAll(() => {
    if (priorMode === undefined) delete process.env.MW1_STAGING_MODE;
    else process.env.MW1_STAGING_MODE = priorMode;
    if (priorKey === undefined) delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY = priorKey;
  });
  it('registers the existing roles controller in the isolated staging API', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StagingAppModule) as unknown[];
    expect(controllers).toContain(RolesController);
  });
  it('does not allow anonymous GET', async () => {
    await expect(controller.listRoles('wrong-key')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('denies role creation before any database write', async () => {
    await expect(controller.createRole(
      'synthetic-internal-test-key', 'actor', 'user', 'company', 'assertion', 'mw1-demo-mercado', {},
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('denies role changes before any database write', async () => {
    await expect(controller.updateRole(
      'synthetic-internal-test-key', 'actor', 'user', 'company', 'assertion', 'mw1-demo-mercado', {},
    )).rejects.toBeInstanceOf(ForbiddenException);
  });
});
