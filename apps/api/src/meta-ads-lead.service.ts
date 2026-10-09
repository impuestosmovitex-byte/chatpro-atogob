import { Injectable } from '@nestjs/common';
import { AgentSessionRuntimeService } from './agent-session-runtime.service';
import { CompanyIntegrationService } from './company-integration.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;
type SocialChannel = 'instagram' | 'messenger';
type LeadChannel = SocialChannel | 'whatsapp';

type AdReferral = {
  source: string;
  type: string;
  ref: string;
  adId: string;
  refererUri: string;
  adTitle: string;
  photoUrl: string;
  videoUrl: string;
  postId: string;
  productId: string;
  flowId: string;
  ctwaClid: string;
  sourceUrl: string;
  sourceType: string;
  headline: string;
  body: string;
};

type ContactUpsertResult = {
  contactId: string;
  status: string;
  contactKey: string;
};

const TARGET_COMPANY_SLUG = 'emprende-con-maogo';
const META_ADS_TAG = 'META-ADS';
const REFERRAL_TTL_MS = 30 * 60 * 1000;

const LEAD_STATUS_TAGS: Record<string, string> = {
  'Lead nuevo': 'LEAD-NUEVO',
  'Respondió': 'LEAD-RESPONDIO',
  'Calificado': 'LEAD-CALIFICADO',
  'Interesado': 'LEAD-INTERESADO',
  'Asesor/Cita': 'LEAD-ASESOR-CITA',
  Venta: 'LEAD-VENTA',
  'No interesado': 'LEAD-NO-INTERESADO',
};

