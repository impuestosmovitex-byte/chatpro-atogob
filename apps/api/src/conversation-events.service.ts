import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

export type ConversationEventType =
  | 'conversation_started'
  | 'customer_message'
  | 'ai_message'
  | 'advisor_message'
  | 'human_handoff_requested'
  | 'human_handoff_assigned'
  | 'checkout_created'
  | 'payment_proof_received'
  | 'order_created'
  | 'payment_pending'
  | 'order_paid'
  | 'conversation_closed'
  | 'conversation_resumed_ai';

type RecordEventInput = {
  companyId: string;
  sessionId?: string | null;
  customerPhone?: string | null;
  channel?: 'whatsapp' | 'instagram' | 'messenger' | 'manual';
  eventType: ConversationEventType;
  eventSource?: 'customer' | 'ai' | 'advisor' | 'automation' | 'system' | 'shopify';
  advisorUserId?: string | null;
  advisorName?: string | null;
  serviceAreaId?: string | null;
  serviceAreaName?: string | null;
  metadata?: JsonObject;
  createdAt?: string;
};

@Injectable()
export class ConversationEventsService {
  private readonly logger = new Logger(ConversationEventsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async record(input: RecordEventInput): Promise<void> {
    const companyId = input.companyId.trim();

    if (!companyId || !input.eventType) {
      return;
    }

    const { error } = await this.supabaseService
      .getClient()
      .from('conversation_events')
      .insert({
        company_id: companyId,
        session_id: input.sessionId?.trim() || null,
        customer_phone: input.customerPhone?.trim() || null,
        channel: input.channel || 'whatsapp',
        event_type: input.eventType,
        event_source: input.eventSource || 'system',
        advisor_user_id: input.advisorUserId?.trim() || null,
        advisor_name: input.advisorName?.trim() || null,
        service_area_id: input.serviceAreaId?.trim() || null,
        service_area_name: input.serviceAreaName?.trim() || null,
        metadata: input.metadata || {},
        created_at: input.createdAt || new Date().toISOString(),
      });

    if (error) {
      this.logger.error(
        `No se pudo registrar evento ${input.eventType}: ${error.message}`,
      );
    }
  }
}
