import {StagingMercadoPagoWebhookController} from './staging-mercadopago-webhook.controller';
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
import { StagingWhatsappCoexistencePilotController } from './staging-whatsapp-coexistence-pilot.controller';
import { StagingWhatsappCoexistenceOAuthHandshakeService } from './staging-whatsapp-coexistence-oauth-handshake.service';
import { StagingWhatsappCoexistenceMetaCodeExchangeService } from './staging-whatsapp-coexistence-meta-code-exchange.service';
import { StagingWhatsappCoexistenceMetaTokenReviewService } from './staging-whatsapp-coexistence-meta-token-review.service';
import { StagingWhatsappCoexistenceMetaGraphService } from './staging-whatsapp-coexistence-meta-graph.service';
import { StagingWhatsappCoexistenceBusinessOwnerService } from './staging-whatsapp-coexistence-business-owner.service';
import { StagingWhatsappCoexistenceTenantVerificationService } from './staging-whatsapp-coexistence-tenant-verification.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { StagingWhatsappWebhookController } from './staging-whatsapp-webhook.controller';
import { UsersController } from './users.controller';
import { StagingMyPlanController } from './staging-my-plan.controller';
import { StagingSubscriptionAdminController } from './staging-subscription-admin.controller';
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
    StagingMercadoPagoWebhookController,
    StagingInboxController,
    StagingIntegrationsController,
    StagingWhatsappCoexistencePilotController,
    StagingWhatsappWebhookController,
    UsersController,
    StagingMyPlanController,
    StagingSubscriptionAdminController,
    AccessController,
    AccessCapabilitiesController,
    PlatformAdminController,
    StagingDemoRequestsController,
    NativeCommerceController,
    StagingSalesAssistantController,
  ],
  providers: [SupabaseService, IntegrationCredentialsService, AccessAuthService, StagingSalesAssistantService,
    StagingWhatsappCoexistenceOAuthHandshakeService,
    StagingWhatsappCoexistenceMetaCodeExchangeService,
    StagingWhatsappCoexistenceMetaTokenReviewService,
    StagingWhatsappCoexistenceMetaGraphService,
    StagingWhatsappCoexistenceBusinessOwnerService,
    StagingWhatsappCoexistenceTenantVerificationService],
})
export class StagingAppModule {}
