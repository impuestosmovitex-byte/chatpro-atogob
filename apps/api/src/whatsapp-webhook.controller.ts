import OpenAI, { toFile } from 'openai';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatAgentService } from './chat-agent.service';
import { AutomationRuntimeService } from './automation-runtime.service';
import { CartRecoveryContextService } from './cart-recovery-context.service';
import { CustomerOrderService } from './customer-order.service';
import { CompanyIntegrationService } from './company-integration.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import { WhatsappTemplateExecutionService } from './whatsapp-template-execution.service';
import {
  ConversationMemoryService,
  type CompanyProfile,
  type ConversationSession,
} from './conversation-memory.service';

@Controller('webhook/whatsapp')
export class WhatsappWebhookController {
  private readonly conversationQueues = new Map<string, Promise<void>>();
  private readonly recentProductUrlMessages = new Map<string, number>();
  private readonly latestInboundMessages = new Map<
    string,
    {
      messageId: string | null;
      receivedAt: number;
      burstId: string;
    }
  >();

  constructor(
    private readonly chatAgentService: ChatAgentService,
    private readonly automationRuntimeService: AutomationRuntimeService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly companyIntegrationService: CompanyIntegrationService,
    private readonly whatsappMessagingService: WhatsappMessagingService,
    private readonly whatsappTemplateExecutionService: WhatsappTemplateExecutionService,
    private readonly cartRecoveryContextService: CartRecoveryContextService,
    private readonly customerOrderService: CustomerOrderService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() response: Response,
  ) {
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return response.status(200).send(challenge);
    }

