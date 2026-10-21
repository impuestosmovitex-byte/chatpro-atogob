import { Controller, Get, Module } from '@nestjs/common';
import { AccessAuthService } from './access-auth.service';
import { AccessCapabilitiesController } from './access-capabilities.controller';
import { AccessController } from './access.controller';
import { NativeCommerceController } from './native-commerce.controller';
import { SupabaseService } from './supabase.service';
import { StagingSalesAssistantController, StagingSalesAssistantService } from './staging-sales-assistant.controller';

@Controller()
class StagingHealthController {
  @Get()
  status() {
    return { ok: true, service: 'MW1 Native Commerce Staging', environment: 'staging' };
  }
}

/**
 * Deliberately excludes all production channel integrations, webhook
 * handlers, background automations, AI/Shopify services and schedulers.
 */
@Module({
  controllers: [
    StagingHealthController,
    AccessController,
    AccessCapabilitiesController,
    NativeCommerceController,
    StagingSalesAssistantController,
  ],
  providers: [SupabaseService, AccessAuthService, StagingSalesAssistantService],
})
export class StagingAppModule {}
