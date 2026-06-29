import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiService } from './ai.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CartRecoveryService } from './cart-recovery.service';
import { CartService } from './cart.service';
import { ChatAgentService } from './chat-agent.service';
import { CompanyIntegrationService } from './company-integration.service';
import { CompanySettingsController } from './company-settings.controller';
import { ConversationMemoryService } from './conversation-memory.service';
import { InboxController } from './inbox.controller';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    AppController,
    WhatsappWebhookController,
    InboxController,
    CompanySettingsController,
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
