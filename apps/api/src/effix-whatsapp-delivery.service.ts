import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SupabaseService } from './supabase.service';

const TARGET_COMPANY_SLUG = 'emprende-con-maogo';
const SOURCE_NAME = 'Registro EFFIX 2026';
const WELCOME_SENT_TAG = 'EFFIX-WELCOME-SENT';
const WELCOME_FAILED_TAG = 'EFFIX-WELCOME-FAILED';

@Injectable()
export class EffixWhatsappDeliveryService implements OnModuleInit {
  private running = false;

  constructor(private readonly supabaseService: SupabaseService) {}

  async onModuleInit(): Promise<void> {
    // Reconciliamos también mensajes anteriores al despliegue, para que un
    // fallo asíncrono de Meta no quede marcado como enviado para siempre.
    await this.reconcile().catch((error) => {
      console.error('[EFFIX][delivery] No se pudo hacer la conciliación inicial:', error);
    });
  }

  @Interval(60_000)
  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const client = this.supabaseService.getClient();
      const { data: company, error: companyError } = await client
        .from('companies')
        .select('id')
        .eq('slug', TARGET_COMPANY_SLUG)
        .eq('status', 'active')
        .maybeSingle();

      if (companyError) {
        throw new Error(`No se pudo consultar Emprende con Maogo: ${companyError.message}`);
      }

      if (!company?.id) return;

      const { data: messages, error: messagesError } = await client
        .from('conversations')
        .select('customer_phone, status, provider_error, created_at, provider_message_id')
        .eq('company_id', company.id)
        .eq('source_name', SOURCE_NAME)
        .eq('author_type', 'ai')
        .order('created_at', { ascending: false })
        .limit(500);

      if (messagesError) {
        throw new Error(`No se pudieron consultar los WhatsApp EFFIX: ${messagesError.message}`);
      }

      // Solo importa el intento más reciente por teléfono.
      const latestByPhone = new Map<string, any>();
      for (const row of messages ?? []) {
        const phone =
          typeof row.customer_phone === 'string'
            ? row.customer_phone.replace(/\D/g, '')
            : '';
        if (phone && !latestByPhone.has(phone)) {
          latestByPhone.set(phone, row);
        }
      }

      for (const [phone, row] of latestByPhone.entries()) {
        const status =
          typeof row.status === 'string'
            ? row.status.trim().toLowerCase()
            : '';

        if (!['sent', 'delivered', 'read', 'failed'].includes(status)) {
          continue;
        }

        const { data: contact, error: contactError } = await client
          .from('contacts')
          .select('id, tags, notes')
          .eq('company_id', company.id)
          .eq('phone', phone)
          .maybeSingle();

        if (contactError) {
          console.error(
            `[EFFIX][delivery] No se pudo consultar contacto ${phone.slice(-4)}:`,
            contactError,
          );
          continue;
        }

        if (!contact?.id) continue;

        const currentTags = Array.isArray(contact.tags)
          ? contact.tags.filter((item: unknown): item is string => typeof item === 'string')
          : [];
        let nextTags = [...currentTags];
        let notes = typeof contact.notes === 'string' ? contact.notes : '';

        if (status === 'failed') {
          nextTags = nextTags.filter(
            (tag) => tag !== WELCOME_SENT_TAG && tag !== WELCOME_FAILED_TAG,
          );
          nextTags.push(WELCOME_FAILED_TAG);

          const providerError =
            typeof row.provider_error === 'string' && row.provider_error.trim()
              ? row.provider_error.trim().slice(0, 700)
              : 'Meta reportó que el mensaje no pudo entregarse.';

          notes = this.setNoteValue(notes, 'Estado WhatsApp EFFIX', 'Fallido');
          notes = this.setNoteValue(notes, 'Error WhatsApp EFFIX', providerError);
          notes = this.setNoteValue(
            notes,
            'Último intento WhatsApp EFFIX',
            this.iso(row.created_at),
          );
        } else {
          nextTags = nextTags.filter((tag) => tag !== WELCOME_FAILED_TAG);

          const statusLabel =
            status === 'read'
              ? 'Leído'
              : status === 'delivered'
                ? 'Entregado'
                : 'Aceptado por Meta · pendiente de entrega';

          notes = this.setNoteValue(notes, 'Estado WhatsApp EFFIX', statusLabel);
          notes = this.removeNoteValue(notes, 'Error WhatsApp EFFIX');
          notes = this.setNoteValue(
            notes,
            'Último intento WhatsApp EFFIX',
            this.iso(row.created_at),
          );
        }

        nextTags = Array.from(new Set(nextTags)).slice(0, 20);

        const tagsChanged = JSON.stringify(nextTags) !== JSON.stringify(currentTags);
        const notesChanged = notes !== (typeof contact.notes === 'string' ? contact.notes : '');

        if (!tagsChanged && !notesChanged) continue;

        const { error: updateError } = await client
          .from('contacts')
          .update({
            tags: nextTags,
            notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', contact.id)
          .eq('company_id', company.id);

        if (updateError) {
          console.error(
            `[EFFIX][delivery] No se pudo actualizar contacto ${phone.slice(-4)}:`,
            updateError,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private setNoteValue(notes: string, label: string, value: string): string {
    const lines = notes ? notes.split(/\r?\n/) : [];
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

  private removeNoteValue(notes: string, label: string): string {
    const prefix = `${label.toLowerCase()}:`;
    return notes
      .split(/\r?\n/)
      .filter((line) => !line.trim().toLowerCase().startsWith(prefix))
      .join('\n')
      .trim();
  }

  private iso(value: unknown): string {
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
      return value;
    }
    return new Date().toISOString();
  }
}
