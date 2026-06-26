import { CompanyIntegrationService } from './company-integration.service';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiService } from './ai.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CartRecoveryService } from './cart-recovery.service';
import { CartService } from './cart.service';
import { ChatAgentService } from './chat-agent.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController, WhatsappWebhookController],
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