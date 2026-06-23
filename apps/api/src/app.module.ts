import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ShopifyService } from './shopify.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [],
  controllers: [AppController, WhatsappWebhookController],
  providers: [AppService, ShopifyService],
})
export class AppModule {}