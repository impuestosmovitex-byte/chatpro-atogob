import { Controller, Get, Module } from '@nestjs/common';
import { AccessAuthService } from './access-auth.service';
import { AccessCapabilitiesController } from './access-capabilities.controller';
import { AccessController } from './access.controller';
import { NativeCommerceController } from './native-commerce.controller';
import { PlatformAdminController } from './platform-admin.controller';
import { StagingDemoRequestsController } from './staging-demo-requests.controller';
import { SupabaseService } from './supabase.service';
import { StagingInboxController } from './staging-inbox.controller';
import { StagingIntegrationsController } from './staging-integrations.controller';
import { UsersController } from './users.controller';
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
    StagingInboxController,
    StagingIntegrationsController,
    UsersController,
    AccessController,
    AccessCapabilitiesController,
    PlatformAdminController,
    StagingDemoRequestsController,
    NativeCommerceController,
    StagingSalesAssistantController,
  ],
  providers: [SupabaseService, AccessAuthService, StagingSalesAssistantService],
})
export class StagingAppModule {}
