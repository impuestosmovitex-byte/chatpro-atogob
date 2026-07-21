import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AccessAuthService } from './access-auth.service';
import { AccessController } from './access.controller';
import { AccessCapabilitiesController } from './access-capabilities.controller';
import { AiService } from './ai.service';
import { AutomationRuntimeService } from './automation-runtime.service';
import { AutomationTestSendService } from './automation-test-send.service';
import { AutomationMessageConfigController } from './automation-message-config.controller';
import { AutomationMessageConfigService } from './automation-message-config.service';
import { AutomationsController } from './automations.controller';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CartRecoveryService } from './cart-recovery.service';
import { CartRecoveryContextService } from './cart-recovery-context.service';
import { CartService } from './cart.service';
import { ChatAgentService } from './chat-agent.service';
import { ClientsController } from './clients.controller';
import { CompanyIntegrationService } from './company-integration.service';
import { CompanyShopifyService } from './company-shopify.service';
import { CompanyCommerceService } from './company-commerce.service';
import { CustomerOrderService } from './customer-order.service';
import { CompanyProductsController } from './company-products.controller';
import { CompanyStorefrontController } from './company-storefront.controller';
import { CompanySettingsController } from './company-settings.controller';
import { CompanyProfileController } from './company-profile.controller';
import { ConversationMemoryService } from './conversation-memory.service';
import { InboxController } from './inbox.controller';
import { IntegrationsController } from './integrations.controller';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { RolesController } from './roles.controller';
import { QuickRepliesController } from './quick-replies.controller';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { ShopifyService } from './shopify.service';
import { ShopifyOauthController } from './shopify-oauth.controller';
import { ShopifyIntegrationTestController } from './shopify-integration-test.controller';
import { ShopifyWebhookController } from './shopify-webhook.controller';
import { ShopifyWebhookEventService } from './shopify-webhook-event.service';
import { ShopifyAutomationProcessorService } from './shopify-automation-processor.service';
import { ShopifyAutomaticTestSendService } from './shopify-automatic-test-send.service';
import { ShopifyWebhookSubscriptionService } from './shopify-webhook-subscription.service';
import { CompanyCommerceTestController } from './company-commerce-test.controller';
import { ShopifyCatalogPreviewController } from './shopify-catalog-preview.controller';
import { SupabaseService } from './supabase.service';
import { SupportSettingsController } from './support-settings.controller';
import { AdvisorPresenceController } from './advisor-presence.controller';
import { ServiceAreasController } from './service-areas.controller';
import { UsersController } from './users.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { InternalDiagnosticsController } from './internal-diagnostics.controller';
import { ShopifyOrderDetailDiagnosticsController } from './shopify-order-detail-diagnostics.controller';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import { PlatformHealthController } from './platform-health.controller';
import { PlatformHealthService } from './platform-health.service';
import { WhatsappTemplateController } from './whatsapp-template.controller';
import { WhatsappTemplateService } from './whatsapp-template.service';
import { WhatsappTemplateExecutionService } from './whatsapp-template-execution.service';
import { PushNotificationController } from './push-notification.controller';
import { PushNotificationService } from './push-notification.service';
import { AiConversationArchiveService } from './ai-conversation-archive.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [InternalDiagnosticsController,
    ShopifyOrderDetailDiagnosticsController,
    AppController,
    AutomationsController,
    AutomationMessageConfigController,
    WhatsappWebhookController,
    InboxController,
    IntegrationsController,
    ShopifyOauthController,
    ShopifyIntegrationTestController,
    ShopifyWebhookController,
    CompanyCommerceTestController,
    ShopifyCatalogPreviewController,
    ClientsController,
    CompanySettingsController,
    CompanyProfileController,
    CompanyProductsController,
    CompanyStorefrontController,
    UsersController,
    RolesController,
    QuickRepliesController,
    AccessController,
    AccessCapabilitiesController,
    SupportSettingsController,
    AdvisorPresenceController,
    ServiceAreasController,
    PlatformHealthController,
    WhatsappTemplateController,
    PushNotificationController,
  ],
  providers: [
    CompanyIntegrationService,
    CompanyShopifyService,
    CompanyCommerceService,
    CustomerOrderService,
    IntegrationCredentialsService,
    WhatsappMessagingService,
    AppService,
    AutomationRuntimeService,
    AutomationTestSendService,
    AutomationMessageConfigService,
    ShopifyService,
    ShopifyAbandonedCheckoutSyncService,
    ShopifyWebhookEventService,
    ShopifyAutomationProcessorService,
    ShopifyAutomaticTestSendService,
    ShopifyWebhookSubscriptionService,
    AiService,
    SupabaseService,
    ConversationMemoryService,
    CartService,
    ChatAgentService,
    CartRecoveryService,
    CartRecoveryContextService,
    AccessAuthService,
    PlatformHealthService,
    WhatsappTemplateService,
    WhatsappTemplateExecutionService,
    PushNotificationService,
    AiConversationArchiveService,
  ],
})
export class AppModule {}