@Injectable()
export class MetaAdsLeadService {
  private targetCompanyId: string | null = null;
  private readonly pendingReferrals = new Map<
    string,
    { referral: AdReferral; receivedAt: number }
  >();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly agentSessionRuntimeService: AgentSessionRuntimeService,
  ) {}

  async processInstagramWebhook(bodyInput: unknown): Promise<void> {
    await this.processSocialWebhook('instagram', bodyInput);
  }

  async processMessengerWebhook(bodyInput: unknown): Promise<void> {
    await this.processSocialWebhook('messenger', bodyInput);
  }

  async processWhatsappWebhook(bodyInput: unknown): Promise<void> {
    const body = this.record(bodyInput);

    if (!Array.isArray(body.entry)) {
      return;
    }

    for (const rawEntry of body.entry) {
      const entry = this.record(rawEntry);

      if (!Array.isArray(entry.changes)) {
        continue;
      }

      for (const rawChange of entry.changes) {
        const change = this.record(rawChange);
        const value = this.record(change.value);
        const metadata = this.record(value.metadata);
        const phoneNumberId = this.text(metadata.phone_number_id);

        if (!phoneNumberId || !Array.isArray(value.messages)) {
          continue;
        }

        const integration =
          await this.companyIntegrationService.findActiveIntegrationByExternalId(
            'meta',
            'whatsapp',
            phoneNumberId,
          );

        if (
          !integration ||
          !(await this.isTargetCompany(integration.companyId))
        ) {
          continue;
        }

        for (const rawMessage of value.messages) {
          const message = this.record(rawMessage);
          const phone = this.digits(message.from);
          const referral = this.readWhatsappAdReferral(message);

          if (!phone || !referral) {
            continue;
          }

          const displayName = this.whatsappDisplayName(value, phone);
          const session =
            await this.conversationMemoryService.getOrCreateSessionByCompanyId(
              integration.companyId,
              phone,
            );

          const lead = await this.upsertMetaAdsContact({
            companyId: integration.companyId,
            channel: 'whatsapp',
            externalCustomerId: phone,
            displayName,
            sessionId: session.id,
            referral,
          });

          const leadContext = this.record(session.context.lead_context);

          await this.conversationMemoryService.updateSession(session.id, {
            stage: 'sales',
            context: {
              ...session.context,
              conversation_category: 'sales',
              lead_source: 'meta_ads',
              lead_source_updated_at: new Date().toISOString(),
              meta_ad: this.referralContext(referral),
              lead_context: {
                ...leadContext,
                source: 'Meta Ads',
                origin: 'WhatsApp Ads',
                channel: 'whatsapp',
                lead_status: lead.status,
                ad_id: referral.adId || null,
                ad_title: referral.adTitle || referral.headline || null,
                social_session_id: null,
              },
            },
          });

          console.log(
            `[ChatPro][MetaAds] lead WhatsApp capturado company=${integration.companyId} phone=${phone} ad=${referral.adId || 'n/a'}`,
          );
        }
      }
    }
  }

  async updateMetaAdsLeadStatus(input: {
    companyId: string;
    contactId: string;
    status: string;
  }): Promise<{ contactId: string; status: string }> {
    const statusTag = LEAD_STATUS_TAGS[input.status];

    if (!statusTag) {
      throw new Error('Estado de lead no válido.');
    }

    const client = this.supabaseService.getClient();
    const { data: contact, error } = await client
      .from('contacts')
      .select('id, company_id, phone, tags, notes, primary_channel')
      .eq('id', input.contactId)
      .eq('company_id', input.companyId)
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudo consultar el lead de Meta Ads: ${error.message}`);
    }

    if (!contact?.id) {
      throw new Error('No existe ese lead de Meta Ads en la empresa activa.');
    }

    const currentTags = this.tags(contact.tags);

    if (!currentTags.includes(META_ADS_TAG)) {
      throw new Error('El contacto indicado no es un lead de Meta Ads.');
    }

    const funnelTags = new Set(Object.values(LEAD_STATUS_TAGS));
    const tags = currentTags.filter((tag) => !funnelTags.has(tag));
    tags.push(statusTag);

    const notes = this.setNoteValue(
      typeof contact.notes === 'string' ? contact.notes : '',
      'Estado lead',
      input.status,
    );

    const { error: updateError } = await client
      .from('contacts')
      .update({
        tags: Array.from(new Set(tags)),
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
      .eq('company_id', input.companyId);

    if (updateError) {
      throw new Error(
        `No se pudo actualizar el estado del lead de Meta Ads: ${updateError.message}`,
      );
    }

    const socialSessionId = this.noteValue(notes, 'Sesión social');

    if (socialSessionId) {
      try {
        const session =
          await this.agentSessionRuntimeService.getSessionById(socialSessionId);
        const leadContext = this.record(session.context.lead_context);

        await this.agentSessionRuntimeService.updateSession(socialSessionId, {
          context: {
            ...session.context,
            lead_status: input.status,
            lead_status_source: 'manual',
            lead_status_updated_at: new Date().toISOString(),
            lead_context: {
              ...leadContext,
              lead_status: input.status,
            },
          },
        });
      } catch (sessionError) {
        console.error(
          `[ChatPro][MetaAds] El contacto se actualizó, pero no se pudo sincronizar la sesión social ${socialSessionId}:`,
          sessionError,
        );
      }
    }

    return { contactId: String(contact.id), status: input.status };
  }

  private async processSocialWebhook(
    channel: SocialChannel,
    bodyInput: unknown,
  ): Promise<void> {
    const body = this.record(bodyInput);

    if (!Array.isArray(body.entry)) {
      return;
    }

    this.cleanupReferralCache();

    for (const rawEntry of body.entry) {
      const entry = this.record(rawEntry);
      const accountId = this.text(entry.id);

      if (!accountId) {
        continue;
      }

      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          channel,
          accountId,
        );

      if (
        !integration ||
        !(await this.isTargetCompany(integration.companyId))
      ) {
        continue;
      }

      const events = this.socialEvents(channel, entry);

      for (const event of events) {
        const sender = this.record(event.sender);
        const recipient = this.record(event.recipient);
        const senderId = this.text(sender.id);
        const recipientId = this.text(recipient.id);

        if (!senderId || senderId === accountId) {
          continue;
        }

        if (recipientId && recipientId !== accountId) {
          continue;
        }

        const key = `${channel}:${accountId}:${senderId}`;
        const directReferral = this.readSocialAdReferral(event);

        if (directReferral) {
          this.pendingReferrals.set(key, {
            referral: directReferral,
            receivedAt: Date.now(),
          });
        }

        if (!this.hasCustomerSocialInteraction(event)) {
          continue;
        }

        const cached = this.pendingReferrals.get(key);
        const referral =
          directReferral ||
          (cached && Date.now() - cached.receivedAt <= REFERRAL_TTL_MS
            ? cached.referral
            : null);

        if (!referral) {
          continue;
        }

        const client = this.supabaseService.getClient();
        const { data: sessionRow, error: sessionError } = await client
          .from('social_conversation_sessions')
          .select(
            'id, display_name, username, profile_picture_url, agent_context, last_message_at',
          )
          .eq('company_id', integration.companyId)
          .eq('channel', channel)
          .eq('external_customer_id', senderId)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sessionError) {
          throw new Error(
            `No se pudo vincular el lead ${channel} con su conversación: ${sessionError.message}`,
          );
        }

        if (!sessionRow?.id) {
          console.warn(
            `[ChatPro][MetaAds] referral detectado pero aún no existe sesión ${channel} sender=${senderId}`,
          );
          continue;
        }

        const displayName =
          this.text(sessionRow.display_name) ||
          (this.text(sessionRow.username)
            ? `@${this.text(sessionRow.username)}`
            : 'Lead de Meta Ads');

        const lead = await this.upsertMetaAdsContact({
          companyId: integration.companyId,
          channel,
          externalCustomerId: senderId,
          displayName,
          sessionId: String(sessionRow.id),
          referral,
        });

        const session =
          await this.agentSessionRuntimeService.getSessionById(
            String(sessionRow.id),
          );
        const leadContext = this.record(session.context.lead_context);
        const origin = channel === 'instagram' ? 'Instagram Ads' : 'Messenger Ads';

        await this.agentSessionRuntimeService.updateSession(session.id, {
          stage: 'sales',
          context: {
            ...session.context,
            conversation_category: 'sales',
            lead_source: 'meta_ads',
            lead_source_updated_at: new Date().toISOString(),
            meta_ad: this.referralContext(referral),
            lead_context: {
              ...leadContext,
              source: 'Meta Ads',
              origin,
              channel,
              lead_status: lead.status,
              ad_id: referral.adId || null,
              ad_title: referral.adTitle || referral.headline || null,
              social_session_id: session.id,
            },
          },
        });

        console.log(
          `[ChatPro][MetaAds] lead ${channel} capturado company=${integration.companyId} sender=${senderId} ad=${referral.adId || 'n/a'}`,
        );
      }
    }
  }

  private socialEvents(channel: SocialChannel, entry: JsonObject): JsonObject[] {
    const events: JsonObject[] = [];

    if (Array.isArray(entry.messaging)) {
      for (const rawEvent of entry.messaging) {
        events.push(this.record(rawEvent));
      }
    }

    if (channel === 'instagram' && Array.isArray(entry.changes)) {
      for (const rawChange of entry.changes) {
        const change = this.record(rawChange);
        const value = this.record(change.value);

        if (Object.keys(value).length) {
          events.push(value);
        }
      }
    }

    return events;
  }

  private hasCustomerSocialInteraction(event: JsonObject): boolean {
    const message = this.record(event.message);

    if (message.is_echo === true) {
      return false;
    }

    if (
      this.text(message.text) ||
      (Array.isArray(message.attachments) && message.attachments.length > 0)
    ) {
      return true;
    }

    return Object.keys(this.record(event.postback)).length > 0;
  }

  private readSocialAdReferral(event: JsonObject): AdReferral | null {
    const message = this.record(event.message);
    const postback = this.record(event.postback);
    const candidates = [
      this.record(event.referral),
      this.record(message.referral),
      this.record(postback.referral),
    ];

    for (const candidate of candidates) {
      const parsed = this.parseSocialReferral(candidate);
      if (parsed) return parsed;
    }

    return null;
  }

  private parseSocialReferral(value: JsonObject): AdReferral | null {
    if (!Object.keys(value).length) {
      return null;
    }

    const adsContext = this.record(value.ads_context_data);
    const source = this.text(value.source);
    const adId = this.text(value.ad_id) || this.text(value.source_id);
    const isAd =
      source.toUpperCase().includes('AD') ||
      Boolean(adId) ||
      Object.keys(adsContext).length > 0;

    if (!isAd) {
      return null;
    }

    return {
      source,
      type: this.text(value.type),
      ref: this.text(value.ref),
      adId,
      refererUri: this.text(value.referer_uri),
      adTitle: this.text(adsContext.ad_title),
      photoUrl: this.text(adsContext.photo_url),
      videoUrl: this.text(adsContext.video_url),
      postId: this.text(adsContext.post_id),
      productId: this.text(adsContext.product_id),
      flowId: this.text(adsContext.flow_id),
      ctwaClid: '',
      sourceUrl: '',
      sourceType: '',
      headline: '',
      body: '',
    };
  }

  private readWhatsappAdReferral(message: JsonObject): AdReferral | null {
    const referral = this.record(message.referral);

    if (!Object.keys(referral).length) {
      return null;
    }

    const sourceType = this.text(referral.source_type);
    const sourceId = this.text(referral.source_id);
    const ctwaClid = this.text(referral.ctwa_clid);
    const isAd =
      sourceType.toLowerCase() === 'ad' ||
      Boolean(sourceId) ||
      Boolean(ctwaClid);

    if (!isAd) {
      return null;
    }

    return {
      source: 'ADS',
      type: 'OPEN_THREAD',
      ref: '',
      adId: sourceId,
      refererUri: '',
      adTitle: this.text(referral.headline),
      photoUrl: this.text(referral.image_url),
      videoUrl: this.text(referral.video_url),
      postId: '',
      productId: '',
      flowId: '',
      ctwaClid,
      sourceUrl: this.text(referral.source_url),
      sourceType,
      headline: this.text(referral.headline),
      body: this.text(referral.body),
    };
  }

  private async upsertMetaAdsContact(input: {
    companyId: string;
    channel: LeadChannel;
    externalCustomerId: string;
    displayName: string;
    sessionId: string;
    referral: AdReferral;
  }): Promise<ContactUpsertResult> {
    const client = this.supabaseService.getClient();
    const contactKey =
      input.channel === 'whatsapp'
        ? this.digits(input.externalCustomerId)
        : `${input.channel}:${input.externalCustomerId}`;

    const { data: existing, error: existingError } = await client
      .from('contacts')
      .select(
        'id, phone, display_name, primary_channel, tags, notes, first_seen_at, last_activity_at',
      )
      .eq('company_id', input.companyId)
      .eq('phone', contactKey)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `No se pudo consultar el lead de Meta Ads: ${existingError.message}`,
      );
    }

    const existingStatus = this.noteValue(
      typeof existing?.notes === 'string' ? existing.notes : '',
      'Estado lead',
    );
    const status =
      existingStatus && existingStatus !== 'Lead nuevo'
        ? existingStatus
        : 'Respondió';

    const funnelTags = new Set(Object.values(LEAD_STATUS_TAGS));
    const tags = this.tags(existing?.tags).filter(
      (tag) => !funnelTags.has(tag),
    );
    tags.push(META_ADS_TAG, LEAD_STATUS_TAGS[status] || 'LEAD-RESPONDIO');

    let notes =
      typeof existing?.notes === 'string' ? existing.notes.trim() : '';

    if (!notes.toUpperCase().includes('LEAD META ADS')) {
      notes = `${notes}${notes ? '\n' : ''}LEAD META ADS`;
    }

    notes = this.setNoteValue(notes, 'Fuente', 'Meta Ads');
    notes = this.setNoteValue(
      notes,
      'Origen',
      input.channel === 'instagram'
        ? 'Instagram Ads'
        : input.channel === 'messenger'
          ? 'Messenger Ads'
          : 'WhatsApp Ads',
    );
    notes = this.setNoteValue(
      notes,
      'Canal',
      input.channel === 'instagram'
        ? 'Instagram'
        : input.channel === 'messenger'
          ? 'Messenger'
          : 'WhatsApp',
    );
    notes = this.setNoteValue(notes, 'Estado lead', status);

    if (input.referral.adId) {
      notes = this.setNoteValue(notes, 'ID anuncio', input.referral.adId);
    }

    const adTitle = input.referral.adTitle || input.referral.headline;
    if (adTitle) {
      notes = this.setNoteValue(notes, 'Título anuncio', adTitle);
    }

    if (input.referral.postId) {
      notes = this.setNoteValue(notes, 'ID publicación', input.referral.postId);
    }

    if (input.referral.ref) {
      notes = this.setNoteValue(notes, 'Referencia Meta', input.referral.ref);
    }

    if (input.referral.ctwaClid) {
      notes = this.setNoteValue(notes, 'CTWA CLID', input.referral.ctwaClid);
    }

    if (input.sessionId) {
      notes = this.setNoteValue(notes, 'Sesión social', input.sessionId);
    }

    notes = this.setNoteValue(
      notes,
      'Última interacción Meta Ads',
      new Date().toISOString(),
    );

    const now = new Date().toISOString();
    const payload = {
      company_id: input.companyId,
      phone: contactKey,
      display_name:
        input.displayName.trim() || existing?.display_name || 'Lead de Meta Ads',
      primary_channel: input.channel,
      tags: Array.from(new Set(tags)).slice(0, 15),
      notes,
      first_seen_at: existing?.first_seen_at || now,
      last_activity_at: now,
      updated_at: now,
    };

    const result = existing?.id
      ? await client
          .from('contacts')
          .update(payload)
          .eq('id', existing.id)
          .eq('company_id', input.companyId)
          .select('id')
          .single()
      : await client.from('contacts').insert(payload).select('id').single();

    if (result.error || !result.data?.id) {
      throw new Error(
        `No se pudo guardar el lead de Meta Ads: ${result.error?.message || 'respuesta vacía'}`,
      );
    }

    return {
      contactId: String(result.data.id),
      status,
      contactKey,
    };
  }

  private referralContext(referral: AdReferral): JsonObject {
    return {
      source: referral.source || null,
      type: referral.type || null,
      ref: referral.ref || null,
      ad_id: referral.adId || null,
      ad_title: referral.adTitle || referral.headline || null,
      post_id: referral.postId || null,
      product_id: referral.productId || null,
      flow_id: referral.flowId || null,
      ctwa_clid: referral.ctwaClid || null,
      source_url: referral.sourceUrl || null,
      source_type: referral.sourceType || null,
      headline: referral.headline || null,
      body: referral.body || null,
      captured_at: new Date().toISOString(),
    };
  }

  private async isTargetCompany(companyId: string): Promise<boolean> {
    if (this.targetCompanyId) {
      return companyId === this.targetCompanyId;
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('companies')
      .select('id')
      .eq('slug', TARGET_COMPANY_SLUG)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo validar la empresa de Meta Ads: ${error.message}`,
      );
    }

    this.targetCompanyId = typeof data?.id === 'string' ? data.id : null;
    return Boolean(this.targetCompanyId && companyId === this.targetCompanyId);
  }

  private whatsappDisplayName(value: JsonObject, phone: string): string {
    if (!Array.isArray(value.contacts)) {
      return '';
    }

    for (const rawContact of value.contacts) {
      const contact = this.record(rawContact);
      if (this.digits(contact.wa_id) !== phone) continue;
      const profile = this.record(contact.profile);
      const name = this.text(profile.name);
      if (name) return name;
    }

    return '';
  }

  private cleanupReferralCache(): void {
    const now = Date.now();

    for (const [key, value] of this.pendingReferrals.entries()) {
      if (now - value.receivedAt > REFERRAL_TTL_MS) {
        this.pendingReferrals.delete(key);
      }
    }

    if (this.pendingReferrals.size <= 1000) {
      return;
    }

    const oldest = [...this.pendingReferrals.entries()]
      .sort((left, right) => left[1].receivedAt - right[1].receivedAt)
      .slice(0, this.pendingReferrals.size - 1000);

    for (const [key] of oldest) {
      this.pendingReferrals.delete(key);
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

  private noteValue(notes: string, label: string): string {
    const prefix = `${label.toLowerCase()}:`;
    const line = notes
      .split(/\r?\n/)
      .find((item) => item.trim().toLowerCase().startsWith(prefix));

    if (!line) return '';
    return line.slice(line.indexOf(':') + 1).trim();
  }

  private tags(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private record(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }

  private text(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
  }

  private digits(value: unknown): string {
    return this.text(value).replace(/\D/g, '');
  }
}
