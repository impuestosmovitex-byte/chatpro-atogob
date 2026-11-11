import 'reflect-metadata';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { StagingAppModule } from './staging-app.module';
import { StatisticsController } from './statistics.controller';

/** Regression for SEG-002: staging has its own limited root module. */
describe('SEG-002 staging statistics route registration', () => {
  it('registers protected statistics controller in the staging module', () => {
    const controllers: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StagingAppModule) ?? [];
    expect(controllers).toContain(StatisticsController);
    expect(Reflect.getMetadata(PATH_METADATA, StatisticsController)).toBe('statistics');
  });
});
