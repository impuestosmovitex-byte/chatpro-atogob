import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [],
  controllers: [AppController, WhatsappWebhookController],
  providers: [AppService],
})
export class AppModule {}