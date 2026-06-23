import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ShopifyService } from './shopify.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [],
  controllers: [AppController, WhatsappWebhookController],
  providers: [AppService, ShopifyService, AiService],
})
export class AppModule {}