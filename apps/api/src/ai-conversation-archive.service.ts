import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from './supabase.service';
import { ConversationEventsService } from './conversation-events.service';

type ArchiveSetting = {
  company_id: string;
  ai_auto_archive_enabled: boolean | null;
  ai_auto_archive_hours: number | null;
};

@Injectable()
export class AiConversationArchiveService {
  private readonly logger = new Logger(
    AiConversationArchiveService.name,
  );

  private isRunning = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly conversationEventsService: ConversationEventsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async archiveInactiveAiConversations(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      await this.processCompanies();
    } catch (error) {
      this.logger.error(
        'No se pudieron archivar las conversaciones inactivas de IA.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async processCompanies(): Promise<void> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('company_support_settings')
      .select(
        'company_id,ai_auto_archive_enabled,ai_auto_archive_hours',
      )
      .eq('ai_auto_archive_enabled', true);

    if (error) {
      throw new Error(
        `No se pudo consultar la configuración de archivo automático: ${error.message}`,
      );
    }

    const settings = (data ?? []) as ArchiveSetting[];

    for (const setting of settings) {
      await this.archiveCompany(setting);
    }
  }

  private async archiveCompany(
    setting: ArchiveSetting,
  ): Promise<void> {
    const companyId =
      typeof setting.company_id === 'string'
        ? setting.company_id.trim()
        : '';

    if (!companyId) {
      return;
    }

    const configuredHours = Number(
      setting.ai_auto_archive_hours,
    );

    const hours =
      Number.isInteger(configuredHours) &&
      configuredHours >= 1 &&
      configuredHours <= 720
        ? configuredHours
        : 12;

    const cutoff = new Date(
      Date.now() - hours * 60 * 60 * 1000,
    ).toISOString();

    const now = new Date().toISOString();
    const client = this.supabaseService.getClient();

    // Archive only conversations whose *latest persisted message* is from the
    // assistant or an advisor. Never hide a customer-last conversation, even
    // when its pending counter was not incremented correctly.
    const { data, error } = await client
      .from('conversation_sessions')
      .select('id, customer_phone, last_message_at')
      .eq('company_id', companyId)
      .eq('attention_status', 'ai')
      .eq('pending_count', 0)
      .neq('customer_phone', '__chatpro_internal_test__')
      .lte('last_message_at', cutoff)
      .order('last_message_at', { ascending: true })
      .limit(500);

    if (error) {
      throw new Error(
        `No se pudieron consultar las conversaciones inactivas de la empresa ${companyId}: ${error.message}`,
      );
    }

    let archivedCount = 0;
    for (const row of data ?? []) {
      if (!row.id || !row.last_message_at) continue;
      try {
        const { data: last, error: lastError } = await client
          .from('conversations')
          .select('author_type, created_at')
          .eq('company_id', companyId)
          .eq('session_id', row.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastError) throw lastError;
        // Unknown or customer-last messages must stay in the active inbox.
        if (last?.author_type !== 'ai' && last?.author_type !== 'advisor') {
          continue;
        }
        if (!last.created_at || Date.parse(last.created_at) > Date.parse(cutoff)) {
          continue;
        }

        const { data: updated, error: updateError } = await client
          .from('conversation_sessions')
          .update({
            attention_status: 'closed',
            assigned_to_user_id: null,
            assigned_to_name: null,
            taken_at: null,
            closed_at: now,
          })
          .eq('id', row.id)
          .eq('company_id', companyId)
          .eq('attention_status', 'ai')
          .eq('pending_count', 0)
          .eq('last_message_at', row.last_message_at)
          .select('id');

        if (updateError) throw updateError;
        if (!updated?.length) continue;
        archivedCount++;
        await this.conversationEventsService.record({
          companyId,
          sessionId: row.id,
          customerPhone: row.customer_phone ?? null,
          eventType: 'conversation_closed',
          eventSource: 'system',
          metadata: {
            close_reason: 'ai_inactivity',
            inactivity_hours: hours,
          },
          createdAt: now,
        });
      } catch (rowError) {
        this.logger.error(
          `No se pudo revisar la conversación ${row.id} sin ocultar mensajes pendientes.`,
          rowError instanceof Error ? rowError.stack : undefined,
        );
      }
    }

    if (archivedCount > 0) {
      this.logger.log(
        `Se archivaron ${archivedCount} conversaciones de IA inactivas para la empresa ${companyId}.`,
      );
    }
  }
}