    return response.sendStatus(403);
  }

  @Post()
  @HttpCode(200)
  async receiveMessage(@Body() body: unknown) {
    const statuses = this.getDeliveryStatuses(body);

    for (const status of statuses) {
      try {
        const conversationUpdated =
          await this.conversationMemoryService.applyProviderMessageStatus({
            messageId: status.messageId,
            status: status.status,
            error: status.error,
          });

        const automationUpdated =
          await this.automationRuntimeService.applyProviderStatus(status);

        if (conversationUpdated || automationUpdated) {
          console.log(
            `Meta confirmó ${status.status} para ${status.messageId}${
              status.error ? `: ${status.error}` : ''
            }.`,
          );
        }
      } catch (error) {
        console.error(
          `No se pudo aplicar el estado ${status.status} de Meta:`,
          error,
        );
      }
    }

    const message = this.getIncomingMessage(body);

    if (!message) {
      return 'EVENT_RECEIVED';
    }

    const phone =
      typeof message.from === 'string' ? message.from.trim() : '';
    const incomingMessageId = this.getIncomingMessageId(message);
    const replyToProviderMessageId =
      this.getReplyToProviderMessageId(message);

    if (!phone) {
      return 'EVENT_RECEIVED';
    }

    try {
      const incomingPhoneNumberId = this.getIncomingPhoneNumberId(body);
      const conversationKey = `${incomingPhoneNumberId}:${phone}`;

      if (message.type === 'audio') {
        const mediaId =
          typeof message.audio?.id === 'string'
            ? message.audio.id.trim()
            : '';
        const mimeType =
          typeof message.audio?.mime_type === 'string'
            ? message.audio.mime_type.trim()
            : 'audio/ogg';

        if (!mediaId) {
          return 'EVENT_RECEIVED';
        }

        this.markInboundActivity(conversationKey, incomingMessageId);

        this.enqueueConversation(conversationKey, () =>
          this.processIncomingAudio({
            incomingPhoneNumberId,
            phone,
            incomingMessageId,
            replyToProviderMessageId,
            mediaId,
            mimeType,
            voice: message.audio?.voice === true,
          }),
        );

        return 'EVENT_RECEIVED';
      }

      if (message.type === 'image') {
        const mediaId =
          typeof message.image?.id === 'string'
            ? message.image.id.trim()
            : '';
        const mimeType =
          typeof message.image?.mime_type === 'string'
            ? message.image.mime_type.trim()
            : 'image/jpeg';
        const caption =
          typeof message.image?.caption === 'string'
            ? message.image.caption.replace(/\s+/g, ' ').trim().slice(0, 1500)
            : '';

        if (!mediaId) {
          return 'EVENT_RECEIVED';
        }

        const burstId =
          this.markInboundActivity(conversationKey, incomingMessageId);

        this.enqueueConversation(conversationKey, () =>
          this.processIncomingImage({
            incomingPhoneNumberId,
            phone,
            incomingMessageId,
            replyToProviderMessageId,
            mediaId,
            mimeType,
            caption,
            burstId,
          }),
        );

        return 'EVENT_RECEIVED';
      }

      if (message.type === 'location') {
        const latitude = Number(message.location?.latitude);
        const longitude = Number(message.location?.longitude);
        const name =
          typeof message.location?.name === 'string'
            ? message.location.name.replace(/\s+/g, ' ').trim().slice(0, 300)
            : '';
        const address =
          typeof message.location?.address === 'string'
            ? message.location.address.replace(/\s+/g, ' ').trim().slice(0, 600)
            : '';

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          return 'EVENT_RECEIVED';
        }

        this.markInboundActivity(conversationKey, incomingMessageId);

        this.enqueueConversation(conversationKey, () =>
          this.processIncomingLocation({
            incomingPhoneNumberId,
            phone,
            incomingMessageId,
            replyToProviderMessageId,
            latitude,
            longitude,
            name,
            address,
          }),
        );

        return 'EVENT_RECEIVED';
      }

      if (message.type === 'video' || message.type === 'document') {
        const mediaBlock =
          message.type === 'video'
            ? message.video
            : message.document;

        const mediaId =
          typeof mediaBlock?.id === 'string'
            ? mediaBlock.id.trim()
            : '';

        const mimeType =
          typeof mediaBlock?.mime_type === 'string'
            ? mediaBlock.mime_type.trim()
            : message.type === 'video'
              ? 'video/mp4'
              : 'application/octet-stream';

        const caption =
          typeof mediaBlock?.caption === 'string'
            ? mediaBlock.caption
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1500)
            : '';

        const filename =
          message.type === 'document' &&
          typeof message.document?.filename === 'string'
            ? message.document.filename.trim().slice(0, 180)
            : message.type === 'video'
              ? 'video'
              : 'archivo';

        if (!mediaId) {
          return 'EVENT_RECEIVED';
        }

        this.markInboundActivity(conversationKey, incomingMessageId);

        this.enqueueConversation(conversationKey, () =>
          this.processIncomingAttachment({
            incomingPhoneNumberId,
            phone,
            incomingMessageId,
            replyToProviderMessageId,
            mediaId,
            mimeType,
            caption,
            filename,
            messageType: message.type,
          }),
        );

        return 'EVENT_RECEIVED';
      }

      const buttonText = this.getIncomingButtonText(message);
      const text =
        message.type === 'text'
          ? message.text?.body?.trim() ?? ''
          : buttonText;

      if (!text) {
        return 'EVENT_RECEIVED';
      }

      const suppressReply = this.isRedundantProductReference(
        conversationKey,
        text,
      );

      if (this.isProductUrlMessage(text)) {
        this.recentProductUrlMessages.set(conversationKey, Date.now());
      }

      if (!suppressReply) {
        this.markInboundActivity(conversationKey, incomingMessageId);
      }

      this.enqueueConversation(conversationKey, () =>
        this.processIncomingText({
          incomingPhoneNumberId,
          phone,
          text,
          incomingMessageId,
          replyToProviderMessageId,
          suppressReply,
          templateButton: Boolean(buttonText),
        }),
      );
    } catch (error) {
      console.error('No se pudo preparar el mensaje entrante:', error);
    }

    return 'EVENT_RECEIVED';
  }

  private enqueueConversation(
    conversationKey: string,
    task: () => Promise<void>,
  ): void {
    const previous =
      this.conversationQueues.get(conversationKey) ?? Promise.resolve();

    const next = previous
      .catch((error) => {
        console.error(
          `Falló una tarea anterior de la conversación ${conversationKey}:`,
          error,
        );
      })
      .then(() => task());

    this.conversationQueues.set(conversationKey, next);

    void next
      .catch((error) => {
        console.error(
          `Falló una tarea de la conversación ${conversationKey}:`,
          error,
        );
      })
      .finally(() => {
        if (this.conversationQueues.get(conversationKey) === next) {
          this.conversationQueues.delete(conversationKey);
          this.latestInboundMessages.delete(conversationKey);
        }
      });
  }

  private isProductUrlMessage(text: string): boolean {
    return /https?:\/\/\S+\/products\//i.test(text);
  }

  private isRedundantProductReference(
    conversationKey: string,
    text: string,
  ): boolean {
    const lastUrlAt = this.recentProductUrlMessages.get(conversationKey);

    if (!lastUrlAt) {
      return false;
    }

    if (Date.now() - lastUrlAt > 10_000) {
      this.recentProductUrlMessages.delete(conversationKey);
      return false;
    }

    const normalized = text
      .toLowerCase()
      .trim()
      .replace(/[¡!¿?.,]/g, '');

    const redundantReferences = [
      'esta',
      'este',
      'esa',
      'ese',
      'la de arriba',
      'el de arriba',
    ];

    if (!redundantReferences.includes(normalized)) {
      return false;
    }

    this.recentProductUrlMessages.delete(conversationKey);
    return true;
  }

  private async processIncomingLocation(input: {
    incomingPhoneNumberId: string;
    phone: string;
    incomingMessageId: string | null;
    replyToProviderMessageId: string | null;
    latitude: number;
    longitude: number;
    name: string;
    address: string;
  }): Promise<void> {
    const integration =
      await this.companyIntegrationService.findActiveIntegrationByExternalId(
        'meta',
        'whatsapp',
        input.incomingPhoneNumberId,
      );

    if (!integration) {
      throw new Error(
        'No existe una empresa activa para la ubicación entrante.',
      );
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfileById(
        integration.companyId,
      );

    let session =
      await this.conversationMemoryService.getOrCreateSessionByCompanyId(
        integration.companyId,
        input.phone,
      );

    session =
      await this.chatAgentService.prepareSessionForIncomingActivity(
        profile,
        session,
      );

    const details = [
      input.name ? `Nombre: ${input.name}` : '',
      input.address ? `Dirección: ${input.address}` : '',
      `Coordenadas: ${input.latitude}, ${input.longitude}`,
    ]
      .filter(Boolean)
      .join('. ');

    const customerMessage = `📍 Ubicación recibida. ${details}`;

    const saved = await this.conversationMemoryService.saveMessage({
      companyId: profile.id,
      sessionId: session.id,
      customerPhone: input.phone,
      message: customerMessage,
      sender: 'customer',
      authorType: 'customer',
      providerMessageId: input.incomingMessageId,
      replyToProviderMessageId: input.replyToProviderMessageId,
      messageType: 'location',
      messageMetadata: {
        latitude: input.latitude,
        longitude: input.longitude,
        name: input.name || null,
        address: input.address || null,
      },
    });

    if (saved === 'duplicate') {
      return;
    }

    await this.conversationMemoryService.touchSession(session.id);

    if (
      session.attentionStatus === 'waiting' ||
      session.attentionStatus === 'human'
    ) {
      console.log(
        `Ubicación guardada para atención humana de ${input.phone}`,
      );
      return;
    }

    if (session.attentionStatus === 'closed') {
      session =
        await this.conversationMemoryService.resumeAiConversation(
          session.id,
        );
    }

    const conversationKey =
      `${input.incomingPhoneNumberId}:${input.phone}`;

    const isLatestInboundMessage =
      await this.waitForInboundQuietWindow(
        conversationKey,
        input.incomingMessageId,
      );

    if (!isLatestInboundMessage) {
      console.log(
        `Respuesta de ubicación omitida porque llegó un mensaje más reciente de ${input.phone}`,
      );
      return;
    }

    session = await this.attachRecoveryContext(
      session,
      profile.id,
      input.phone,
    );

    const reply = await this.resolveReply(
      profile,
      session,
      customerMessage,
    );

    if (
      !this.isCurrentInboundMessage(
        conversationKey,
        input.incomingMessageId,
      )
    ) {
      console.log(
        `Respuesta de ubicación cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
      );
      return;
    }

    await this.whatsappMessagingService.sendText(
      profile.id,
      input.phone,
      reply,
    );

    await this.conversationMemoryService.saveMessage({
      companyId: profile.id,
      sessionId: session.id,
      customerPhone: input.phone,
      message: reply,
      sender: 'assistant',
      authorType: 'ai',
      aiResponse: reply,
    });

    await this.conversationMemoryService.touchSession(session.id);
    console.log(`Ubicación comprendida y respondida a ${input.phone}`);
  }

  private async processIncomingAttachment(input: {
    incomingPhoneNumberId: string;
    phone: string;
    incomingMessageId: string | null;
    replyToProviderMessageId: string | null;
    mediaId: string;
    mimeType: string;
    caption: string;
    filename: string;
    messageType: 'video' | 'document';
  }): Promise<void> {
    const integration =
      await this.companyIntegrationService.findActiveIntegrationByExternalId(
        'meta',
        'whatsapp',
        input.incomingPhoneNumberId,
      );

    if (!integration) {
      throw new Error(
        'No existe una empresa activa para el archivo entrante.',
      );
    }

    const profile =
      await this.conversationMemoryService.getCompanyProfileById(
        integration.companyId,
      );

    let session =
      await this.conversationMemoryService.getOrCreateSessionByCompanyId(
        integration.companyId,
        input.phone,
      );

    session =
      await this.chatAgentService.prepareSessionForIncomingActivity(
        profile,
        session,
      );

    const icon = input.messageType === 'video' ? '🎥' : '📎';

    const customerMessage = input.caption
      ? `${icon} ${
          input.messageType === 'video' ? 'Video' : 'Documento'
        } recibido: ${input.caption}`
      : `${icon} ${
          input.messageType === 'video' ? 'Video' : 'Documento'
        } recibido${input.messageType === 'document' && input.filename
          ? `: ${input.filename}`
          : '.'}`;

    const saved = await this.conversationMemoryService.saveMessage({
      companyId: profile.id,
      sessionId: session.id,
      customerPhone: input.phone,
      message: customerMessage,
      sender: 'customer',
      authorType: 'customer',
      providerMessageId: input.incomingMessageId,
      replyToProviderMessageId: input.replyToProviderMessageId,
      messageType: input.messageType,
      mediaId: input.mediaId,
      mediaMimeType: input.mimeType,
      mediaFilename: input.filename,
      mediaVoice: false,
    });

    if (saved === 'duplicate') {
      return;
    }

    await this.conversationMemoryService.touchSession(session.id);

    const media =
      await this.whatsappMessagingService.downloadRawMedia(
        profile.id,
        input.mediaId,
        input.mimeType || 'application/octet-stream',
      );

    await this.conversationMemoryService.persistIncomingMedia({
      companyId: profile.id,
      sessionId: session.id,
      mediaId: input.mediaId,
      providerMessageId: input.incomingMessageId,
      buffer: media.buffer,
      mimeType: media.mimeType,
      filename: input.filename || media.filename,
    });

    console.log(
      `${input.messageType === 'video' ? 'Video' : 'Documento'} guardado de ${input.phone}`,
    );

    if (
      session.attentionStatus === 'waiting' ||
      session.attentionStatus === 'human'
    ) {
      console.log(
        `${input.messageType === 'video' ? 'Video' : 'Documento'} guardado para atención humana de ${input.phone}`,
      );
      return;
    }

    if (session.attentionStatus === 'closed') {
      session =
        await this.conversationMemoryService.resumeAiConversation(
          session.id,
        );
    }

    const conversationKey =
      `${input.incomingPhoneNumberId}:${input.phone}`;

    const isLatestInboundMessage =
      await this.waitForInboundQuietWindow(
        conversationKey,
        input.incomingMessageId,
      );

    if (!isLatestInboundMessage) {
      console.log(
        `Respuesta de ${input.messageType} omitida porque llegó un mensaje más reciente de ${input.phone}`,
      );
      return;
    }

    session = await this.attachRecoveryContext(
      session,
      profile.id,
      input.phone,
    );

    const reply = await this.resolveReply(
      profile,
      session,
      customerMessage,
    );

    if (
      !this.isCurrentInboundMessage(
        conversationKey,
        input.incomingMessageId,
      )
    ) {
      console.log(
        `Respuesta de ${input.messageType} cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
      );
      return;
    }

    await this.whatsappMessagingService.sendText(
      profile.id,
      input.phone,
      reply,
    );

    await this.conversationMemoryService.saveMessage({
      companyId: profile.id,
      sessionId: session.id,
      customerPhone: input.phone,
      message: reply,
      sender: 'assistant',
      authorType: 'ai',
      aiResponse: reply,
    });

    await this.conversationMemoryService.touchSession(session.id);

    console.log(
      `${input.messageType === 'video' ? 'Video' : 'Documento'} comprendido en contexto y respondido a ${input.phone}`,
    );
  }

  private markInboundActivity(
    conversationKey: string,
    messageId: string | null,
  ): string {
    const current = this.latestInboundMessages.get(conversationKey);

    if (messageId && current?.messageId === messageId) {
      return current.burstId;
    }

    const now = Date.now();
    const continuesCurrentBurst =
      Boolean(current) &&
      now - current!.receivedAt <= 10_000;

    const burstId =
      continuesCurrentBurst && current
        ? current.burstId
        : messageId ||
          `${now}-${Math.random().toString(36).slice(2, 10)}`;

    this.latestInboundMessages.set(conversationKey, {
      messageId,
      receivedAt: now,
      burstId,
    });

    return burstId;
  }

  private isCurrentInboundMessage(
    conversationKey: string,
    messageId: string | null,
  ): boolean {
    const latest = this.latestInboundMessages.get(conversationKey);

    if (!latest) {
      return true;
    }

    if (!messageId || !latest.messageId) {
      return true;
    }

    return latest.messageId === messageId;
  }

  private async waitForInboundQuietWindow(
    conversationKey: string,
    messageId: string | null,
    waitMs = 10_000,
  ): Promise<boolean> {
    const latest = this.latestInboundMessages.get(conversationKey);

    if (
      latest &&
      messageId &&
      latest.messageId &&
      latest.messageId !== messageId
    ) {
      return false;
    }

    const remainingMs = latest
      ? Math.max(0, waitMs - (Date.now() - latest.receivedAt))
      : waitMs;

    if (remainingMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, remainingMs);
      });
    }

    return this.isCurrentInboundMessage(conversationKey, messageId);
  }

  private async processIncomingImage(input: {
    incomingPhoneNumberId: string;
    phone: string;
    incomingMessageId: string | null;
    replyToProviderMessageId: string | null;
    mediaId: string;
    mimeType: string;
    caption: string;
    burstId: string;
  }): Promise<void> {
    let profile: CompanyProfile | null = null;
    let session: ConversationSession | null = null;
    let replySent = false;

    try {
      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'whatsapp',
          input.incomingPhoneNumberId,
        );

      if (!integration) {
        throw new Error(
          'No existe una empresa activa para la imagen entrante.',
        );
      }

      profile =
        await this.conversationMemoryService.getCompanyProfileById(
          integration.companyId,
        );
      session =
        await this.conversationMemoryService.getOrCreateSessionByCompanyId(
          integration.companyId,
          input.phone,
        );
      session =
        await this.chatAgentService.prepareSessionForIncomingActivity(
          profile,
          session,
        );

      const customerMessage = input.caption
        ? `📷 Imagen recibida: ${input.caption}`
        : '📷 Imagen recibida.';

      const saved = await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: customerMessage,
        sender: 'customer',
        authorType: 'customer',
        providerMessageId: input.incomingMessageId,
        replyToProviderMessageId:
          input.replyToProviderMessageId,
        messageType: 'image',
        mediaId: input.mediaId,
        mediaMimeType: input.mimeType,
        mediaFilename: 'imagen',
      });

      if (saved === 'duplicate') {
        return;
      }

      await this.conversationMemoryService.touchSession(session.id);

      const media = await this.whatsappMessagingService.downloadRawMedia(
        profile.id,
        input.mediaId,
        input.mimeType || 'image/jpeg',
      );

      await this.conversationMemoryService.persistIncomingMedia({
        companyId: profile.id,
        sessionId: session.id,
        mediaId: input.mediaId,
        providerMessageId: input.incomingMessageId,
        buffer: media.buffer,
        mimeType: media.mimeType,
        filename: 'imagen',
      });

      if (
        session.attentionStatus === 'waiting' ||
        session.attentionStatus === 'human'
      ) {
        console.log(
          `Imagen guardada para atención humana de ${input.phone}`,
        );
        return;
      }

      if (session.attentionStatus === 'closed') {
        session =
          await this.conversationMemoryService.resumeAiConversation(
            session.id,
          );
      }


      session = await this.attachRecoveryContext(
        session,
        profile.id,
        input.phone,
      );

      const sessionContext =
        session.context &&
        typeof session.context === 'object' &&
        !Array.isArray(session.context)
          ? session.context as Record<string, unknown>
          : {};

      const storedCategory =
        typeof sessionContext.conversation_category === 'string'
          ? sessionContext.conversation_category
          : '';

      const serviceFlow =
        sessionContext.customer_service_flow &&
        typeof sessionContext.customer_service_flow === 'object' &&
        !Array.isArray(sessionContext.customer_service_flow)
          ? sessionContext.customer_service_flow as Record<string, unknown>
          : null;

      const serviceFlowType =
        typeof serviceFlow?.type === 'string'
          ? serviceFlow.type
          : '';

      const serviceAreaValue =
        sessionContext.service_area &&
        typeof sessionContext.service_area === 'object' &&
        !Array.isArray(sessionContext.service_area)
          ? sessionContext.service_area as Record<string, unknown>
          : null;

      const serviceAreaName =
        typeof serviceAreaValue?.name === 'string'
          ? serviceAreaValue.name
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
          : '';

      const serviceAreaType =
        serviceAreaValue?.areaType === 'sales' ||
        serviceAreaValue?.areaType === 'service'
          ? serviceAreaValue.areaType
          : null;

      const legacyServiceAreaByName =
        serviceAreaType === null &&
        (
          serviceAreaName.includes('servicio') ||
          serviceAreaName.includes('soporte') ||
          serviceAreaName.includes('postventa') ||
          serviceAreaName.includes('pedido') ||
          serviceAreaName.includes('garantia')
        );

      const isServiceContext =
        storedCategory === 'service' ||
        serviceFlowType === 'order_lookup' ||
        serviceAreaType === 'service' ||
        legacyServiceAreaByName;

      if (isServiceContext) {
        const activeAreas =
          await this.conversationMemoryService.listActiveServiceAreas(
            profile.id,
          );

        const configuredServiceAreas = activeAreas.filter(
          (area) => area.areaType === 'service',
        );

        let configuredServiceArea =
          configuredServiceAreas.length === 1
            ? configuredServiceAreas[0]
            : null;

        if (
          !configuredServiceArea &&
          configuredServiceAreas.length === 0
        ) {
          const normalizeAreaName = (value: string) =>
            value
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '');

          const legacyServiceAreas = activeAreas.filter((area) => {
            if (area.areaType !== null) {
              return false;
            }

            const name = normalizeAreaName(area.name);

            return (
              name.includes('servicio') ||
              name.includes('soporte') ||
              name.includes('postventa') ||
              name.includes('pedido') ||
              name.includes('garantia')
            );
          });

          configuredServiceArea =
            legacyServiceAreas.length === 1
              ? legacyServiceAreas[0]
              : null;
        }

        const currentSession =
          await this.conversationMemoryService.getSessionById(
            session.id,
          );

        const nextContext: Record<string, unknown> = {
          ...currentSession.context,
          conversation_category: 'service',
          conversation_category_updated_at:
            new Date().toISOString(),
          last_service_evidence: {
            type: 'image',
            caption: input.caption || null,
            media_id: input.mediaId,
            received_at: new Date().toISOString(),
          },
          ...(configuredServiceArea
            ? {
                service_area: {
                  id: configuredServiceArea.id,
                  name: configuredServiceArea.name,
                  areaType: configuredServiceArea.areaType,
                },
              }
            : {}),
        };

        delete nextContext.last_visual_reference;
        delete nextContext.visual_reference_burst;
        delete nextContext.commercial_visual_references;

        session =
          await this.conversationMemoryService.updateSession(
            currentSession.id,
            {
              context: nextContext,
            },
          );

        const serviceEvidenceMessage = [
          '[EVIDENCIA_SERVICIO]',
          'El cliente envió una imagen dentro de una consulta, inconformidad o gestión de servicio al cliente.',
          input.caption
            ? `Texto enviado junto con la imagen: ${input.caption}`
            : 'La imagen fue enviada sin texto adicional.',
          'La imagen ya fue guardada y estará disponible para el asesor.',
          'No busques la imagen en el catálogo.',
          'No selecciones productos.',
          'No hables de precios, colores, tallas, disponibilidad, carrito ni checkout.',
          'No conviertas esta conversación en una venta.',
          'Interpreta la imagen únicamente como evidencia del caso actual.',
          'Responde según el historial de servicio y solicita solo el dato que realmente falte.',
          'Si el caso requiere una decisión humana, transfiérelo sin prometer ninguna solución.',
        ].join('\n');

        const canReplyToServiceImage =
          await this.waitForInboundQuietWindow(
            `${input.incomingPhoneNumberId}:${input.phone}`,
            input.incomingMessageId,
          );

        if (!canReplyToServiceImage) {
          console.log(
            `Respuesta de imagen de servicio omitida porque llegó un mensaje más reciente de ${input.phone}`,
          );
          return;
        }

        const serviceReply = await this.resolveReply(
          profile,
          session,
          serviceEvidenceMessage,
        );

        if (
          !this.isCurrentInboundMessage(
            `${input.incomingPhoneNumberId}:${input.phone}`,
            input.incomingMessageId,
          )
        ) {
          console.log(
            `Respuesta de imagen de servicio cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
          );
          return;
        }

        await this.whatsappMessagingService.sendText(
          profile.id,
          input.phone,
          serviceReply,
        );

        replySent = true;

        await this.conversationMemoryService.saveMessage({
          companyId: profile.id,
          sessionId: session.id,
          customerPhone: input.phone,
          message: serviceReply,
          sender: 'assistant',
          authorType: 'ai',
          aiResponse: serviceReply,
        });

        await this.conversationMemoryService.touchSession(
          session.id,
        );

        console.log(
          `Imagen conservada como evidencia de servicio para ${input.phone}`,
        );

        return;
      }

      const multimodalIntent =
        await this.classifyIncomingImageIntent({
          buffer: media.buffer,
          mimeType: media.mimeType,
          caption: input.caption,
          profile,
          session,
        });

      console.log(
        `[ChatPro][multimodal-intent] phone=${input.phone} ` +
          `type=${multimodalIntent.imageType} ` +
          `payment=${multimodalIntent.hasPaymentIntent} ` +
          `product=${multimodalIntent.hasProductIntent} ` +
          `confidence=${multimodalIntent.confidence}`,
      );

      if (
        multimodalIntent.hasPaymentIntent &&
        (multimodalIntent.primaryIntent === 'validate_payment' ||
          multimodalIntent.imageType === 'payment_proof' ||
          multimodalIntent.imageType === 'mixed')
      ) {
        await this.continueIncomingPaymentProof({
          profile,
          session,
          phone: input.phone,
          caption: input.caption,
          incomingPhoneNumberId: input.incomingPhoneNumberId,
          incomingMessageId: input.incomingMessageId,
          intent: multimodalIntent,
        });
        replySent = true;
        return;
      }

      if (
        multimodalIntent.imageType !== 'product' &&
        multimodalIntent.imageType !== 'mixed'
      ) {
        const contextualImageMessage = [
          '[IMAGEN_NO_PRODUCTO]',
          input.caption
            ? `Texto del cliente: ${input.caption}`
            : 'La imagen llegó sin texto adjunto.',
          `Tipo interpretado: ${multimodalIntent.imageType}.`,
          `Intención principal: ${multimodalIntent.primaryIntent}.`,
          `Motivo: ${multimodalIntent.reason}.`,
          'Responde usando el historial reciente y las reglas de la empresa.',
          'No busques esta imagen en el catálogo ni la trates como producto.',
          multimodalIntent.imageType === 'ambiguous'
            ? 'Si falta información, formula una sola pregunta breve para aclarar qué necesita.'
            : '',
        ]
          .filter(Boolean)
          .join('\n');

        const canReplyToContextualImage =
          await this.waitForInboundQuietWindow(
            `${input.incomingPhoneNumberId}:${input.phone}`,
            input.incomingMessageId,
          );

        if (!canReplyToContextualImage) {
          console.log(
            `Respuesta de imagen contextual omitida porque llegó un mensaje más reciente de ${input.phone}`,
          );
          return;
        }

        const contextualReply = await this.resolveReply(
          profile,
          session,
          contextualImageMessage,
        );

        if (
          !this.isCurrentInboundMessage(
            `${input.incomingPhoneNumberId}:${input.phone}`,
            input.incomingMessageId,
          )
        ) {
          console.log(
            `Respuesta de imagen contextual cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
          );
          return;
        }

        await this.whatsappMessagingService.sendText(
          profile.id,
          input.phone,
          contextualReply,
        );
        replySent = true;

        await this.conversationMemoryService.saveMessage({
          companyId: profile.id,
          sessionId: session.id,
          customerPhone: input.phone,
          message: contextualReply,
          sender: 'assistant',
          authorType: 'ai',
          aiResponse: contextualReply,
        });

        await this.conversationMemoryService.touchSession(session.id);
        return;
      }

      const analysis = await this.analyzeIncomingImage({
        buffer: media.buffer,
        mimeType: media.mimeType,
        caption: input.caption,
        companyName: profile.name,
        companyInstructions: profile.aiInstructions,
      });

      const visualMimeType =
        media.mimeType.split(';')[0].trim().toLowerCase() ||
        'image/jpeg';
      const visualMatch =
        await this.chatAgentService.matchIncomingVisualReference(
          profile,
          session,
          {
            imageDataUrl:
              `data:${visualMimeType};base64,` +
              media.buffer.toString('base64'),
            summary: analysis.summary,
            productName: analysis.productName,
            reference: analysis.reference,
            visiblePrice: analysis.visiblePrice,
            visibleText: analysis.visibleText,
            category: analysis.category,
            colors: analysis.colors,
            searchTerms: analysis.searchTerms,
          },
        );

      const currentSession =
        await this.conversationMemoryService.getSessionById(session.id);
      const receivedAt = new Date().toISOString();
      const nextVisualContext: Record<string, unknown> = {
        ...currentSession.context,
      };

      if (visualMatch.matchType !== 'exact') {
        delete nextVisualContext.selectedProduct;
        delete nextVisualContext.selectedVariant;
        delete nextVisualContext.selectedVariants;
        delete nextVisualContext.selectedAt;
        delete nextVisualContext.selectedVariantAt;
        delete nextVisualContext.purchaseIntent;
        delete nextVisualContext.purchaseIntentAt;
      }

      const visualReference = {
        summary: analysis.summary,
        category: analysis.category,
        product_name: analysis.productName || null,
        reference: analysis.reference || null,
        visible_price: analysis.visiblePrice || null,
        colors: analysis.colors,
        visible_text: analysis.visibleText,
        search_terms: analysis.searchTerms,
        source_hint: analysis.sourceHint,
        confidence: analysis.confidence,
        match_type: visualMatch.matchType,
        match_confidence: visualMatch.confidence,
        matched_product: visualMatch.matchedProduct
          ? {
              title: visualMatch.matchedProduct.title,
              url: visualMatch.matchedProduct.url,
              price_from_cop:
                visualMatch.matchedProduct.priceFromCop || null,
            }
          : null,
        candidates: visualMatch.candidates.slice(0, 3).map((candidate) => ({
          title: candidate.title,
          url: candidate.url,
          price_from_cop: candidate.priceFromCop || null,
        })),
        caption: input.caption || null,
        received_at: receivedAt,
      };

      nextVisualContext.last_visual_reference = visualReference;

      const existingCommercialVisualReferences =
        Array.isArray(currentSession.context.commercial_visual_references)
          ? currentSession.context.commercial_visual_references.filter(
              (item) =>
                Boolean(item) &&
                typeof item === 'object' &&
                !Array.isArray(item),
            )
          : [];

      nextVisualContext.commercial_visual_references = [
        ...existingCommercialVisualReferences,
        visualReference,
      ].slice(-20);

      const currentVisualBurst =
        currentSession.context.visual_reference_burst &&
        typeof currentSession.context.visual_reference_burst === 'object' &&
        !Array.isArray(currentSession.context.visual_reference_burst)
          ? currentSession.context.visual_reference_burst as Record<string, unknown>
          : null;

      const currentBurstReferences =
        currentVisualBurst?.burst_id === input.burstId &&
        Array.isArray(currentVisualBurst.references)
          ? currentVisualBurst.references.filter(
              (item) =>
                Boolean(item) &&
                typeof item === 'object' &&
                !Array.isArray(item),
            )
          : [];

      const visualBurstReferences = [
        ...currentBurstReferences,
        visualReference,
      ].slice(-10);

      nextVisualContext.visual_reference_burst = {
        burst_id: input.burstId,
        references: visualBurstReferences,
        updated_at: receivedAt,
      };

      nextVisualContext.commercial_last_customer_message_at =
        receivedAt;

      session = await this.conversationMemoryService.updateSession(
        currentSession.id,
        {
          stage:
            currentSession.stage === 'main' ||
            currentSession.stage === 'area_menu'
              ? 'active'
              : currentSession.stage,
          context: nextVisualContext,
        },
      );

      const canReplyToVisualImage =
        await this.waitForInboundQuietWindow(
          `${input.incomingPhoneNumberId}:${input.phone}`,
          input.incomingMessageId,
        );

      if (!canReplyToVisualImage) {
        console.log(
          `Respuesta de producto visual omitida porque llegó un mensaje más reciente de ${input.phone}`,
        );
        return;
      }

      if (visualBurstReferences.length > 1) {
        const burstCustomerMessage = [
          '[RAFAGA_VISUAL_MULTIPRODUCTO]',
          `El cliente envió ${visualBurstReferences.length} imágenes dentro de una misma ráfaga.`,
          'Cada imagen puede representar un producto distinto. No reemplaces conceptualmente las referencias anteriores por la última imagen.',
          'No interpretes varias imágenes como varias unidades del último producto.',
          'Si el cliente se refiere a “las dos”, “ambas”, “todas” o equivalente, conserva cada referencia como producto independiente.',
          `Referencias analizadas de esta ráfaga: ${JSON.stringify(visualBurstReferences)}`,
          'Los matched_product de tipo exact son productos ya validados contra el catálogo real.',
          'Las referencias similar o none no deben presentarse como coincidencias exactas.',
          'Responde una sola vez teniendo en cuenta el conjunto completo de imágenes.',
          'No agregues productos al carrito salvo que la intención de compra del cliente sea explícita y estén resueltas las variantes necesarias.',
        ].join('\n');

        const burstReply = await this.resolveReply(
          profile,
          session,
          burstCustomerMessage,
        );

        if (
          !this.isCurrentInboundMessage(
            `${input.incomingPhoneNumberId}:${input.phone}`,
            input.incomingMessageId,
          )
        ) {
          console.log(
            `Respuesta de ráfaga visual cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
          );
          return;
        }

        await this.whatsappMessagingService.sendText(
          profile.id,
          input.phone,
          burstReply,
        );
        replySent = true;

        await this.conversationMemoryService.saveMessage({
          companyId: profile.id,
          sessionId: session.id,
          customerPhone: input.phone,
          message: burstReply,
          sender: 'assistant',
          authorType: 'ai',
          aiResponse: burstReply,
        });

        await this.conversationMemoryService.touchSession(session.id);
        console.log(
          `Ráfaga de ${visualBurstReferences.length} imágenes comprendida y respondida a ${input.phone}`,
        );
        return;
      }

      const visualCustomerMessage = [
        '[REFERENCIA_VISUAL]',
        input.caption
          ? `Texto escrito por el cliente junto a la imagen: ${input.caption}`
          : 'El cliente envió solamente una imagen y quiere atención sobre lo que aparece.',
        `Descripción visual: ${analysis.summary}`,
        `Categoría aproximada: ${analysis.category}`,
        analysis.productName
          ? `Nombre comercial leído: ${analysis.productName}`
          : '',
        analysis.reference
          ? `Referencia o código leído: ${analysis.reference}`
          : '',
        analysis.visiblePrice
          ? `Precio visible leído: ${analysis.visiblePrice}`
          : '',
        analysis.colors.length
          ? `Colores observados: ${analysis.colors.join(', ')}`
          : '',
        analysis.visibleText
          ? `Texto visible en la imagen: ${analysis.visibleText}`
          : '',
        analysis.searchTerms.length
          ? `Términos útiles: ${analysis.searchTerms.join(', ')}`
          : '',
        `Validación con catálogo real: ${visualMatch.matchType}. Confianza: ${visualMatch.confidence}.`,
        visualMatch.matchedProduct
          ? `Producto real validado: ${visualMatch.matchedProduct.title}. URL: ${visualMatch.matchedProduct.url}. Precio del catálogo: ${visualMatch.matchedProduct.priceFromCop || 'consultar producto seleccionado'}.`
          : '',
        visualMatch.candidates.length
          ? `Opciones reales parecidas, sin confirmar referencia exacta: ${visualMatch.candidates.map((item, index) => `${index + 1}. ${item.title} — ${item.url}`).join(' | ')}`
          : '',
        'Responde de forma breve y natural.',
        'Si existe producto exacto confirmado, consulta el producto seleccionado y continúa con sus variantes reales.',
        'Si existen posibles coincidencias pero no hay certeza exacta, no las presentes como identificación confirmada. Sigue las instrucciones de la empresa y pide solo la aclaración mínima necesaria para continuar.',
        'Si no hay coincidencias, sigue las instrucciones de la empresa y pide únicamente un dato útil para continuar la búsqueda, sin inventar productos ni exigir un tipo específico de dato si no es necesario.',
      ].filter(Boolean).join('\n');

      const reply = await this.resolveReply(
        profile,
        session,
        visualCustomerMessage,
      );

      if (
        !this.isCurrentInboundMessage(
          `${input.incomingPhoneNumberId}:${input.phone}`,
          input.incomingMessageId,
        )
      ) {
        console.log(
          `Respuesta visual cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
        );
        return;
      }

      await this.whatsappMessagingService.sendText(
        profile.id,
        input.phone,
        reply,
      );
      replySent = true;

      await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: reply,
        sender: 'assistant',
        authorType: 'ai',
        aiResponse: reply,
      });

      await this.conversationMemoryService.touchSession(session.id);
      console.log(`Imagen comprendida y respondida a ${input.phone}`);
    } catch (error) {
      console.error('No se pudo procesar la imagen entrante:', error);

      if (!replySent && profile && session) {
        const canSendImageFallback =
          await this.waitForInboundQuietWindow(
            `${input.incomingPhoneNumberId}:${input.phone}`,
            input.incomingMessageId,
          );

        if (!canSendImageFallback) {
          console.log(
            `Fallback de imagen omitido porque llegó un mensaje más reciente de ${input.phone}`,
          );
          return;
        }

        const fallback =
          'Recibí la imagen, pero no logré analizarla correctamente. ' +
          'Puedes enviarla otra vez, escribir qué producto buscas o compartir el enlace para ayudarte.';

        try {
          await this.whatsappMessagingService.sendText(
            profile.id,
            input.phone,
            fallback,
          );

          await this.conversationMemoryService.saveMessage({
            companyId: profile.id,
            sessionId: session.id,
            customerPhone: input.phone,
            message: fallback,
            sender: 'assistant',
            authorType: 'ai',
            aiResponse: fallback,
          });

          await this.conversationMemoryService.touchSession(session.id);
        } catch (fallbackError) {
          console.error(
            'No se pudo enviar la respuesta de respaldo para la imagen:',
            fallbackError,
          );
        }
      }
    }
  }

  private async classifyIncomingImageIntent(input: {
    buffer: Buffer;
    mimeType: string;
    caption: string;
    profile: CompanyProfile;
    session: ConversationSession;
  }): Promise<{
    imageType:
      | 'payment_proof'
      | 'product'
      | 'mixed'
      | 'warranty_or_return'
      | 'shipping_or_document'
      | 'other'
      | 'ambiguous';
    primaryIntent:
      | 'validate_payment'
      | 'add_or_review_product'
      | 'customer_service'
      | 'clarify';
    hasPaymentIntent: boolean;
    hasProductIntent: boolean;
    confidence: 'low' | 'medium' | 'high';
    reason: string;
    advisorSummary: string;
  }> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY no está configurada para interpretar imágenes.',
      );
    }

    const mimeType =
      input.mimeType.split(';')[0].trim().toLowerCase() || 'image/jpeg';
    const recentMessages =
      await this.conversationMemoryService.getRecentMessagesForAi(
        input.session.id,
        16,
      );

    const history = recentMessages
      .map((item) => {
        const role =
          item.authorType === 'customer'
            ? 'CLIENTE'
            : item.authorType === 'advisor'
              ? 'ASESOR'
              : 'IA';
        const media = item.mediaMimeType
          ? ` [archivo ${item.mediaMimeType}]`
          : '';
        return `${role}${media}: ${item.message}`;
      })
      .join('\n')
      .slice(-12000);

    const client = new OpenAI({ apiKey });
    const model =
      process.env.OPENAI_VISION_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      'gpt-5-mini';
    const dataUrl =
      `data:${mimeType};base64,${input.buffer.toString('base64')}`;

    const response = await client.responses.create({
      model,
      instructions: [
        'Eres el clasificador central de intención multimodal de una plataforma comercial multiempresa.',
        'Analiza conjuntamente la imagen actual, el texto que la acompaña, el historial reciente, lo que la IA pidió y el contexto de la sesión.',
        'Las personas escriben de forma desordenada, cambian de tema y pueden expresar varias intenciones. No decidas solo por el mensaje anterior ni solo por la imagen.',
        'Debes distinguir comprobantes de pago, productos, imágenes de cambios/garantías, documentos o guías.',
        'payment_proof: recibo, transferencia, comprobante, consignación, pantalla de pago o evidencia de una transacción.',
        'product: artículo, objeto, captura de catálogo o referencia comercial de producto.',
        'mixed: el bloque reciente contiene simultáneamente pago y solicitud/interés de producto, aunque la imagen actual muestre solo uno de ellos.',
        'Si la IA solicitó un comprobante y la imagen parece evidencia de pago, hasPaymentIntent debe ser true.',
        'Si el cliente dice "esta también", "quiero agregar esta", "quiero esta" o equivalente y la imagen es un producto, hasProductIntent debe ser true aunque antes estuvieran hablando de pago.',
        'Si hay evidencia de pago o comprobante recibido, la intención principal puede ser validate_payment. Tu función aquí es clasificar la imagen, no decidir si debe transferirse a un asesor. El siguiente paso depende de las instrucciones configuradas para la empresa y de las acciones reales disponibles.',
        'No marques pago únicamente porque antes se mencionó pagar: exige evidencia actual, texto actual de pago o una solicitud explícita previa de comprobante que la imagen responda.',
        'Devuelve únicamente JSON válido, sin markdown, con esta estructura exacta:',
        '{"image_type":"payment_proof|product|mixed|warranty_or_return|shipping_or_document|other|ambiguous","primary_intent":"validate_payment|add_or_review_product|customer_service|clarify","has_payment_intent":true,"has_product_intent":false,"confidence":"low|medium|high","reason":"...","advisor_summary":"..."}',
        'reason debe ser breve.',
        'advisor_summary debe resumir en máximo 240 caracteres qué envió el cliente y qué queda pendiente. Si también hay producto, inclúyelo.',
        `Empresa activa: ${input.profile.name}.`,
        `Instrucciones configuradas: ${(input.profile.aiInstructions || 'Sin instrucciones adicionales.').slice(0, 5000)}`,
        `Contexto de sesión: ${JSON.stringify(input.session.context).slice(0, 7000)}`,
        `Historial reciente:\n${history || 'Sin historial previo.'}`,
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: input.caption
                ? `Texto enviado junto a la imagen: ${input.caption}`
                : 'La imagen llegó sin texto adjunto. Interprétala usando el historial completo.',
            },
            {
              type: 'input_image',
              image_url: dataUrl,
              detail: 'auto',
            },
          ],
        },
      ],
    } as any);

    const raw = response.output_text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    let parsed: Record<string, unknown>;

    try {
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('JSON inválido');
      }
      parsed = value as Record<string, unknown>;
    } catch {
      throw new Error(
        'OpenAI no devolvió una clasificación multimodal estructurada.',
      );
    }

    const readText = (key: string, max: number) =>
      typeof parsed[key] === 'string'
        ? String(parsed[key]).replace(/\s+/g, ' ').trim().slice(0, max)
        : '';

    const rawType = readText('image_type', 50);
    const allowedTypes = new Set([
      'payment_proof',
      'product',
      'mixed',
      'warranty_or_return',
      'shipping_or_document',
      'other',
      'ambiguous',
    ]);
    const rawIntent = readText('primary_intent', 50);
    const allowedIntents = new Set([
      'validate_payment',
      'add_or_review_product',
      'customer_service',
      'clarify',
    ]);
    const rawConfidence = readText('confidence', 20);

    return {
      imageType: allowedTypes.has(rawType)
        ? (rawType as any)
        : 'ambiguous',
      primaryIntent: allowedIntents.has(rawIntent)
        ? (rawIntent as any)
        : 'clarify',
      hasPaymentIntent: parsed.has_payment_intent === true,
      hasProductIntent: parsed.has_product_intent === true,
      confidence:
        rawConfidence === 'high' || rawConfidence === 'medium'
          ? rawConfidence
          : 'low',
      reason: readText('reason', 500) || 'Clasificación multimodal.',
      advisorSummary:
        readText('advisor_summary', 240) ||
        'Revisar la última imagen y continuar desde el contexto reciente.',
    };
  }

  private async continueIncomingPaymentProof(input: {
    profile: CompanyProfile;
    session: ConversationSession;
    phone: string;
    caption: string;
    incomingPhoneNumberId: string;
    incomingMessageId: string | null;
    intent: {
      imageType: string;
      hasPaymentIntent: boolean;
      hasProductIntent: boolean;
      confidence: string;
      reason: string;
      advisorSummary: string;
    };
  }): Promise<void> {
    const current =
      await this.conversationMemoryService.getSessionById(input.session.id);
    const now = new Date().toISOString();

    const updated =
      await this.conversationMemoryService.updateSession(current.id, {
        context: {
          ...current.context,
          multimodal_last_intent: {
            image_type: input.intent.imageType,
            has_payment_intent: input.intent.hasPaymentIntent,
            has_product_intent: input.intent.hasProductIntent,
            confidence: input.intent.confidence,
            reason: input.intent.reason,
            received_at: now,
          },
          last_payment_evidence: {
            received: true,
            image_type: input.intent.imageType,
            confidence: input.intent.confidence,
            received_at: now,
          },
        },
      });

    const conversationKey =
      `${input.incomingPhoneNumberId}:${input.phone}`;

    const canReply =
      await this.waitForInboundQuietWindow(
        conversationKey,
        input.incomingMessageId,
      );

    if (!canReply) {
      console.log(
        `Respuesta de comprobante omitida porque llegó un mensaje más reciente de ${input.phone}`,
      );
      return;
    }

    const paymentEvidenceMessage = [
      '[COMPROBANTE_DE_PAGO_RECIBIDO]',
      input.caption
        ? `Texto del cliente: ${input.caption}`
        : 'El cliente envió la imagen sin texto adicional.',
      `Tipo interpretado: ${input.intent.imageType}.`,
      `Confianza: ${input.intent.confidence}.`,
      `Contexto interpretado: ${input.intent.advisorSummary}.`,
      'La imagen parece evidencia o comprobante de pago.',
      'No afirmes que el pago está validado, aprobado o confirmado únicamente por haber recibido esta imagen.',
      'No transfieras automáticamente a un asesor por recibir el comprobante.',
      'Continúa desde el estado actual de la compra usando las instrucciones configuradas de Medios de pago y Finalización de compra y checkout.',
      'Si la configuración indica continuar al checkout después del comprobante y están completos los requisitos técnicos, usa las herramientas reales disponibles para hacerlo.',
      'No vuelvas a solicitar el mismo comprobante ni reinicies la venta.',
      input.intent.hasProductIntent
        ? 'También existe intención relacionada con producto; conserva las referencias comerciales activas y resuelve ambas señales usando el contexto.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const reply = await this.resolveReply(
      input.profile,
      updated,
      paymentEvidenceMessage,
    );

    if (
      !this.isCurrentInboundMessage(
        conversationKey,
        input.incomingMessageId,
      )
    ) {
      console.log(
        `Respuesta de comprobante cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
      );
      return;
    }

    await this.whatsappMessagingService.sendText(
      input.profile.id,
      input.phone,
      reply,
    );

    await this.conversationMemoryService.saveMessage({
      companyId: input.profile.id,
      sessionId: updated.id,
      customerPhone: input.phone,
      message: reply,
      sender: 'assistant',
      authorType: 'ai',
      aiResponse: reply,
    });

    await this.conversationMemoryService.touchSession(updated.id);
  }

  private async analyzeIncomingImage(input: {
    buffer: Buffer;
    mimeType: string;
    caption: string;
    companyName: string;
    companyInstructions: string;
  }): Promise<{
    summary: string;
    category: string;
    productName: string;
    reference: string;
    visiblePrice: string;
    colors: string[];
    visibleText: string;
    searchTerms: string[];
    sourceHint: 'catalog_screenshot' | 'external_reference' | 'unknown';
    confidence: 'low' | 'medium' | 'high';
  }> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY no está configurada para analizar imágenes.',
      );
    }

    if (!input.buffer.length) {
      throw new Error('La imagen descargada está vacía.');
    }

    if (input.buffer.length > 15 * 1024 * 1024) {
      throw new Error('La imagen supera el límite seguro de 15 MB.');
    }

    const mimeType = input.mimeType
      .split(';')[0]
      .trim()
      .toLowerCase();
    const supportedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);

    if (!supportedMimeTypes.has(mimeType)) {
      throw new Error(
        `El formato ${mimeType || 'desconocido'} no es compatible con el análisis visual.`,
      );
    }

    const client = new OpenAI({ apiKey });
    const model =
      process.env.OPENAI_VISION_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      'gpt-5-mini';
    const dataUrl =
      `data:${mimeType};base64,${input.buffer.toString('base64')}`;

    const response = await client.responses.create({
      model,
      instructions: [
        'Analiza la imagen como referencia comercial enviada por un cliente.',
        'Devuelve únicamente JSON válido y sin markdown con esta estructura:',
        '{"summary":"...","category":"...","product_name":"...","reference":"...","visible_price":"...","colors":["..."],"visible_text":"...","search_terms":["..."],"source_hint":"catalog_screenshot|external_reference|unknown","confidence":"low|medium|high"}',
        'summary: describe objetivamente el producto principal, sin inventar atributos, características ni disponibilidad.',
        'category: categoría breve y útil en español para buscar dentro del catálogo real de la empresa.',
        'product_name: copia el nombre comercial legible del producto; déjalo vacío si está oculto o no es claro.',
        'reference: copia una referencia, SKU o código claramente legible; déjalo vacío si no aparece.',
        'visible_price: copia únicamente el precio claramente visible; no lo deduzcas.',
        'colors: únicamente colores claramente visibles.',
        'visible_text: copia el texto comercial legible que pueda ayudar a identificar el producto.',
        'search_terms: entre 1 y 6 términos cortos y específicos para buscar el producto o similares.',
        'catalog_screenshot: parece captura de una tienda, catálogo o publicación comercial.',
        'external_reference: parece una foto o referencia externa sin prueba de pertenecer a la empresa.',
        'unknown: no es posible determinar el origen.',
        'Nunca afirmes que el producto pertenece a la empresa ni que existe en su catálogo.',
        `Empresa activa: ${input.companyName}.`,
        `Instrucciones de la empresa: ${(input.companyInstructions || 'Sin instrucciones adicionales.').slice(0, 4000)}`,
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: input.caption
                ? `El cliente acompañó la imagen con este texto: ${input.caption}`
                : 'El cliente no escribió texto junto a la imagen.',
            },
            {
              type: 'input_image',
              image_url: dataUrl,
              detail: 'auto',
            },
          ],
        },
      ],
    } as any);

    const raw = response.output_text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    let parsed: Record<string, unknown>;

    try {
      const value = JSON.parse(raw) as unknown;

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('La respuesta visual no fue un objeto JSON.');
      }

      parsed = value as Record<string, unknown>;
    } catch {
      throw new Error(
        'OpenAI no devolvió un análisis visual estructurado.',
      );
    }

    const readText = (value: unknown, limit: number): string =>
      typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
        : '';
    const readList = (
      value: unknown,
      maxItems: number,
      maxLength: number,
    ): string[] =>
      Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === 'string')
            .map((item) =>
              item.replace(/\s+/g, ' ').trim().slice(0, maxLength),
            )
            .filter(Boolean)
            .slice(0, maxItems)
        : [];

    const category = readText(parsed.category, 120) || 'producto';
    const summary =
      readText(parsed.summary, 1000) ||
      `Se observa un producto de la categoría ${category}.`;
    const rawSourceHint = readText(parsed.source_hint, 40);
    const rawConfidence = readText(parsed.confidence, 20);
    const searchTerms = readList(parsed.search_terms, 6, 100);

    return {
      summary,
      category,
      productName: readText(parsed.product_name, 240),
      reference: readText(parsed.reference, 120),
      visiblePrice: readText(parsed.visible_price, 80),
      colors: readList(parsed.colors, 6, 50),
      visibleText: readText(parsed.visible_text, 1200),
      searchTerms: searchTerms.length ? searchTerms : [category],
      sourceHint:
        rawSourceHint === 'catalog_screenshot' ||
        rawSourceHint === 'external_reference'
          ? rawSourceHint
          : 'unknown',
      confidence:
        rawConfidence === 'high' || rawConfidence === 'medium'
          ? rawConfidence
          : 'low',
    };
  }

  private async processIncomingAudio(input: {
    incomingPhoneNumberId: string;
    phone: string;
    incomingMessageId: string | null;
    replyToProviderMessageId: string | null;
    mediaId: string;
    mimeType: string;
    voice: boolean;
  }): Promise<void> {
    try {
      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'whatsapp',
          input.incomingPhoneNumberId,
        );

      if (!integration) {
        throw new Error(
          'No existe una empresa activa para el audio entrante.',
        );
      }

      const profile =
        await this.conversationMemoryService.getCompanyProfileById(
          integration.companyId,
        );
      let session =
        await this.conversationMemoryService.getOrCreateSessionByCompanyId(
          integration.companyId,
          input.phone,
        );

      let transcription = '';
      let transcriptionError = '';

      try {
        const media = await this.whatsappMessagingService.downloadMedia(
          profile.id,
          input.mediaId,
        );

        transcription = await this.transcribeIncomingAudio({
          buffer: media.buffer,
          filename: media.filename,
          companyName: profile.name,
        });
      } catch (error) {
        transcriptionError =
          error instanceof Error
            ? error.message
            : 'No se pudo transcribir el audio.';
        console.error(
          `No se pudo transcribir el audio de ${input.phone}:`,
          error,
        );
      }

      const saved = await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: transcription
          ? `Transcripción del audio: ${transcription}`
          : 'Audio recibido. No se pudo generar la transcripción automática.',
        sender: 'customer',
        authorType: 'customer',
        providerMessageId: input.incomingMessageId,
        replyToProviderMessageId:
          input.replyToProviderMessageId,
        messageType: 'audio',
        mediaId: input.mediaId,
        mediaMimeType: input.mimeType,
        mediaFilename: 'audio.ogg',
        mediaVoice: input.voice,
      });

      if (saved === 'duplicate') {
        return;
      }

      await this.conversationMemoryService.touchSession(session.id);

      if (
        session.attentionStatus === 'waiting' ||
        session.attentionStatus === 'human'
      ) {
        console.log(
          `Audio guardado para atención humana de ${input.phone}`,
        );
        return;
      }

      if (session.attentionStatus === 'closed') {
        session =
          await this.conversationMemoryService.resumeAiConversation(
            session.id,
          );
      }

      const isLatestInboundMessage =
        await this.waitForInboundQuietWindow(
          `${input.incomingPhoneNumberId}:${input.phone}`,
          input.incomingMessageId,
        );

      if (!isLatestInboundMessage) {
        console.log(
          `Respuesta de audio omitida porque llegó un mensaje más reciente de ${input.phone}`,
        );
        return;
      }

      if (!transcription) {
        await this.handleAudioTranscriptionFailure({
          profile,
          session,
          phone: input.phone,
          reason: transcriptionError,
        });
        return;
      }

      session = await this.clearAudioTranscriptionState(session);
      session = await this.attachRecoveryContext(
        session,
        profile.id,
        input.phone,
      );

      const reply = await this.resolveReply(
        profile,
        session,
        transcription,
      );

      if (
        !this.isCurrentInboundMessage(
          `${input.incomingPhoneNumberId}:${input.phone}`,
          input.incomingMessageId,
        )
      ) {
        console.log(
          `Respuesta de audio cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
        );
        return;
      }

      await this.whatsappMessagingService.sendText(
        profile.id,
        input.phone,
        reply,
      );

      await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: reply,
        sender: 'assistant',
        authorType: 'ai',
        aiResponse: reply,
      });

      await this.conversationMemoryService.touchSession(session.id);
      console.log(`Audio comprendido y respondido a ${input.phone}`);
    } catch (error) {
      console.error('No se pudo procesar el audio entrante:', error);
    }
  }

  private async transcribeIncomingAudio(input: {
    buffer: Buffer;
    filename: string;
    companyName: string;
  }): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY no está configurada para transcribir audios.',
      );
    }

    if (!input.buffer.length) {
      throw new Error('El audio descargado está vacío.');
    }

    const client = new OpenAI({ apiKey });
    const model =
      process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() ||
      'gpt-4o-mini-transcribe';
    const filename =
      input.filename.trim().toLowerCase().endsWith('.mp3')
        ? input.filename.trim()
        : 'audio.mp3';

    const result = await client.audio.transcriptions.create({
      file: await toFile(input.buffer, filename),
      model: model as any,
      language: 'es',
      prompt:
        `Transcribe fielmente este mensaje de un cliente de ${input.companyName}. ` +
        'Conserva nombres de productos, colores, tallas, ciudades, números de pedido, ' +
        'correos, teléfonos y referencias tal como se escuchen. No respondas ni resumas.',
    });

    const transcription =
      typeof result.text === 'string'
        ? result.text.replace(/\s+/g, ' ').trim().slice(0, 6000)
        : '';

    if (
      !transcription ||
      !/[\p{L}\p{N}]/u.test(transcription)
    ) {
      throw new Error(
        'OpenAI no pudo obtener una transcripción comprensible.',
      );
    }

    return transcription;
  }

  private async clearAudioTranscriptionState(
    session: any,
  ): Promise<any> {
    const current =
      await this.conversationMemoryService.getSessionById(session.id);

    if (
      !current.context.audio_transcription_state ||
      typeof current.context.audio_transcription_state !== 'object' ||
      Array.isArray(current.context.audio_transcription_state)
    ) {
      return current;
    }

    const nextContext = { ...current.context };
    delete nextContext.audio_transcription_state;

    return this.conversationMemoryService.updateSession(current.id, {
      context: nextContext,
    });
  }

  private async handleAudioTranscriptionFailure(input: {
    profile: any;
    session: any;
    phone: string;
    reason: string;
  }): Promise<void> {
    const current =
      await this.conversationMemoryService.getSessionById(
        input.session.id,
      );
    const rawState =
      current.context.audio_transcription_state &&
      typeof current.context.audio_transcription_state === 'object' &&
      !Array.isArray(current.context.audio_transcription_state)
        ? current.context.audio_transcription_state as Record<string, unknown>
        : null;
    const previousCount =
      rawState && typeof rawState.count === 'number'
        ? Math.max(0, Math.floor(rawState.count))
        : 0;
    const nextCount = previousCount + 1;

    if (nextCount >= 2) {
      const updated =
        await this.conversationMemoryService.requestHumanAttention(
          current.id,
          {
            reason:
              'No se logró comprender el audio después de dos intentos.',
            summary:
              'Escucha los últimos audios del cliente y continúa desde el contexto, carrito y datos ya registrados.',
          },
        );
      const reply =
        this.chatAgentService.humanAttentionReply(updated);

      await this.whatsappMessagingService.sendText(
        input.profile.id,
        input.phone,
        reply,
      );

      await this.conversationMemoryService.saveMessage({
        companyId: input.profile.id,
        sessionId: current.id,
        customerPhone: input.phone,
        message: reply,
        sender: 'assistant',
        authorType: 'ai',
        aiResponse: reply,
      });

      await this.conversationMemoryService.touchSession(current.id);
      return;
    }

    await this.conversationMemoryService.updateSession(current.id, {
      context: {
        ...current.context,
        audio_transcription_state: {
          count: nextCount,
          reason: input.reason.trim().slice(0, 500),
          failed_at: new Date().toISOString(),
        },
      },
    });

    const reply =
      'No logré escuchar bien el audio. Por favor envíalo nuevamente ' +
      'o escríbeme el mensaje para poder ayudarte.';

    await this.whatsappMessagingService.sendText(
      input.profile.id,
      input.phone,
      reply,
    );

    await this.conversationMemoryService.saveMessage({
      companyId: input.profile.id,
      sessionId: current.id,
      customerPhone: input.phone,
      message: reply,
      sender: 'assistant',
      authorType: 'ai',
      aiResponse: reply,
    });

    await this.conversationMemoryService.touchSession(current.id);
  }

  private async processIncomingText(input: {
    incomingPhoneNumberId: string;
    phone: string;
    text: string;
    incomingMessageId: string | null;
    replyToProviderMessageId: string | null;
    suppressReply: boolean;
    templateButton: boolean;
  }): Promise<void> {
    try {
      const integration =
        await this.companyIntegrationService.findActiveIntegrationByExternalId(
          'meta',
          'whatsapp',
          input.incomingPhoneNumberId,
        );

      if (!integration) {
        throw new Error(
          'No existe una empresa activa para el canal de WhatsApp entrante.',
        );
      }

      const profile =
        await this.conversationMemoryService.getCompanyProfileById(
          integration.companyId,
        );

      let session =
        await this.conversationMemoryService.getOrCreateSessionByCompanyId(
          integration.companyId,
          input.phone,
        );

      const receivedMessage =
        await this.conversationMemoryService.saveMessage({
          companyId: profile.id,
          sessionId: session.id,
          customerPhone: input.phone,
          message: input.text,
          sender: 'customer',
          authorType: 'customer',
          providerMessageId: input.incomingMessageId,
          replyToProviderMessageId:
            input.replyToProviderMessageId,
        });

      if (receivedMessage === 'duplicate') {
        console.log(`Mensaje duplicado ignorado de ${input.phone}`);
        return;
      }

      await this.conversationMemoryService.touchSession(session.id);

      if (input.templateButton) {
        const buttonAction =
          await this.whatsappTemplateExecutionService.resolveButtonAction(
            profile.id,
            input.text,
          );

        if (buttonAction) {
          const reply = await this.executeTemplateButtonAction({
            profile,
            session,
            phone: input.phone,
            action: buttonAction.action,
          });

          if (reply) {
            await this.whatsappMessagingService.sendText(
              profile.id,
              input.phone,
              reply,
            );

            await this.conversationMemoryService.saveMessage({
              companyId: profile.id,
              sessionId: session.id,
              customerPhone: input.phone,
              message: reply,
              sender: 'assistant',
              authorType: 'ai',
              aiResponse: reply,
            });

            await this.conversationMemoryService.touchSession(session.id);
          }

          return;
        }
      }

      if (input.suppressReply) {
        return;
      }

      if (
        session.attentionStatus === 'waiting' ||
        session.attentionStatus === 'human'
      ) {
        console.log(`Mensaje recibido para atención humana de ${input.phone}`);
        return;
      }

      if (session.attentionStatus === 'closed') {
        session = await this.conversationMemoryService.resumeAiConversation(
          session.id,
        );
      }

      const isLatestInboundMessage =
        await this.waitForInboundQuietWindow(
          `${input.incomingPhoneNumberId}:${input.phone}`,
          input.incomingMessageId,
        );

      if (!isLatestInboundMessage) {
        console.log(
          `Respuesta omitida porque llegó un mensaje más reciente de ${input.phone}`,
        );
        return;
      }

      session = await this.attachRecoveryContext(
        session,
        profile.id,
        input.phone,
      );

      const reply = await this.resolveReply(profile, session, input.text);

      if (
        !this.isCurrentInboundMessage(
          `${input.incomingPhoneNumberId}:${input.phone}`,
          input.incomingMessageId,
        )
      ) {
        console.log(
          `Respuesta de texto cancelada porque llegó otro mensaje durante el procesamiento de ${input.phone}`,
        );
        return;
      }

      await this.whatsappMessagingService.sendText(
        profile.id,
        input.phone,
        reply,
      );

      await this.conversationMemoryService.saveMessage({
        companyId: profile.id,
        sessionId: session.id,
        customerPhone: input.phone,
        message: reply,
        sender: 'assistant',
        authorType: 'ai',
        aiResponse: reply,
      });

      await this.conversationMemoryService.touchSession(session.id);
      console.log(`Respuesta enviada a ${input.phone}`);
    } catch (error) {
      console.error('No se pudo procesar la conversación:', error);

      try {
        const fallbackIntegration =
          await this.companyIntegrationService.findActiveIntegrationByExternalId(
            'meta',
            'whatsapp',
            input.incomingPhoneNumberId,
          );

        const canSendFallback =
          this.isCurrentInboundMessage(
            `${input.incomingPhoneNumberId}:${input.phone}`,
            input.incomingMessageId,
          );

        if (fallbackIntegration && canSendFallback) {
          await this.whatsappMessagingService.sendText(
            fallbackIntegration.companyId,
            input.phone,
            'Estamos revisando la información para ayudarte. Por favor intenta nuevamente en unos minutos.',
          );
        }
      } catch (sendError) {
        console.error('No se pudo enviar el mensaje de respaldo:', sendError);
      }
    }
  }

  private async executeTemplateButtonAction(input: {
    profile: CompanyProfile;
    session: ConversationSession;
    phone: string;
    action: string;
  }): Promise<string | null> {
    const now = new Date().toISOString();

    switch (input.action) {
      case 'tracking_information': {
        const validatedOrder =
          input.session.context.validated_order_lookup &&
          typeof input.session.context.validated_order_lookup === 'object' &&
          !Array.isArray(input.session.context.validated_order_lookup)
            ? input.session.context.validated_order_lookup as Record<string, unknown>
            : null;

        const validatedOrderName =
          this.cleanFlowString(validatedOrder?.order_name);

        const validatedOrderId =
          this.cleanFlowString(validatedOrder?.order_id);

        const validatedIdentifiers =
          validatedOrder?.identifiers &&
          typeof validatedOrder.identifiers === 'object' &&
          !Array.isArray(validatedOrder.identifiers)
            ? validatedOrder.identifiers as Record<string, unknown>
            : {};

        if (validatedOrderName) {
          return this.resolveValidatedOrderConfirmation(
            input.session,
            'guía y seguimiento de mi pedido',
            {
              type: 'order_lookup_confirm_previous',
              order_id: validatedOrderId,
              order_name: validatedOrderName,
              identifiers: validatedIdentifiers,
            },
            false,
          );
        }

        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            stage: 'active',
            context: {
              ...input.session.context,
              conversation_category: 'service',
              conversation_category_updated_at: now,
              customer_service_flow: {
                type: 'order_lookup',
                identifiers: {},
                attempts: 0,
                updated_at: now,
              },
            },
          },
        );

        return 'Claro 😊 Envíame el número del pedido o el correo utilizado en la compra.';
      }

      case 'accept_order_updates':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              order_updates_consent: {
                accepted: true,
                source: 'whatsapp_template_button',
                updated_at: now,
              },
            },
          },
        );

        return 'Listo ✅ Seguirás recibiendo por este chat las actualizaciones disponibles de tu pedido.';

      case 'confirm_cod_order':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              cod_confirmation: {
                confirmed: true,
                updated_at: now,
              },
            },
          },
        );

        return 'Pedido confirmado ✅ Ahora confírmame el nombre de tu barrio para organizar la entrega.';

      case 'payment_assistance':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              customer_service_flow: {
                type: 'payment_problem',
                updated_at: now,
              },
            },
          },
        );

        return 'Claro 😊 Cuéntame qué inconveniente tienes con el pago. No envíes claves, códigos de seguridad ni datos bancarios sensibles.';

      case 'request_human_agent':
        return this.requestCustomerServiceHuman(
          input.session,
          'Cliente solicitó asesor desde una plantilla de WhatsApp.',
          'El cliente pulsó un botón para hablar con un asesor.',
        );

      case 'open_commercial_conversation':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            stage: 'sales',
            context: {
              ...input.session.context,
              commercial_conversation: {
                open: true,
                updated_at: now,
              },
            },
          },
        );

        return 'Perfecto 😊 Cuéntame qué producto te interesa y te ayudo.';

      case 'stop_commercial_followup':
        await this.conversationMemoryService.updateSession(
          input.session.id,
          {
            context: {
              ...input.session.context,
              commercial_followup: {
                enabled: false,
                updated_at: now,
              },
            },
          },
        );

        return 'Listo. No continuaremos este seguimiento comercial por WhatsApp.';

      default:
        return null;
    }
  }

  private async resolveTrackingButtonReply(
    profile: CompanyProfile,
    phone: string,
  ): Promise<string> {
    try {
      const result = await this.customerOrderService.lookup(
        profile.id,
        { phone },
      ) as Record<string, any>;
      const orders =
        result.ok && result.found && Array.isArray(result.orders)
          ? result.orders
          : [];
      const order = orders[0] as Record<string, any> | undefined;

      if (!order) {
        return 'No encontré un pedido asociado a este número. Envíame el número del pedido para revisarlo.';
      }

      const tracking = this.getFirstOrderTracking(order);

      if (tracking) {
        return this.formatConfiguredTrackingReply(
          tracking,
          profile,
        );
      }

      const orderName = this.cleanCustomerText(order.name || '');

      return orderName
        ? `Tu pedido ${orderName} todavía no tiene una guía de seguimiento disponible.`
        : 'Tu pedido todavía no tiene una guía de seguimiento disponible.';
    } catch (error) {
      console.error(
        `No se pudo consultar el seguimiento para ${phone}:`,
        error,
      );

      return 'No pude consultar la guía en este momento. Envíame el número del pedido para revisarlo.';
    }
  }

  private async attachRecoveryContext(
    session: ConversationSession,
    companyId: string,
    customerPhone: string,
  ): Promise<ConversationSession> {
    const category =
      typeof session.context.conversation_category === 'string'
        ? session.context.conversation_category
        : '';

    const serviceArea =
      session.context.service_area &&
      typeof session.context.service_area === 'object' &&
      !Array.isArray(session.context.service_area)
        ? session.context.service_area as Record<string, unknown>
        : null;

    const serviceFlow =
      session.context.customer_service_flow &&
      typeof session.context.customer_service_flow === 'object' &&
      !Array.isArray(session.context.customer_service_flow)
        ? session.context.customer_service_flow as Record<string, unknown>
        : null;

    const isServiceContext =
      category === 'service' ||
      (
        category !== 'sales' &&
        (
          serviceArea?.areaType === 'service' ||
          Boolean(serviceFlow)
        )
      );

    // Un carrito abandonado es información comercial histórica.
    // Nunca puede sacar por sí solo al cliente de un caso activo de Servicio.
    if (isServiceContext) {
      return session;
    }

    try {
      const recovery =
        await this.cartRecoveryContextService.findForCustomer(
          companyId,
          customerPhone,
        );

      if (!recovery) {
        return session;
      }

      const recoveryContext = recovery.context;
      const initializedCartId =
        typeof session.context.cart_recovery_initialized_id === 'string'
          ? session.context.cart_recovery_initialized_id
          : null;

      if (initializedCartId === recoveryContext.cart_id) {
        return session;
      }

      const nextContext: Record<string, unknown> = {
        ...session.context,
        cart_recovery: recoveryContext,
        cart_recovery_initialized_id: recoveryContext.cart_id,
        cart: recovery.cartLines,
      };

      delete nextContext.selectedProduct;
      delete nextContext.selectedVariant;
      delete nextContext.selectedVariants;
      delete nextContext.selectedAt;
      delete nextContext.selectedVariantAt;
      delete nextContext.purchaseIntent;
      delete nextContext.purchaseIntentAt;
      delete nextContext.lastCartUrl;
      delete nextContext.lastCheckoutUrl;
      delete nextContext.lastCartUpdatedAt;
      delete nextContext.checkoutCreatedAt;

      return this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: nextContext,
      });
    } catch (error) {
      console.error(
        `No se pudo adjuntar el contexto de recuperación para ${customerPhone}:`,
        error,
      );
      return session;
    }
  }

  private async resolveReply(
    profile: CompanyProfile,
    session: ConversationSession,
    text: string,
  ): Promise<string> {
    const cleanText = text.toLowerCase().trim();
    const activeAreas =
      await this.conversationMemoryService.listActiveServiceAreas(profile.id);

    if (['menu', 'menú', 'inicio', 'volver'].includes(cleanText)) {
      const nextContext = this.startFreshAreaMenuContext(session.context);

      const resetSession = await this.conversationMemoryService.updateSession(
        session.id,
        { stage: 'area_menu', context: nextContext },
      );

      return this.buildServiceAreaMenu(profile, activeAreas, resetSession);
    }

    if (session.stage === 'main' || session.stage === 'area_menu') {
      const explicitArea = this.resolveServiceAreaChoice(
        activeAreas,
        cleanText,
      );
      const directArea =
        explicitArea
          ? null
          : await this.resolveDirectServiceAreaChoice(
              profile,
              activeAreas,
              text,
            );
      const selectedArea = explicitArea ?? directArea;

      if (!selectedArea) {
        return this.buildServiceAreaMenu(profile, activeAreas, session);
      }

      const selectedSession =
        await this.conversationMemoryService.updateSession(
          session.id,
          {
            stage: 'active',
            context: {
              ...session.context,
              ...(selectedArea.areaType
                ? {
                    conversation_category: selectedArea.areaType,
                    conversation_category_updated_at:
                      new Date().toISOString(),
                  }
                : {}),
              service_area: {
                id: selectedArea.id,
                name: selectedArea.name,
                description: selectedArea.description,
                areaType: selectedArea.areaType,
                selected_at: new Date().toISOString(),
                selected_automatically: Boolean(directArea),
              },
            },
          },
        );

      if (directArea) {
        return this.chatAgentService.reply(
          profile,
          selectedSession,
          text,
        );
      }

      return this.buildAreaWelcome(
        profile,
        selectedArea.name,
        selectedSession,
      );
    }

    const customerServiceReply = await this.resolveCustomerServiceReply(
      profile,
      activeAreas,
      session,
      cleanText,
      text,
    );

    if (customerServiceReply) {
      return customerServiceReply;
    }

    return this.chatAgentService.reply(profile, session, text);
  }

  private startFreshAreaMenuContext(
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const now = new Date().toISOString();
    const previousPurchaseContext: Record<string, unknown> = {
      saved_at: now,
    };
    let hasPreviousPurchase = false;

    for (const key of [
      'cart',
      'selectedProduct',
      'selectedVariant',
      'selectedVariants',
      'lastCartUrl',
      'lastCheckoutUrl',
    ]) {
      if (context[key] !== undefined && context[key] !== null) {
        previousPurchaseContext[key] = context[key];
        hasPreviousPurchase = true;
      }
    }

    const nextContext: Record<string, unknown> = {
      ...context,
      conversation_cycle_started_at: now,
      conversation_cycle_reason: 'customer_requested_menu',
      menu_requested_at: now,
    };

    if (hasPreviousPurchase) {
      nextContext.previous_purchase_context = previousPurchaseContext;
    }

    for (const key of [
      'service_area',
      'customer_service_flow',
      'conversation_category',
      'conversation_category_updated_at',
      'last_visual_reference',
      'visual_reference_burst',
      'commercial_visual_references',
      'cart',
      'cart_recovery',
      'selectedProduct',
      'selectedVariant',
      'selectedVariants',
      'selectedAt',
      'selectedVariantAt',
      'purchaseIntent',
      'purchaseIntentAt',
      'lastCartUrl',
      'lastCheckoutUrl',
      'lastCartUpdatedAt',
      'checkoutCreatedAt',
      'clarification_state',
      'technical_failure_state',
    ]) {
      delete nextContext[key];
    }

    return nextContext;
  }

  private async resolveDirectServiceAreaChoice(
    profile: CompanyProfile,
    areas: Array<{
      id: string;
      name: string;
      description: string;
      areaType: 'sales' | 'service' | null;
    }>,
    originalText: string,
  ): Promise<{
    id: string;
    name: string;
    description: string;
    areaType: 'sales' | 'service' | null;
  } | null> {
    const text = originalText.replace(/\s+/g, ' ').trim();

    if (
      !text ||
      /^\d+$/.test(text) ||
      !areas.length
    ) {
      return null;
    }

    const normalizedMessage = this.normalizeText(text);
    const ignored = new Set([
      'a',
      'al',
      'con',
      'de',
      'del',
      'el',
      'en',
      'la',
      'las',
      'lo',
      'los',
      'me',
      'mi',
      'para',
      'por',
      'que',
      'quiero',
      'un',
      'una',
      'y',
    ]);
    const messageTokens = normalizedMessage
      .split(' ')
      .filter(
        (token) =>
          token.length >= 3 &&
          !ignored.has(token),
      );
    const scored = areas
      .map((area) => {
        const areaTokens = this
          .normalizeText(`${area.name} ${area.description}`)
          .split(' ')
          .filter(
            (token) =>
              token.length >= 3 &&
              !ignored.has(token),
          );
        const overlap = areaTokens.filter((token) =>
          messageTokens.includes(token),
        ).length;

        return { area, overlap };
      })
      .sort((left, right) => right.overlap - left.overlap);

    if (
      scored[0]?.overlap >= 2 &&
      scored[0].overlap > (scored[1]?.overlap ?? 0)
    ) {
      console.log(
        `[ChatPro][direct-area] source=local area="${scored[0].area.name}"`,
      );
      return scored[0].area;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return null;
    }

    try {
      const client = new OpenAI({ apiKey });
      const model =
        process.env.OPENAI_MODEL?.trim() ||
        'gpt-5-mini';
      const response = await client.responses.create({
        model,
        instructions: [
          'Decide si el mensaje expresa una intención clara que corresponde a una de las áreas activas de una empresa.',
          'Devuelve únicamente JSON válido y sin markdown:',
          '{"area_id":"id o null","confidence":"low|medium|high","explicit_intent":true|false}',
          'Usa exclusivamente las áreas entregadas, considerando tanto su nombre como su descripción.',
          'Selecciona un área cuando el cliente ya explicó qué necesita: explorar o comprar productos, pagar, consultar un pedido, reportar un problema, solicitar cambio, garantía, devolución o atención humana.',
          'Devuelve area_id null cuando sea solo un saludo, una respuesta sin contexto, contenido ambiguo o no exista una correspondencia clara.',
          'No obligues al cliente a usar el menú cuando la intención sea clara.',
          `Empresa: ${profile.name}.`,
        ].join('\n'),
        input: JSON.stringify({
          mensaje: text,
          areas: areas.map((area) => ({
            id: area.id,
            name: area.name,
            description: area.description,
          })),
        }),
      });
      const raw = response.output_text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
      const parsed = JSON.parse(raw) as {
        area_id?: unknown;
        confidence?: unknown;
        explicit_intent?: unknown;
      };
      const areaId =
        typeof parsed.area_id === 'string'
          ? parsed.area_id.trim()
          : '';
      const confidence =
        parsed.confidence === 'high' ||
        parsed.confidence === 'medium'
          ? parsed.confidence
          : 'low';

      if (
        parsed.explicit_intent !== true ||
        confidence === 'low' ||
        !areaId
      ) {
        return null;
      }

      const area =
        areas.find((item) => item.id === areaId) ?? null;

      if (area) {
        console.log(
          `[ChatPro][direct-area] source=openai ` +
          `confidence=${confidence} area="${area.name}"`,
        );
      }

      return area;
    } catch (error) {
      console.error(
        '[ChatPro][direct-area] no se pudo clasificar el área:',
        error,
      );
      return null;
    }
  }

  private resolveServiceAreaChoice(
    areas: Array<{
      id: string;
      name: string;
      description: string;
      areaType: 'sales' | 'service' | null;
    }>,
    cleanText: string,
  ): {
    id: string;
    name: string;
    description: string;
    areaType: 'sales' | 'service' | null;
  } | null {
    const numericChoice = Number(cleanText);

    if (
      Number.isInteger(numericChoice) &&
      numericChoice >= 1 &&
      numericChoice <= areas.length
    ) {
      return areas[numericChoice - 1] ?? null;
    }

    return (
      areas.find((area) => {
        const name = area.name.toLowerCase();
        return cleanText === name || cleanText.includes(name);
      }) ?? null
    );
  }


  private async resolveCustomerServiceReply(
    profile: CompanyProfile,
    activeAreas: Array<{
      id: string;
      name: string;
      description: string;
      areaType: 'sales' | 'service' | null;
    }>,
    session: ConversationSession,
    _cleanText: string,
    originalText: string,
  ): Promise<string | null> {
    const flow = this.readCustomerServiceFlow(session.context);

    if (flow.type === 'order_lookup_confirm_previous') {
      return this.resolveValidatedOrderConfirmation(
        session,
        originalText,
        flow,
      );
    }

    const identifier = this.parseOrderIdentifier(originalText);

    if (flow.type !== 'order_lookup') {
      const validatedOrder =
        session.context.validated_order_lookup &&
        typeof session.context.validated_order_lookup === 'object' &&
        !Array.isArray(session.context.validated_order_lookup)
          ? session.context.validated_order_lookup as Record<string, unknown>
          : null;

      const validatedOrderName =
        this.cleanFlowString(validatedOrder?.order_name);

      const validatedOrderId =
        this.cleanFlowString(validatedOrder?.order_id);

      const validatedIdentifiers =
        validatedOrder?.identifiers &&
        typeof validatedOrder.identifiers === 'object' &&
        !Array.isArray(validatedOrder.identifiers)
          ? validatedOrder.identifiers as Record<string, unknown>
          : {};

      const normalizedText = this.normalizeText(originalText);

      const asksAboutExistingOrder =
        /\bmi (pedido|compra)\b/.test(normalizedText) ||
        /\b(rastrear|rastreo|seguimiento|guia)\b/.test(normalizedText) ||
        /\bdonde esta mi pedido\b/.test(normalizedText) ||
        /\bestado (de|del) pedido\b/.test(normalizedText) ||
        /\bcuanto pague\b/.test(normalizedText) ||
        /\bque pague\b/.test(normalizedText) ||
        /\bque compre\b/.test(normalizedText) ||
        /\bque productos? compre\b/.test(normalizedText) ||
        /\blo que compre\b/.test(normalizedText) ||
        /\bcomo pague\b/.test(normalizedText) ||
        /\bcon que pague\b/.test(normalizedText) ||
        /\bmedio de pago (use|utilice)\b/.test(normalizedText);

      if (
        validatedOrderName &&
        asksAboutExistingOrder &&
        !identifier.orderReference &&
        !identifier.email &&
        !identifier.phone
      ) {
        return this.resolveValidatedOrderConfirmation(
          session,
          originalText,
          {
            type: 'order_lookup_confirm_previous',
            order_id: validatedOrderId,
            order_name: validatedOrderName,
            identifiers: validatedIdentifiers,
          },
          false,
        );
      }

      return null;
    }

    if (
      identifier.orderReference ||
      identifier.email ||
      identifier.phone
    ) {
      return this.resolveOrderLookup(session, originalText, flow);
    }

    const directArea =
      await this.resolveDirectServiceAreaChoice(
        profile,
        activeAreas,
        originalText,
      );

    if (directArea) {
      const nextContext: Record<string, unknown> = {
        ...session.context,
        service_area: {
          id: directArea.id,
          name: directArea.name,
          description: directArea.description,
          areaType: directArea.areaType,
          selected_at: new Date().toISOString(),
          selected_automatically: true,
        },
      };

      delete nextContext.customer_service_flow;
      delete nextContext.clarification_state;

      if (directArea.areaType) {
        nextContext.conversation_category = directArea.areaType;
        nextContext.conversation_category_updated_at =
          new Date().toISOString();
      } else {
        delete nextContext.conversation_category;
        delete nextContext.conversation_category_updated_at;
      }

      const updatedSession =
        await this.conversationMemoryService.updateSession(
          session.id,
          {
            stage: 'active',
            context: nextContext,
          },
        );

      return this.chatAgentService.reply(
        profile,
        updatedSession,
        originalText,
      );
    }

    const pendingIntent =
      await this.classifyPendingOrderLookupIntent(
        originalText,
      );

    if (pendingIntent === 'leave') {
      const nextContext: Record<string, unknown> = {
        ...session.context,
      };

      delete nextContext.customer_service_flow;
      delete nextContext.service_area;
      delete nextContext.conversation_category;
      delete nextContext.conversation_category_updated_at;
      delete nextContext.clarification_state;

      const updatedSession =
        await this.conversationMemoryService.updateSession(
          session.id,
          {
            stage: 'active',
            context: nextContext,
          },
        );

      return this.chatAgentService.reply(
        profile,
        updatedSession,
        originalText,
      );
    }

    return this.resolveOrderLookup(
      session,
      originalText,
      flow,
    );
  }

  private async resolveValidatedOrderConfirmation(
    session: ConversationSession,
    originalText: string,
    flow: Record<string, unknown>,
    requireAffirmative = true,
  ): Promise<string> {
    const identifier = this.parseOrderIdentifier(originalText);

    // Si el cliente entrega un nuevo número/correo/teléfono mientras
    // confirmábamos el pedido anterior, se considera una consulta nueva.
    // No se heredan los identificadores del pedido viejo.
    if (
      identifier.orderReference ||
      identifier.email ||
      identifier.phone
    ) {
      return this.resolveOrderLookup(
        session,
        originalText,
        {
          type: 'order_lookup',
          identifiers: {},
          attempts: 0,
          updated_at: new Date().toISOString(),
        },
      );
    }

    const normalized = this.normalizeText(originalText);

    const affirmativeResponses = new Set([
      'si',
      'correcto',
      'exacto',
      'ese',
      'ese mismo',
      'esa',
      'esa misma',
      'el mismo',
      'la misma',
      'claro',
      'si ese',
      'si ese mismo',
    ]);

    const negativeResponses = new Set([
      'no',
      'no es ese',
      'no es ese pedido',
      'ese no',
      'ese no es mi pedido',
      'este no es mi pedido',
      'no es mi pedido',
      'ese pedido no es mio',
      'este pedido no es mio',
      'otro',
      'otro pedido',
      'es otro',
      'no otro',
    ]);

    const orderId = this.cleanFlowString(flow.order_id);
    const orderName = this.cleanFlowString(flow.order_name);

    if (negativeResponses.has(normalized)) {
      const now = new Date().toISOString();
      const nextContext: Record<string, unknown> = {
        ...session.context,
        conversation_category: 'service',
        conversation_category_updated_at: now,
        customer_service_flow: {
          type: 'order_lookup',
          identifiers: {},
          attempts: 0,
          updated_at: now,
        },
      };

      delete nextContext.validated_order_lookup;
      delete nextContext.last_order_lookup;

      await this.conversationMemoryService.updateSession(
        session.id,
        {
          stage: 'active',
          context: nextContext,
        },
      );

      return 'Entendido 😊 Envíame el número del pedido que deseas consultar o el correo/celular utilizado en esa compra.';
    }

    if (requireAffirmative && !affirmativeResponses.has(normalized)) {
      return orderName
        ? `Para confirmar, ¿te refieres al pedido ${orderName}? Puedes responder sí, no o enviarme el número de otro pedido.`
        : 'Confírmame si deseas continuar con el pedido que revisamos anteriormente o envíame el número de otro pedido.';
    }

    const storedIdentifiers =
      flow.identifiers &&
      typeof flow.identifiers === 'object' &&
      !Array.isArray(flow.identifiers)
        ? flow.identifiers as Record<string, unknown>
        : {};

    const lookupIdentifiers = {
      orderReference:
        this.cleanFlowString(storedIdentifiers.orderReference),
      email:
        this.cleanFlowString(storedIdentifiers.email).toLowerCase(),
      phone:
        this.cleanFlowString(storedIdentifiers.phone).replace(/\D/g, ''),
    };

    const identifierCount = [
      lookupIdentifiers.orderReference,
      lookupIdentifiers.email,
      lookupIdentifiers.phone,
    ].filter(Boolean).length;

    // Si por alguna razón el contexto histórico no conserva dos datos,
    // no confiamos ciegamente en el ancla: hacemos validación nueva.
    if (identifierCount < 2) {
      const now = new Date().toISOString();

      await this.conversationMemoryService.updateSession(
        session.id,
        {
          stage: 'active',
          context: {
            ...session.context,
            customer_service_flow: {
              type: 'order_lookup',
              identifiers: {},
              attempts: 0,
              updated_at: now,
            },
          },
        },
      );

      return 'Para proteger tus datos necesito validar nuevamente el pedido. Envíame el número del pedido y el correo o celular utilizado en la compra 😊';
    }

    let result: Record<string, any>;

    try {
      result = await this.customerOrderService.lookup(
        session.companyId,
        lookupIdentifiers,
      ) as Record<string, any>;
    } catch {
      return this.requestCustomerServiceHuman(
        session,
        'Error técnico al revalidar pedido confirmado.',
        `No fue posible revalidar de forma segura el pedido ${orderName || 'anterior'}.`,
      );
    }

    const order =
      result.ok === true &&
      result.found === true &&
      Array.isArray(result.orders) &&
      result.orders.length === 1
        ? result.orders[0] as Record<string, any>
        : null;

    const resultOrderId =
      order && typeof order.id === 'string'
        ? order.id
        : '';

    const resultOrderName =
      order && typeof order.name === 'string'
        ? order.name
        : '';

    const sameAnchoredOrder =
      Boolean(order) &&
      (
        orderId
          ? resultOrderId === orderId
          : Boolean(orderName) && resultOrderName === orderName
      );

    if (!sameAnchoredOrder || !order) {
      const now = new Date().toISOString();

      await this.conversationMemoryService.updateSession(
        session.id,
        {
          stage: 'active',
          context: {
            ...session.context,
            customer_service_flow: {
              type: 'order_lookup',
              identifiers: {},
              attempts: 0,
              updated_at: now,
            },
          },
        },
      );

      return 'No pude volver a validar ese pedido de forma segura. Envíame el número del pedido que deseas consultar y un segundo dato de validación 😊';
    }

    const now = new Date().toISOString();
    const completedContext: Record<string, unknown> = {
      ...session.context,
      conversation_category: 'service',
      conversation_category_updated_at: now,
      last_order_lookup: {
        order_id: resultOrderId,
        order_name: resultOrderName,
        found_at: now,
      },
      validated_order_lookup: {
        order_id: resultOrderId,
        order_name: resultOrderName,
        identifiers: lookupIdentifiers,
        verified_at: now,
      },
    };

    delete completedContext.customer_service_flow;

    await this.conversationMemoryService.updateSession(
      session.id,
      {
        stage: 'active',
        context: completedContext,
      },
    );

    return this.formatOrderLookupReply(
      order,
      session,
      requireAffirmative ? '' : originalText,
    );
  }

  private async classifyPendingOrderLookupIntent(
    originalText: string,
  ): Promise<'continue' | 'leave' | 'unclear'> {
    const text = originalText.replace(/\s+/g, ' ').trim();

    if (!text) {
      return 'unclear';
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return 'unclear';
    }

    try {
      const client = new OpenAI({ apiKey });
      const model =
        process.env.OPENAI_MODEL?.trim() ||
        'gpt-5-mini';

      const response = await client.responses.create({
        model,
        instructions: [
          'Clasifica únicamente la relación del mensaje actual con una consulta de pedido que había quedado pendiente.',
          'Devuelve únicamente JSON válido y sin markdown:',
          '{"intent":"continue|leave|unclear"}',
          'continue: la persona todavía quiere consultar, localizar, rastrear o revisar una compra o pedido existente.',
          'leave: la persona rechaza claramente esa consulta, indica que no tiene o no realizó una compra, cambia a otra necesidad, inicia una compra nueva, pide productos, catálogo, información comercial o plantea otro asunto diferente.',
          'unclear: el mensaje es demasiado ambiguo para confirmar si continúa o abandona la consulta pendiente.',
          'No inventes reglas comerciales ni información de la empresa.',
          'No respondas al cliente.',
        ].join('\n'),
        input: JSON.stringify({
          mensaje_actual: text,
        }),
      });

      const raw = response.output_text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(raw) as {
        intent?: unknown;
      };

      if (parsed.intent === 'continue') {
        return 'continue';
      }

      if (parsed.intent === 'leave') {
        return 'leave';
      }

      return 'unclear';
    } catch (error) {
      console.error(
        '[ChatPro][order-lookup] no se pudo clasificar continuidad:',
        error,
      );
      return 'unclear';
    }
  }

  private async resolveOrderLookup(
    session: ConversationSession,
    originalText: string,
    flow: Record<string, unknown>,
  ) {
    const identifier = this.parseOrderIdentifier(originalText);

    const previousIdentifiers =
      flow.identifiers &&
      typeof flow.identifiers === 'object' &&
      !Array.isArray(flow.identifiers)
        ? flow.identifiers as Record<string, unknown>
        : {};

    // Conservamos identificadores entregados en mensajes anteriores.
    // Un nuevo valor del mismo tipo reemplaza únicamente ese valor.
    const lookupIdentifiers = {
      orderReference:
        identifier.orderReference ||
        this.cleanFlowString(previousIdentifiers.orderReference),
      email:
        identifier.email ||
        this.cleanFlowString(previousIdentifiers.email),
      phone:
        identifier.phone ||
        this.cleanFlowString(previousIdentifiers.phone),
    };

    if (
      !lookupIdentifiers.orderReference &&
      !lookupIdentifiers.email &&
      !lookupIdentifiers.phone
    ) {
      return 'Envíame el número del pedido, correo o celular utilizado en la compra 😊';
    }

    const attemptNumber = Number(flow.attempts ?? 0) + 1;

    let result: Record<string, any>;

    try {
      result = await this.customerOrderService.lookup(
        session.companyId,
        lookupIdentifiers,
      ) as Record<string, any>;
    } catch {
      return this.requestCustomerServiceHuman(
        session,
        'Error técnico al consultar pedido.',
        `Falló la consulta segura de pedido. Datos disponibles: pedido=${lookupIdentifiers.orderReference || '-'}, email=${lookupIdentifiers.email || '-'}, phone=${lookupIdentifiers.phone || '-'}.`,
      );
    }

    const nextContext = {
      ...session.context,
      customer_service_flow: {
        type: 'order_lookup',
        identifiers: lookupIdentifiers,
        attempts: attemptNumber,
        updated_at: new Date().toISOString(),
      },
    };

    await this.conversationMemoryService.updateSession(session.id, {
      stage: 'active',
      context: nextContext,
    });

    if (
      result.ok &&
      result.found &&
      Array.isArray(result.orders) &&
      result.orders.length === 1
    ) {
      const order = result.orders[0];

      const completedContext: Record<string, unknown> = {
        ...nextContext,
        conversation_category: 'service',
        conversation_category_updated_at:
          new Date().toISOString(),
        last_order_lookup: {
          order_id: order.id,
          order_name: order.name,
          found_at: new Date().toISOString(),
        },
        validated_order_lookup: {
          order_id: order.id,
          order_name: order.name,
          identifiers: lookupIdentifiers,
          verified_at: new Date().toISOString(),
        },
      };

      delete completedContext.customer_service_flow;

      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'active',
        context: completedContext,
      });

      return this.formatOrderLookupReply(order, session);
    }

    if (result.next_action === 'ask_verification_identifier') {
      if (lookupIdentifiers.orderReference) {
        return 'Por seguridad, confirma también el correo o celular utilizado en esa compra 😊';
      }

      if (lookupIdentifiers.email) {
        return 'Por seguridad, confirma también el número del pedido o celular utilizado en esa compra 😊';
      }

      return 'Por seguridad, confirma también el número del pedido o correo utilizado en esa compra 😊';
    }

    if (result.next_action === 'ask_order_reference') {
      return 'Encontré más de un pedido asociado a esos datos. Envíame el número exacto del pedido que deseas consultar 😊';
    }

    if (result.next_action === 'ask_alternate_identifier') {
      if (!lookupIdentifiers.orderReference) {
        return 'Los datos que me enviaste no coinciden en un mismo pedido. Envíame también el número del pedido para validarlo 😊';
      }

      if (!lookupIdentifiers.email) {
        return 'Los datos que me enviaste no coinciden en un mismo pedido. Envíame también el correo utilizado en la compra para validarlo 😊';
      }

      if (!lookupIdentifiers.phone) {
        return 'Los datos que me enviaste no coinciden en un mismo pedido. Envíame también el celular utilizado en la compra para validarlo 😊';
      }
    }

    return this.requestCustomerServiceHuman(
      session,
      'No fue posible validar de forma segura el pedido.',
      `Los identificadores entregados no coincidieron con un mismo pedido. Pedido=${lookupIdentifiers.orderReference || '-'}, email=${lookupIdentifiers.email || '-'}, phone=${lookupIdentifiers.phone || '-'}. No se mostró información de ningún pedido.`,
    );
  }

  private async formatOrderLookupReply(
    order: Record<string, any>,
    session?: ConversationSession,
    customerQuestion = '',
  ) {
    const items = Array.isArray(order.items) ? order.items : [];
    const firstTracking = this.getFirstOrderTracking(order);
    const hasTracking = Boolean(firstTracking);
    const orderName = order.name ? ` ${order.name}` : '';
    const customerName = this.getOrderCustomerName(order);
    const lines: string[] = [];
    const profile = await this.getSessionCompanyProfile(session);
    const normalizedQuestion = this.normalizeText(customerQuestion);
    const fulfillmentMessage =
      this.customerOrderFulfillmentStatusMessage(order, hasTracking);

    const asksCarrier =
      /\btransportadora\b/.test(normalizedQuestion);

    const asksTracking =
      /\b(guia|seguimiento)\b/.test(normalizedQuestion) ||
      /\brastre\w*/.test(normalizedQuestion);

    const asksOrderTotal =
      /\bcuanto pague\b/.test(normalizedQuestion) ||
      /\bque pague\b/.test(normalizedQuestion) ||
      /\b(total|valor) (de|del) (mi )?(pedido|compra)\b/.test(
        normalizedQuestion,
      );

    const asksOrderProducts =
      /\bque productos? compre\b/.test(normalizedQuestion) ||
      /\bque compre\b/.test(normalizedQuestion) ||
      /\blo que compre\b/.test(normalizedQuestion) ||
      (
        /\bproductos?\b/.test(normalizedQuestion) &&
        /\b(mi )?(pedido|compra)\b/.test(normalizedQuestion)
      );

    const asksPaymentMethod =
      /\bcomo pague\b/.test(normalizedQuestion) ||
      /\bcon que pague\b/.test(normalizedQuestion) ||
      /\bmedio de pago (use|utilice)\b/.test(normalizedQuestion);

    const asksPaymentStatus =
      /\b(ya )?(pague|pagado)\b/.test(normalizedQuestion) ||
      /\bpago (confirmado|aprobado)\b/.test(normalizedQuestion);

    const asksDeliveryStatus =
      /\bentreg\w*/.test(normalizedQuestion) ||
      /\b(en transito|en reparto|llego|llegado|estado del pedido|donde esta)\b/.test(
        normalizedQuestion,
      );

    if (normalizedQuestion && asksOrderTotal) {
      const total = this.formatOrderMoney(order.total);

      if (!total) {
        return 'No tengo disponible el total de ese pedido en la información recibida.';
      }

      const financialStatus =
        this.normalizeOrderStatus(order.financial_status);

      return financialStatus === 'paid'
        ? `Pagaste ${total}.`
        : `El total del pedido es ${total}.`;
    }

    if (normalizedQuestion && asksOrderProducts) {
      if (!items.length) {
        return 'No tengo disponible el detalle de productos de ese pedido.';
      }

      const productSummary = items
        .slice(0, 20)
        .map((item) => {
          const title =
            this.cleanCustomerText(item.title || 'Producto');
          const quantity = Number(item.quantity ?? 1);
          const variant = item.variant_title
            ? ` - ${this.cleanCustomerText(item.variant_title)}`
            : '';

          return `• ${title}${variant} x${quantity}`;
        })
        .join('\n');

      return `Productos de tu pedido:\n${productSummary}`;
    }

    if (normalizedQuestion && asksCarrier) {
      const company = firstTracking
        ? this.cleanCustomerText(firstTracking.company || '')
        : '';

      return company
        ? `La transportadora de tu pedido es ${company}.`
        : 'No tengo disponible la transportadora de ese pedido en la información recibida.';
    }

    if (normalizedQuestion && asksPaymentMethod) {
      const paymentMessage =
        this.customerPaymentStatusMessage(order.financial_status);

      return paymentMessage
        ? `${paymentMessage} No tengo disponible el medio de pago utilizado en la información recibida.`
        : 'No tengo disponible el medio de pago utilizado en la información recibida.';
    }

    if (normalizedQuestion && asksPaymentStatus) {
      return (
        this.customerPaymentStatusMessage(order.financial_status) ||
        'No tengo disponible un estado de pago más específico para ese pedido.'
      );
    }

    if (normalizedQuestion && asksTracking) {
      const trackingLines: string[] = [];

      if (fulfillmentMessage) {
        trackingLines.push(fulfillmentMessage);
      }

      if (firstTracking) {
        trackingLines.push(
          this.formatConfiguredTrackingReply(firstTracking, profile),
        );
      } else {
        trackingLines.push(
          orderName
            ? `El pedido${orderName} no tiene una guía disponible en la información recibida.`
            : 'El pedido no tiene una guía disponible en la información recibida.',
        );
      }

      return trackingLines.join('\n\n').trim();
    }

    if (normalizedQuestion && asksDeliveryStatus) {
      return (
        fulfillmentMessage ||
        'En este momento no tengo un estado de entrega más específico para este pedido.'
      );
    }

    if (customerName) {
      lines.push(
        `Perfecto 😊 encontré tu pedido${orderName} a nombre de ${customerName}.`,
      );
    } else {
      lines.push(`Perfecto 😊 encontré tu pedido${orderName}.`);
    }

    const paymentMessage = this.customerPaymentStatusMessage(
      order.financial_status,
    );

    if (paymentMessage) {
      lines.push(paymentMessage);
    }

    if (fulfillmentMessage) {
      lines.push(fulfillmentMessage);
    }

    const total = this.formatOrderMoney(order.total);

    if (items.length) {
      const productSummary = items
        .slice(0, 6)
        .map((item) => {
          const title = this.cleanCustomerText(item.title || 'Producto');
          const quantity = Number(item.quantity ?? 1);
          const variant = item.variant_title
            ? ` - ${this.cleanCustomerText(item.variant_title)}`
            : '';

          return `• ${title}${variant} x${quantity}`;
        })
        .join('\n');

      lines.push(`Productos:\n${productSummary}`);
    }

    if (total) {
      lines.push(`Total del pedido: ${total}`);
    }

    if (firstTracking) {
      lines.push(this.formatConfiguredTrackingReply(firstTracking, profile));
    } else if (this.normalizeOrderStatus(order.fulfillment_status) === 'fulfilled') {
      lines.push(
        'Tu pedido aparece como despachado, pero en este momento no tengo la guía disponible en la información recibida. Puedo dejarlo con un asesor para revisarla.',
      );
    } else {
      lines.push(
        'Cuando el pedido sea despachado, se registrará la guía de seguimiento.',
      );
    }

    return lines.join('\n\n').trim();
  }


  private async getSessionCompanyProfile(session?: ConversationSession) {
    const companyId =
      (session as any)?.companyId ||
      (session as any)?.company_id ||
      '';

    if (!companyId) {
      return undefined;
    }

    try {
      return await this.conversationMemoryService.getCompanyProfileById(companyId);
    } catch {
      return undefined;
    }
  }

  private formatConfiguredTrackingReply(
    tracking: Record<string, any>,
    profile?: CompanyProfile,
  ) {
    const config = this.findConfiguredCarrier(tracking.company, profile);
    const rawCompany = this.cleanCustomerText(tracking.company || '');
    const trackingNumber = this.cleanCustomerText(tracking.number || '');
    const genericCompany = [
      'other',
      'otro',
      'unknown',
      'desconocido',
      'transportadora registrada por la tienda',
      'transportadora del pedido',
    ].includes(this.normalizeCarrierKey(rawCompany));
    const visibleCompany =
      config?.displayName || (genericCompany ? '' : rawCompany);
    const configuredUrl = config?.trackingUrl || '';
    const trackingUrl =
      configuredUrl || this.extractBaseTrackingUrl(String(tracking.url || ''));
    const instructions =
      config?.instructions ||
      this.getShippingTrackingFallbackInstructions(profile);

    const trackingLines = ['Información de envío:'];

    if (visibleCompany) {
      trackingLines.push(`Transportadora: ${visibleCompany}`);
    } else {
      trackingLines.push('Transportadora registrada por la tienda.');
    }

    if (trackingNumber) {
      trackingLines.push(`Guía: ${trackingNumber}`);
    }

    if (trackingUrl) {
      trackingLines.push('', 'Para hacer seguimiento, ingresa aquí:', trackingUrl);
    }

    if (instructions) {
      trackingLines.push('', instructions);
    }

    if (trackingNumber) {
      trackingLines.push('', 'Copia esta guía y consulta:', trackingNumber);
    }

    return trackingLines.join('\n');
  }

  private findConfiguredCarrier(company: unknown, profile?: CompanyProfile) {
    const rawCompany = this.cleanCustomerText(String(company || ''));
    const companyKey = this.normalizeCarrierKey(rawCompany);

    if (!companyKey || !profile) {
      return null;
    }

    const settings = profile.settings?.shipping_tracking;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return null;
    }

    const source = settings as Record<string, any>;

    if (source.enabled !== true) {
      return null;
    }

    const carriers = Array.isArray(source.carriers) ? source.carriers : [];

    for (const item of carriers) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const carrier = item as Record<string, any>;

      if (carrier.isActive === false) {
        continue;
      }

      const displayName = this.cleanCustomerText(carrier.displayName || '');
      const trackingUrl = this.cleanCustomerText(carrier.trackingUrl || '');
      const instructions = this.cleanCustomerText(carrier.instructions || '');
      const aliases = this.splitCarrierAliases(carrier.aliases);

      const possibleNames = [displayName, ...aliases]
        .map((value) => this.normalizeCarrierKey(value))
        .filter(Boolean);

      if (possibleNames.includes(companyKey)) {
        return {
          displayName,
          trackingUrl: this.extractBaseTrackingUrl(trackingUrl) || trackingUrl,
          instructions,
        };
      }
    }

    return null;
  }

  private splitCarrierAliases(value: unknown) {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .flatMap((item) => this.splitCarrierAliases(item));
    }

    if (typeof value !== 'string') {
      return [];
    }

    return value
      .split(/[\n,;]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private getShippingTrackingFallbackInstructions(profile?: CompanyProfile) {
    const defaultInstructions =
      'Ingresa al enlace principal de la transportadora, busca seguimiento o rastreo, copia la guía y consulta el estado.';

    const settings = profile?.settings?.shipping_tracking;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return defaultInstructions;
    }

    const source = settings as Record<string, any>;
    const configured =
      typeof source.fallbackInstructions === 'string'
        ? source.fallbackInstructions.trim()
        : '';

    return configured || defaultInstructions;
  }

  private extractBaseTrackingUrl(value: string) {
    const raw = value.trim();

    if (!raw) {
      return '';
    }

    try {
      const url = new URL(raw);
      return url.origin;
    } catch {
      return raw.replace(/\/+$/, '');
    }
  }

  private normalizeCarrierKey(value: unknown) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private getFirstOrderTracking(order: Record<string, any>) {
    const tracking = Array.isArray(order.tracking) ? order.tracking : [];

    return tracking.find(
      (item) => item?.number || item?.url || item?.company,
    );
  }

  private getOrderCustomerName(order: Record<string, any>) {
    const customerName = this.cleanCustomerText(order.customer?.name || '');
    const shippingName = this.cleanCustomerText(order.shipping_address?.name || '');
    const name = customerName || shippingName;

    return name.length > 70 ? name.slice(0, 70).trim() : name;
  }

  private customerPaymentStatusMessage(status: unknown) {
    switch (this.normalizeOrderStatus(status)) {
      case 'paid':
        return 'Tu pago ya aparece confirmado.';
      case 'pending':
        return 'Tu pago todavía aparece pendiente de confirmación.';
      case 'authorized':
        return 'Tu pago aparece autorizado y está en proceso de confirmación.';
      case 'partially_paid':
        return 'El pedido aparece con pago parcial.';
      case 'refunded':
        return 'El pedido aparece reembolsado.';
      case 'partially_refunded':
        return 'El pedido aparece con un reembolso parcial.';
      case 'voided':
        return 'El pago aparece anulado.';
      default:
        return '';
    }
  }

  private customerOrderFulfillmentStatusMessage(
    order: Record<string, any>,
    hasTracking: boolean,
  ) {
    const fulfillments =
      Array.isArray(order.fulfillments) ? order.fulfillments : [];

    const displayStatuses = fulfillments
      .map((fulfillment) =>
        this.normalizeOrderStatus(fulfillment?.displayStatus),
      )
      .filter(Boolean);

    const delivered =
      fulfillments.some((fulfillment) =>
        Boolean(this.cleanCustomerText(fulfillment?.deliveredAt || '')),
      ) ||
      displayStatuses.some(
        (status) => status === 'delivered' || status === 'entregado',
      );

    if (delivered) {
      return 'Tu pedido ya aparece como entregado.';
    }

    if (displayStatuses.includes('out_for_delivery')) {
      return 'Tu pedido aparece en reparto para entrega.';
    }

    if (displayStatuses.includes('in_transit')) {
      return 'Tu pedido aparece en tránsito.';
    }

    if (displayStatuses.includes('ready_for_pickup')) {
      return 'Tu pedido aparece listo para recoger.';
    }

    if (displayStatuses.includes('attempted_delivery')) {
      return 'El pedido registra un intento de entrega.';
    }

    if (displayStatuses.includes('failure')) {
      return 'El envío presenta una novedad que requiere revisión.';
    }

    return this.customerFulfillmentStatusMessage(
      order.fulfillment_status,
      hasTracking,
    );
  }

  private customerFulfillmentStatusMessage(status: unknown, hasTracking: boolean) {
    switch (this.normalizeOrderStatus(status)) {
      case 'fulfilled':
        return hasTracking
          ? 'Tu pedido ya fue despachado.'
          : 'Tu pedido aparece como despachado.';
      case 'partial':
      case 'partially_fulfilled':
        return 'Tu pedido aparece parcialmente despachado.';
      case 'unfulfilled':
      case 'restocked':
        return 'Tu pedido está en preparación.';
      case 'on_hold':
        return 'Tu pedido está en revisión antes del despacho.';
      case 'scheduled':
        return 'Tu pedido está programado para despacho.';
      case 'request_declined':
        return 'El despacho del pedido requiere revisión.';
      default:
        return '';
    }
  }

  private formatOrderMoney(value: unknown) {
    if (!value || typeof value !== 'object') {
      return '';
    }

    const money = value as { amount?: unknown; currencyCode?: unknown };
    const amount = Number(money.amount);
    const currency = String(money.currencyCode || 'COP').trim() || 'COP';

    if (!Number.isFinite(amount)) {
      return '';
    }

    return `${new Intl.NumberFormat('es-CO', {
      maximumFractionDigits: 0,
    }).format(amount)} ${currency}`;
  }

  private normalizeOrderStatus(status: unknown) {
    return String(status || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  private cleanCustomerText(value: unknown) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }


  private async requestCustomerServiceHuman(
    session: ConversationSession,
    reason: string,
    summary: string,
  ) {
    await this.conversationMemoryService.requestHumanAttention(session.id, {
      reason,
      summary,
    });

    return 'Claro, voy a dejar tu solicitud para que un asesor continúe contigo. Ya queda con el contexto de lo que revisamos 😊';
  }

  private readCustomerServiceFlow(context: Record<string, unknown>) {
    const flow = context.customer_service_flow;

    return flow && typeof flow === 'object' && !Array.isArray(flow)
      ? flow as Record<string, unknown>
      : {};
  }

  private parseOrderIdentifier(value: string) {
    const text = value.trim();
    const emailMatch =
      text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

    let orderReference = '';
    let phone = '';

    // 1. Un número precedido por # se interpreta primero como pedido.
    const hashOrderMatch = text.match(/#\s*(\d{3,12})\b/);

    if (hashOrderMatch) {
      orderReference = hashOrderMatch[1];
    }

    // 2. También reconocemos expresiones explícitas:
    // "pedido 45312", "número de pedido 45312", "orden 45312".
    // No confundimos frases como "número de pedido no sé".
    if (!orderReference) {
      const orderLabelMatch = text.match(
        /\b(?:pedido|orden|order)\b(?:\s+(?:n[uú]mero|nro\.?))?\s*[:#-]?\s*#?\s*(\d{3,12})\b/i,
      );

      if (orderLabelMatch) {
        orderReference = orderLabelMatch[1];
      }
    }

    // 3. Teléfono expresamente identificado por el cliente.
    const phoneLabelMatch = text.match(
      /(?:celular|tel[eé]fono|whatsapp|m[oó]vil)\s*(?:es|:|-)?\s*(\+?\d(?:[\s().-]*\d){8,14})/i,
    );

    if (phoneLabelMatch) {
      const candidate = phoneLabelMatch[1].replace(/\D/g, '');

      if (candidate.length >= 10 && candidate.length <= 15) {
        phone = candidate;
      }
    }

    // 4. Detectamos un teléfono de 10 dígitos o un número con prefijo
    // internacional aunque el mensaje también contenga correo u otro texto.
    if (!phone) {
      const numericCandidates =
        text.match(/\+?\d(?:[\s().-]*\d){8,16}/g) ?? [];

      for (const rawCandidate of numericCandidates) {
        const candidate = rawCandidate.replace(/\D/g, '');
        const hasExplicitPlus = rawCandidate.trim().startsWith('+');

        if (
          candidate.length === 10 ||
          (hasExplicitPlus &&
            candidate.length >= 10 &&
            candidate.length <= 15) ||
          (candidate.length === 12 && candidate.startsWith('57'))
        ) {
          // No reutilizamos como teléfono el mismo valor que ya fue
          // identificado explícitamente como número de pedido.
          if (candidate !== orderReference) {
            phone = candidate;
            break;
          }
        }
      }
    }

    // 5. Cuando el mensaje contiene solamente un número corto,
    // lo tratamos como referencia de pedido.
    if (!orderReference) {
      const bareNumeric = text.match(/^\s*#?\s*(\d+)\s*$/);

      if (bareNumeric) {
        const digits = bareNumeric[1];

        if (digits.length >= 3 && digits.length <= 9) {
          orderReference = digits;
        } else if (
          !phone &&
          (
            digits.length === 10 ||
            (digits.length === 12 && digits.startsWith('57'))
          )
        ) {
          phone = digits;
        }
      }
    }

    return {
      orderReference,
      email: emailMatch ? emailMatch[0].toLowerCase() : '',
      phone,
    };
  }

  private cleanFlowString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private includesAny(value: string, needles: string[]) {
    return needles.some((needle) => value.includes(this.normalizeText(needle)));
  }

  private humanizeOrderStatus(value: unknown) {
    const status = typeof value === 'string' ? value.trim() : '';

    if (!status) {
      return 'Sin dato';
    }

    return status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  private normalizeText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }


  private buildServiceAreaMenu(
    profile: CompanyProfile,
    areas: Array<{ id: string; name: string; description: string }>,
    _session: ConversationSession,
  ): string {
    const assistantName =
      profile.assistantName?.trim() || 'nuestro asistente';
    const configuredWelcome = this.getCommercialWelcome(profile.settings);
    const welcome = this.applyWelcomeTokens(
      configuredWelcome ||
        `Hola, soy ${assistantName} de ${profile.name}. ¿En qué te podemos ayudar?`,
      profile,
      assistantName,
    );

    if (!areas.length) {
      return welcome;
    }

    const options = areas
      .map((area, index) => `${index + 1}. ${area.name}`)
      .join('\n');

    return `${welcome}\n\n${options}\n\nRespóndeme con el número o el nombre de la opción.`;
  }

  private getCommercialWelcome(
    settings: Record<string, unknown>,
  ): string {
    const flow =
      settings.commercial_flow &&
      typeof settings.commercial_flow === 'object' &&
      !Array.isArray(settings.commercial_flow)
        ? settings.commercial_flow as Record<string, unknown>
        : {};

    return typeof flow.welcome_message === 'string'
      ? flow.welcome_message.trim()
      : '';
  }

  private applyWelcomeTokens(
    value: string,
    profile: CompanyProfile,
    assistantName: string,
    areaName = '',
  ): string {
    return value
      .replace(/\{asistente\}/gi, assistantName)
      .replace(/\{empresa\}/gi, profile.name)
      .replace(/\{area\}/gi, areaName)
      .trim();
  }

  private buildAreaWelcome(
    profile: CompanyProfile,
    areaName: string,
    _session: ConversationSession,
  ): string {
    const flow =
      profile.settings.commercial_flow &&
      typeof profile.settings.commercial_flow === 'object' &&
      !Array.isArray(profile.settings.commercial_flow)
        ? profile.settings.commercial_flow as Record<string, unknown>
        : {};
    const configured =
      typeof flow.area_welcome_message === 'string'
        ? flow.area_welcome_message.trim()
        : '';
    const assistantName =
      profile.assistantName?.trim() || 'nuestro asistente';

    return this.applyWelcomeTokens(
      configured ||
        `Perfecto 😊 Cuéntame qué necesitas en ${areaName}.`,
      profile,
      assistantName,
      areaName,
    );
  }

  private getDeliveryStatuses(body: unknown): Array<{
    messageId: string;
    status: string;
    timestamp: string | null;
    recipient: string | null;
    error: string | null;
  }> {
    const root = body as any;
    const entries = Array.isArray(root?.entry) ? root.entry : [];
    const results: Array<{
      messageId: string;
      status: string;
      timestamp: string | null;
      recipient: string | null;
      error: string | null;
    }> = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes)
        ? entry.changes
        : [];

      for (const change of changes) {
        const statuses = Array.isArray(change?.value?.statuses)
          ? change.value.statuses
          : [];

        for (const item of statuses) {
          const messageId =
            typeof item?.id === 'string' ? item.id.trim() : '';
          const status =
            typeof item?.status === 'string'
              ? item.status.trim().toLowerCase()
              : '';

          if (!messageId || !status) {
            continue;
          }

          const timestampSeconds = Number(item?.timestamp);
          const timestamp = Number.isFinite(timestampSeconds)
            ? new Date(timestampSeconds * 1000).toISOString()
            : null;
          const recipient =
            typeof item?.recipient_id === 'string'
              ? item.recipient_id.trim()
              : null;
          const errors = Array.isArray(item?.errors)
            ? item.errors
            : [];
          const firstError = errors[0] ?? null;
          const errorData =
            firstError?.error_data &&
            typeof firstError.error_data === 'object'
              ? firstError.error_data
              : {};
          const errorParts = [
            firstError?.code,
            firstError?.title,
            firstError?.message,
            errorData?.details,
          ]
            .map((value) =>
              typeof value === 'string' || typeof value === 'number'
                ? String(value).trim()
                : '',
            )
            .filter(Boolean);

          results.push({
            messageId,
            status,
            timestamp,
            recipient,
            error: errorParts.length
              ? errorParts.join(' · ').slice(0, 700)
              : null,
          });
        }
      }
    }

    return results;
  }

  private getIncomingButtonText(message: any): string {
    if (message?.type === 'button') {
      const text =
        typeof message?.button?.text === 'string'
          ? message.button.text.trim()
          : '';
      const payload =
        typeof message?.button?.payload === 'string'
          ? message.button.payload.trim()
          : '';

      return text || payload;
    }

    if (message?.type === 'interactive') {
      const buttonReply = message?.interactive?.button_reply;
      const listReply = message?.interactive?.list_reply;
      const title =
        typeof buttonReply?.title === 'string'
          ? buttonReply.title.trim()
          : typeof listReply?.title === 'string'
            ? listReply.title.trim()
            : '';
      const id =
        typeof buttonReply?.id === 'string'
          ? buttonReply.id.trim()
          : typeof listReply?.id === 'string'
            ? listReply.id.trim()
            : '';

      return title || id;
    }

    return '';
  }

  private getIncomingMessage(body: any) {
    return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null;
  }

  private getReplyToProviderMessageId(
    message: any,
  ): string | null {
    const contextId = message?.context?.id;

    return typeof contextId === 'string' && contextId.trim()
      ? contextId.trim()
      : null;
  }

  private getIncomingMessageId(message: any): string | null {
    const rawMessageId = message?.id;

    return typeof rawMessageId === 'string' && rawMessageId.trim()
      ? rawMessageId.trim()
      : null;
  }

  private getIncomingPhoneNumberId(body: any): string {
    const rawPhoneNumberId =
      body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    const phoneNumberId =
      typeof rawPhoneNumberId === 'string' ? rawPhoneNumberId.trim() : '';

    if (!phoneNumberId) {
      throw new Error(
        'Meta no envió el identificador del canal de WhatsApp.',
      );
    }

    return phoneNumberId;
  }

}
