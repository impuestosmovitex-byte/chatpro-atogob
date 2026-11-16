import { Module } from '@nestjs/common';
import { MediaLabController } from './media-lab.controller';

/**
 * Only two read endpoints exist in this isolated module.
 * NEVER import AppModule, StagingAppModule, InboxController, webhook
 * controllers, messaging providers, Supabase or background schedulers here.
 */
@Module({ controllers: [MediaLabController], providers: [] })
export class MediaLabModule {}
