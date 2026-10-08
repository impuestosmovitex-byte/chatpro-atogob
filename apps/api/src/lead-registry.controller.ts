import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';

@Controller('lead-registry')
export class LeadRegistryController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Query('company') company = '',
    @Query('tag') tag = 'EFFIX-2026',
    @Query('limit') limit = '5000',
  ) {
    this.authorize(providedKey);

    const companySlug = company.trim();
    if (!companySlug) {
      throw new ForbiddenException('Falta la empresa.');
    }

    const profile = await this.conversationMemoryService.getCompanyProfile(
      companySlug,
    );

    if (headerCompanyId.trim() !== profile.id) {
      throw new UnauthorizedException('Empresa no autorizada.');
    }

    const requestedLimit = Number.parseInt(limit, 10);
    const max = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 5000)
      : 5000;
    const cleanTag = tag.trim().slice(0, 40);
    const pageSize = 1000;
    const rows: any[] = [];

    for (let offset = 0; offset < max; offset += pageSize) {
      const end = Math.min(offset + pageSize, max) - 1;

      let query = this.supabaseService
        .getClient()
        .from('contacts')
        .select(
          'id, company_id, phone, display_name, primary_channel, tags, notes, first_seen_at, last_activity_at',
        )
        .eq('company_id', profile.id)
        .order('first_seen_at', { ascending: false })
        .range(offset, end);

      if (cleanTag) {
        query = query.contains('tags', [cleanTag]);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`No se pudieron consultar los leads: ${error.message}`);
      }

      const batch = data ?? [];
      rows.push(...batch);

      if (batch.length < end - offset + 1) {
        break;
      }
    }

    const clients = rows.map((row) => {
      const firstSeenAt =
        typeof row.first_seen_at === 'string' ? row.first_seen_at : null;
      const lastActivityAt =
        typeof row.last_activity_at === 'string'
          ? row.last_activity_at
          : firstSeenAt;

      return {
        customerPhone: typeof row.phone === 'string' ? row.phone : '',
        lastMessageAt: lastActivityAt ?? firstSeenAt ?? new Date(0).toISOString(),
        contact: {
          id: typeof row.id === 'string' ? row.id : '',
          companyId:
            typeof row.company_id === 'string' ? row.company_id : profile.id,
          phone: typeof row.phone === 'string' ? row.phone : '',
          displayName:
            typeof row.display_name === 'string' && row.display_name.trim()
              ? row.display_name.trim()
              : null,
          primaryChannel:
            row.primary_channel === 'instagram' ||
            row.primary_channel === 'messenger' ||
            row.primary_channel === 'manual'
              ? row.primary_channel
              : 'whatsapp',
          tags: Array.isArray(row.tags)
            ? row.tags.filter((item: unknown) => typeof item === 'string')
            : [],
          notes: typeof row.notes === 'string' ? row.notes : '',
          firstSeenAt,
          lastActivityAt,
        },
      };
    });

    return {
      ok: true,
      company: { id: profile.id, slug: profile.slug, name: profile.name },
      clients,
      total: clients.length,
      deduplication: 'phone',
      maxSupported: 5000,
    };
  }

  private authorize(providedKey: string) {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey.trim() !== expectedKey) {
      throw new UnauthorizedException('No autorizado para ver leads.');
    }
  }
}
