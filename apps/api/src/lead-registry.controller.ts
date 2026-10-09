import OpenAI from 'openai';
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
import { Interval } from '@nestjs/schedule';
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

const AUTO_STATUS_RANK: Record<string, number> = {
  'Lead nuevo': 0,
  'Respondió': 1,
  'Calificado': 2,
  'Interesado': 3,
  'Asesor/Cita': 4,
  'Venta': 5,
};

const AUTO_CLASSIFY_COMPANY_SLUG = 'emprende-con-maogo';
const TERMINAL_AUTO_STATUSES = new Set(['Venta', 'No interesado']);

type JsonObject = Record<string, unknown>;

type LeadSessionRow = {
  id: string;
  customer_phone: string;
  context: JsonObject | null;
  attention_status: string | null;
  last_message_at: string | null;
};

type LeadContactRow = {
  id: string;
  phone: string;
  tags: unknown;
  notes: string | null;
};

@Controller('lead-registry')
export class LeadRegistryController {
  private openAiClient: OpenAI | null = null;
  private leadClassificationRunning = false;

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

    const respondedPhones = await this.findRespondedPhones(
      profile.id,
      rows
        .map((row) => (typeof row.phone === 'string' ? row.phone : ''))
        .filter(Boolean),
    );

    const clients = rows.map((row) => {
      const firstSeenAt =
        typeof row.first_seen_at === 'string' ? row.first_seen_at : null;
      const lastActivityAt =
        typeof row.last_activity_at === 'string'
          ? row.last_activity_at
          : firstSeenAt;
      const phone = typeof row.phone === 'string' ? row.phone : '';
      const rawNotes = typeof row.notes === 'string' ? row.notes : '';
      const storedStatus = this.noteValue(rawNotes, 'Estado lead');
      const notes =
        respondedPhones.has(phone) &&
        (!storedStatus || storedStatus === 'Lead nuevo')
          ? this.setNoteValue(rawNotes, 'Estado lead', 'Respondió')
          : rawNotes;

      return {
        customerPhone: phone,
        lastMessageAt: lastActivityAt ?? firstSeenAt ?? new Date(0).toISOString(),
        contact: {
          id: typeof row.id === 'string' ? row.id : '',
          companyId:
            typeof row.company_id === 'string' ? row.company_id : profile.id,
          phone,
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
          notes,
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
      const currentContext = this.toJsonObject(sessionRow.context);
      const currentLeadContext = this.toJsonObject(currentContext.lead_context);

      await this.conversationMemoryService.updateSession(sessionRow.id, {
        context: {
          ...currentContext,
          lead_status: status,
          lead_status_updated_at: new Date().toISOString(),
          lead_status_source: 'manual',
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

  @Interval(60_000)
  async autoClassifyRecentLeads(): Promise<void> {
    if (this.leadClassificationRunning) {
      return;
    }

    const openAi = this.getOpenAiClient();
    if (!openAi) {
      return;
    }

    this.leadClassificationRunning = true;

    try {
      const profile = await this.conversationMemoryService.getCompanyProfile(
        AUTO_CLASSIFY_COMPANY_SLUG,
      );
      const client = this.supabaseService.getClient();
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data: rawSessions, error: sessionsError } = await client
        .from('conversation_sessions')
        .select('id, customer_phone, context, attention_status, last_message_at')
        .eq('company_id', profile.id)
        .gte('last_message_at', cutoff)
        .order('last_message_at', { ascending: false })
        .limit(80);

      if (sessionsError) {
        throw new Error(
          `No se pudieron consultar leads para clasificación: ${sessionsError.message}`,
        );
      }

      const sessions = (rawSessions ?? [])
        .map((row: any) => ({
          id: typeof row.id === 'string' ? row.id : '',
          customer_phone:
            typeof row.customer_phone === 'string' ? row.customer_phone : '',
          context: this.toJsonObject(row.context),
          attention_status:
            typeof row.attention_status === 'string' ? row.attention_status : null,
          last_message_at:
            typeof row.last_message_at === 'string' ? row.last_message_at : null,
        } satisfies LeadSessionRow))
        .filter((row) => {
          const leadContext = this.toJsonObject(row.context?.lead_context);
          return Boolean(row.id && row.customer_phone && Object.keys(leadContext).length);
        });

      if (!sessions.length) {
        return;
      }

      const phones = Array.from(
        new Set(sessions.map((session) => session.customer_phone)),
      );

      const { data: rawContacts, error: contactsError } = await client
        .from('contacts')
        .select('id, phone, tags, notes')
        .eq('company_id', profile.id)
        .in('phone', phones);

      if (contactsError) {
        throw new Error(
          `No se pudieron consultar contactos para clasificación: ${contactsError.message}`,
        );
      }

      const contactsByPhone = new Map<string, LeadContactRow>();
      for (const raw of rawContacts ?? []) {
        if (typeof raw.phone !== 'string' || !raw.phone) continue;
        contactsByPhone.set(raw.phone, {
          id: typeof raw.id === 'string' ? raw.id : '',
          phone: raw.phone,
          tags: raw.tags,
          notes: typeof raw.notes === 'string' ? raw.notes : '',
        });
      }

      let processed = 0;

      for (const session of sessions) {
        if (processed >= 25) break;

        const contact = contactsByPhone.get(session.customer_phone);
        if (!contact?.id) continue;

        const context = this.toJsonObject(session.context);
        const leadContext = this.toJsonObject(context.lead_context);
        const storedStatus =
          this.noteValue(contact.notes ?? '', 'Estado lead') ||
          (typeof leadContext.lead_status === 'string'
            ? leadContext.lead_status.trim()
            : '') ||
          'Lead nuevo';

        if (TERMINAL_AUTO_STATUSES.has(storedStatus)) {
          continue;
        }

        const lastMessageAt = session.last_message_at || '';
        const checkedAt =
          typeof context.lead_status_ai_checked_at === 'string'
            ? context.lead_status_ai_checked_at
            : '';

        if (
          checkedAt &&
          lastMessageAt &&
          !Number.isNaN(Date.parse(checkedAt)) &&
          !Number.isNaN(Date.parse(lastMessageAt)) &&
          Date.parse(checkedAt) >= Date.parse(lastMessageAt)
        ) {
          continue;
        }

        processed += 1;

        const { data: messageRows, error: messagesError } = await client
          .from('conversations')
          .select('author_type, message, created_at')
          .eq('company_id', profile.id)
          .eq('session_id', session.id)
          .order('created_at', { ascending: false })
          .limit(18);

        if (messagesError) {
          console.error(
            `[LeadAI] No se pudo leer la conversación ${session.id}:`,
            messagesError,
          );
          continue;
        }

        const history = [...(messageRows ?? [])]
          .reverse()
          .map((row: any) => ({
            role:
              row.author_type === 'customer'
                ? 'cliente'
                : row.author_type === 'advisor'
                  ? 'asesor'
                  : 'ia',
            message:
              typeof row.message === 'string'
                ? row.message.replace(/\s+/g, ' ').trim().slice(0, 1200)
                : '',
            created_at:
              typeof row.created_at === 'string' ? row.created_at : null,
          }))
          .filter((item) => item.message);

        const hasCustomerMessage = history.some(
          (message) => message.role === 'cliente',
        );

        if (!hasCustomerMessage) {
          await this.markAiChecked(session, storedStatus, 'Sin respuesta del cliente.');
          continue;
        }

        let proposedStatus =
          storedStatus === 'Lead nuevo' ? 'Respondió' : storedStatus;
        let reason =
          storedStatus === 'Lead nuevo'
            ? 'El cliente ya respondió por WhatsApp.'
            : 'Se conserva el estado actual.';

        const handoff = this.toJsonObject(context.handoff);
        const handoffStatus =
          typeof handoff.status === 'string' ? handoff.status.toLowerCase() : '';

        if (
          session.attention_status === 'human' ||
          handoffStatus === 'assigned' ||
          handoffStatus.startsWith('waiting_') ||
          handoffStatus === 'pending'
        ) {
          proposedStatus = 'Asesor/Cita';
          reason = 'El lead fue transferido o asignado a atención humana.';
        } else {
          try {
            const response = await openAi.responses.create({
              model: this.getOpenAiModel(),
              instructions: [
                'Clasifica el estado comercial de un lead de Emprende con Maogo.',
                'Devuelve SOLO JSON válido con esta forma: {"status":"Respondió|Calificado|Interesado|Asesor/Cita|No interesado","reason":"frase breve"}.',
                'Usa Respondió cuando solo contestó, saludó, pulsó un botón o todavía no hay suficiente información comercial.',
                'Usa Calificado cuando ya está claro qué quiere lograr y qué necesidad o área de formación le interesa.',
                'Usa Interesado únicamente cuando demuestra intención comercial real: pregunta por precio, inscripción, beneficio, forma de empezar, pago, cupo, duración del programa o dice que quiere ingresar/comprar/inscribirse.',
                'Usa Asesor/Cita únicamente cuando el cliente pide hablar con una persona, acepta explícitamente una llamada/cita/asesor o confirma que quiere que lo contacten.',
                'Usa No interesado únicamente cuando rechaza claramente continuar, dice que no le interesa o pide no ser contactado.',
                'Nunca devuelvas Venta. La venta solo se confirma por pago/inscripción real o por un asesor.',
                'No subas a Interesado solo porque respondió preguntas de calificación.',
                'No marques No interesado por silencio, dudas, demora o respuestas cortas.',
                'Ten en cuenta los datos del formulario para no exigir que el cliente repita información ya conocida.',
              ].join('\n'),
              input: JSON.stringify({
                estado_actual: proposedStatus,
                datos_del_lead: leadContext,
                conversacion: history,
              }),
            });

            const parsed = this.parseAiStatus(response.output_text);
            if (parsed) {
              proposedStatus = this.preventAutomaticRegression(
                proposedStatus,
                parsed.status,
              );
              reason = parsed.reason || reason;
            }
          } catch (error) {
            console.error(
              `[LeadAI] Falló clasificación de ${session.customer_phone}:`,
              error,
            );
          }
        }

        await this.persistAutomaticStatus(
          profile.id,
          session,
          contact,
          proposedStatus,
          reason,
        );
      }
    } catch (error) {
      console.error('[LeadAI] Falló el clasificador automático de leads:', error);
    } finally {
      this.leadClassificationRunning = false;
    }
  }

  private getOpenAiClient(): OpenAI | null {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return null;

    if (!this.openAiClient) {
      this.openAiClient = new OpenAI({ apiKey });
    }

    return this.openAiClient;
  }

  private getOpenAiModel(): string {
    return process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';
  }

  private parseAiStatus(
    raw: string,
  ): { status: string; reason: string } | null {
    const text = raw?.trim();
    if (!text) return null;

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        status?: unknown;
        reason?: unknown;
      };
      const status =
        typeof parsed.status === 'string' ? parsed.status.trim() : '';
      const reason =
        typeof parsed.reason === 'string'
          ? parsed.reason.replace(/\s+/g, ' ').trim().slice(0, 240)
          : '';
      const allowed = new Set([
        'Respondió',
        'Calificado',
        'Interesado',
        'Asesor/Cita',
        'No interesado',
      ]);

      return allowed.has(status) ? { status, reason } : null;
    } catch {
      return null;
    }
  }

  private preventAutomaticRegression(current: string, proposed: string): string {
    if (proposed === 'No interesado') {
      return current === 'Venta' ? current : proposed;
    }

    if (current === 'No interesado' || current === 'Venta') {
      return current;
    }

    const currentRank = AUTO_STATUS_RANK[current] ?? 0;
    const proposedRank = AUTO_STATUS_RANK[proposed] ?? 0;

    return proposedRank >= currentRank ? proposed : current;
  }

  private async persistAutomaticStatus(
    companyId: string,
    session: LeadSessionRow,
    contact: LeadContactRow,
    status: string,
    reason: string,
  ): Promise<void> {
    const client = this.supabaseService.getClient();
    const now = new Date().toISOString();
    const currentTags = Array.isArray(contact.tags)
      ? contact.tags.filter((item: unknown): item is string => typeof item === 'string')
      : [];
    const funnelTags = new Set(Object.values(LEAD_STATUS_TAGS));
    const tags = currentTags.filter((tag) => !funnelTags.has(tag));

    if (LEAD_STATUS_TAGS[status]) {
      tags.push(LEAD_STATUS_TAGS[status]);
    }

    const notes = this.setNoteValue(
      contact.notes ?? '',
      'Estado lead',
      status,
    );

    const { error: contactError } = await client
      .from('contacts')
      .update({
        tags: Array.from(new Set(tags)),
        notes,
        updated_at: now,
      })
      .eq('id', contact.id)
      .eq('company_id', companyId);

    if (contactError) {
      throw new Error(
        `No se pudo guardar la clasificación del lead: ${contactError.message}`,
      );
    }

    const context = this.toJsonObject(session.context);
    const leadContext = this.toJsonObject(context.lead_context);
    const nextContext: JsonObject = {
      ...context,
      lead_status: status,
      lead_status_updated_at: now,
      lead_status_source: 'ai',
      lead_status_reason: reason.slice(0, 240),
      lead_status_ai_checked_at: session.last_message_at || now,
      lead_context: {
        ...leadContext,
        lead_status: status,
      },
    };

    const { error: sessionError } = await client
      .from('conversation_sessions')
      .update({
        context: nextContext,
        updated_at: now,
      })
      .eq('id', session.id)
      .eq('company_id', companyId);

    if (sessionError) {
      throw new Error(
        `El lead se clasificó, pero no se pudo sincronizar su conversación: ${sessionError.message}`,
      );
    }
  }

  private async markAiChecked(
    session: LeadSessionRow,
    status: string,
    reason: string,
  ): Promise<void> {
    const context = this.toJsonObject(session.context);
    const leadContext = this.toJsonObject(context.lead_context);
    const now = new Date().toISOString();

    const { error } = await this.supabaseService
      .getClient()
      .from('conversation_sessions')
      .update({
        context: {
          ...context,
          lead_status: status,
          lead_status_ai_checked_at: session.last_message_at || now,
          lead_status_reason: reason,
          lead_context: {
            ...leadContext,
            lead_status: status,
          },
        },
        updated_at: now,
      })
      .eq('id', session.id);

    if (error) {
      console.error(
        `[LeadAI] No se pudo marcar revisión de ${session.id}:`,
        error,
      );
    }
  }

  private async findRespondedPhones(
    companyId: string,
    phones: string[],
  ): Promise<Set<string>> {
    const uniquePhones = Array.from(new Set(phones.filter(Boolean)));
    const responded = new Set<string>();
    const client = this.supabaseService.getClient();
    const chunkSize = 400;

    for (let offset = 0; offset < uniquePhones.length; offset += chunkSize) {
      const chunk = uniquePhones.slice(offset, offset + chunkSize);
      const { data, error } = await client
        .from('conversations')
        .select('customer_phone')
        .eq('company_id', companyId)
        .eq('author_type', 'customer')
        .in('customer_phone', chunk)
        .limit(10000);

      if (error) {
        throw new Error(
          `No se pudo calcular qué leads respondieron: ${error.message}`,
        );
      }

      for (const row of data ?? []) {
        if (typeof row.customer_phone === 'string' && row.customer_phone) {
          responded.add(row.customer_phone);
        }
      }
    }

    return responded;
  }

  private noteValue(notes: string, label: string): string {
    const prefix = `${label.toLowerCase()}:`;
    const line = notes
      .split(/\r?\n/)
      .find((item) => item.trim().toLowerCase().startsWith(prefix));

    if (!line) return '';
    return line.slice(line.indexOf(':') + 1).trim();
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

  private toJsonObject(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private authorize(providedKey: string) {
    const expectedKey = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expectedKey || providedKey.trim() !== expectedKey) {
      throw new UnauthorizedException('No autorizado para ver leads.');
    }
  }
}
