import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AccessAuthService } from './access-auth.service';
import { AccessController } from './access.controller';
import { AiService } from './ai.service';
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
import { CompanyCommerceTestController } from './company-commerce-test.controller';
import { ShopifyCatalogPreviewController } from './shopify-catalog-preview.controller';
import { SupabaseService } from './supabase.service';
import { SupportSettingsController } from './support-settings.controller';
import { AdvisorPresenceController } from './advisor-presence.controller';
import { ServiceAreasController } from './service-areas.controller';
import { UsersController } from './users.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappMessagingService } from './whatsapp-messaging.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    AppController,
    WhatsappWebhookController,
    InboxController,
    IntegrationsController,
    ShopifyOauthController,
    ShopifyIntegrationTestController,
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
    SupportSettingsController,
    AdvisorPresenceController,
    ServiceAreasController,
  ],
  providers: [
    CompanyIntegrationService,
    CompanyShopifyService,
    CompanyCommerceService,
    CustomerOrderService,
    IntegrationCredentialsService,
    WhatsappMessagingService,
    AppService,
    ShopifyService,
    ShopifyAbandonedCheckoutSyncService,
    AiService,
    SupabaseService,
    ConversationMemoryService,
    CartService,
    ChatAgentService,
    CartRecoveryService,
    CartRecoveryContextService,
    AccessAuthService,
  ],
})
export class AppModule {}
