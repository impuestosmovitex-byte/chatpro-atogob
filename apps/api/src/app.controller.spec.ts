import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { AppController } from './app.controller';
import { ConversationMemoryService } from './conversation-memory.service';
import { ShopifyAbandonedCheckoutSyncService } from './shopify-abandoned-checkout-sync.service';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: ShopifyService,
          useValue: {},
        },
        {
          provide: ShopifyAbandonedCheckoutSyncService,
          useValue: {},
        },
        {
          provide: AiService,
          useValue: {},
        },
        {
          provide: SupabaseService,
          useValue: {},
        },
        {
          provide: ConversationMemoryService,
          useValue: {},
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return the API status', () => {
      expect(appController.getStatus()).toEqual({
        ok: true,
        service: 'Chat Pro API',
      });
    });
  });
});
