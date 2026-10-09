import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Patch,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';

const LEAD_STATUS_TAGS: Record<string, string> = {
  'Lead nuevo': 'LEAD-NUEVO',
  'Respondió': 'LEAD-RESPONDIO',
  'Calificado': 'LEAD-CALIFICADO',
  'Interesado': 'LEAD-INTERESADO',
  'Asesor/Cita': 'LEAD-ASESOR-CITA',
  'Venta': 'LEAD-VENTA',
  'No interesado': 'LEAD-NO-INTERESADO',
};

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
      leadStatuses: Object.keys(LEAD_STATUS_TAGS),
    };
  }

  @Patch('status')
  async updateStatus(
    @Headers('x-chatpro-inbox-key') providedKey = '',
    @Headers('x-chatpro-company-id') headerCompanyId = '',
    @Body() body: { company?: unknown; phone?: unknown; status?: unknown } = {},
  ) {
    this.authorize(providedKey);

    const companySlug =
      typeof body.company === 'string' ? body.company.trim() : '';
    const phone =
      typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
    const status =
      typeof body.status === 'string' ? body.status.trim() : '';

    if (!companySlug || !phone || !status) {
      throw new BadRequestException('Faltan empresa, teléfono o estado del lead.');
    }

    if (!LEAD_STATUS_TAGS[status]) {
      throw new BadRequestException('Estado de lead no válido.');
    }

    const profile = await this.conversationMemoryService.getCompanyProfile(
      companySlug,
    );

    if (headerCompanyId.trim() !== profile.id) {
      throw new UnauthorizedException('Empresa no autorizada.');
    }

    const client = this.supabaseService.getClient();
    const { data: contact, error: contactError } = await client
      .from('contacts')
      .select('id, phone, tags, notes')
      .eq('company_id', profile.id)
      .eq('phone', phone)
      .maybeSingle();

    if (contactError) {
      throw new Error(`No se pudo consultar el lead: ${contactError.message}`);
    }

    if (!contact?.id) {
      throw new BadRequestException('No existe ese lead en la empresa activa.');
    }

    const currentTags = Array.isArray(contact.tags)
      ? contact.tags.filter((item: unknown): item is string => typeof item === 'string')
      : [];
    const funnelTags = new Set(Object.values(LEAD_STATUS_TAGS));
    const tags = currentTags.filter((tag) => !funnelTags.has(tag));
    tags.push(LEAD_STATUS_TAGS[status]);

    const notes = this.setNoteValue(
      typeof contact.notes === 'string' ? contact.notes : '',
      'Estado lead',
      status,
    );

    const { error: updateContactError } = await client
      .from('contacts')
      .update({
        tags: Array.from(new Set(tags)),
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
      .eq('company_id', profile.id);

    if (updateContactError) {
      throw new Error(
        `No se pudo actualizar el estado del lead: ${updateContactError.message}`,
      );
    }

    const { data: sessionRow, error: sessionError } = await client
      .from('conversation_sessions')
      .select('id, context')
      .eq('company_id', profile.id)
      .eq('customer_phone', phone)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      throw new Error(
        `El lead se actualizó, pero no se pudo consultar su conversación: ${sessionError.message}`,
      );
    }

    if (sessionRow?.id) {
      const currentContext =
        sessionRow.context &&
        typeof sessionRow.context === 'object' &&
        !Array.isArray(sessionRow.context)
          ? sessionRow.context as Record<string, unknown>
          : {};
      const currentLeadContext =
        currentContext.lead_context &&
        typeof currentContext.lead_context === 'object' &&
        !Array.isArray(currentContext.lead_context)
          ? currentContext.lead_context as Record<string, unknown>
          : {};

      await this.conversationMemoryService.updateSession(sessionRow.id, {
        context: {
          ...currentContext,
          lead_status: status,
          lead_status_updated_at: new Date().toISOString(),
          lead_context: {
            ...currentLeadContext,
            lead_status: status,
          },
        },
      });
    }

    return {
      ok: true,
      phone,
      status,
      tag: LEAD_STATUS_TAGS[status],
    };
  }

  private setNoteValue(notes: string, label: string, value: string): string {
    const lines = notes.split(/\r?\n/);
    const prefix = `${label.toLowerCase()}:`;
    const index = lines.findIndex((line) =>
      line.trim().toLowerCase().startsWith(prefix),
    );
    const nextLine = `${label}: ${value}`;

    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      lines.push(nextLine);
    }

    return lines.join('\n').trim();
  }

  private authorize(providedKey: string) {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey.trim() !== expectedKey) {
      throw new UnauthorizedException('No autorizado para ver leads.');
    }
  }
}
