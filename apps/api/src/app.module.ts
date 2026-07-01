import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiService } from './ai.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CartRecoveryService } from './cart-recovery.service';
import { CartService } from './cart.service';
import { ChatAgentService } from './chat-agent.service';
import { ClientsController } from './clients.controller';
import { CompanyIntegrationService } from './company-integration.service';
import { CompanySettingsController } from './company-settings.controller';
import { ConversationMemoryService } from './conversation-memory.service';
import { InboxController } from './inbox.controller';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';

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
  ],
})
export class AppModule {}
