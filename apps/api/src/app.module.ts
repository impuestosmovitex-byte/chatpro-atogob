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
import { CompanySettingsController } from './company-settings.controller';
import { ConversationMemoryService } from './conversation-memory.service';
import { InboxController } from './inbox.controller';
import { RolesController } from './roles.controller';
import { QuickRepliesController } from './quick-replies.controller';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';
import { SupportSettingsController } from './support-settings.controller';
import { AdvisorPresenceController } from './advisor-presence.controller';
import { ServiceAreasController } from './service-areas.controller';
import { UsersController } from './users.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    AppController,
    WhatsappWebhookController,
    InboxController,
    ClientsController,
    CompanySettingsController,
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
