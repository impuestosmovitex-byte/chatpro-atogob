import {
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';

import { AutomationRuntimeService } from './automation-runtime.service';
import { CartRecoveryContextService } from './cart-recovery-context.service';
import { ChatAgentService } from './chat-agent.service';
import { CompanyIntegrationService } from './company-integration.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { CustomerOrderService } from './customer-order.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import { WhatsappTemplateExecutionService } from './whatsapp-template-execution.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

type JsonObject = Record<string, unknown>;

/**
 * WhatsApp Cloud API can deliver more than one inbound message inside the
 * same webhook payload. The legacy controller intentionally handles one
 * message at a time, so this adapter fans a batch out into single-message
 * payloads and delegates each one to the existing, battle-tested flow.
 *
 * This is especially important when a customer sends an album / several
 * photos quickly: no image should disappear just because Meta grouped them
 * in one webhook request.
 */
@Controller('webhook/whatsapp')
export class WhatsappMultiMessageController extends WhatsappWebhookController {
  constructor(
    chatAgentService: ChatAgentService,
    automationRuntimeService: AutomationRuntimeService,
    conversationMemoryService: ConversationMemoryService,
    companyIntegrationService: CompanyIntegrationService,
    whatsappMessagingService: WhatsappMessagingService,
    whatsappTemplateExecutionService: WhatsappTemplateExecutionService,
    cartRecoveryContextService: CartRecoveryContextService,
    customerOrderService: CustomerOrderService,
  ) {
    super(
      chatAgentService,
      automationRuntimeService,
      conversationMemoryService,
      companyIntegrationService,
      whatsappMessagingService,
      whatsappTemplateExecutionService,
      cartRecoveryContextService,
      customerOrderService,
    );
  }

  @Post()
  @HttpCode(200)
  override async receiveMessage(
    @Body() body: unknown,
  ) {
    const singleMessageBodies =
      this.splitIncomingMessageBodies(body);

    if (singleMessageBodies.length <= 1) {
      return super.receiveMessage(body);
    }

    // Apply delivery/read statuses only once. Each single-message payload
    // below removes statuses to avoid processing the same status N times.
    await super.receiveMessage(
      this.withoutIncomingMessages(body),
    );

    for (const singleMessageBody of singleMessageBodies) {
      await super.receiveMessage(singleMessageBody);
    }

    console.log(
      `[ChatPro][WhatsApp] lote entrante procesado mensajes=${singleMessageBodies.length}`,
    );

    return 'EVENT_RECEIVED';
  }

  private splitIncomingMessageBodies(
    bodyInput: unknown,
  ): unknown[] {
    const body = this.record(bodyInput);
    const entries = Array.isArray(body.entry)
      ? body.entry
      : [];

    const result: unknown[] = [];

    for (const rawEntry of entries) {
      const entry = this.record(rawEntry);
      const changes = Array.isArray(entry.changes)
        ? entry.changes
        : [];

      for (const rawChange of changes) {
        const change = this.record(rawChange);
        const value = this.record(change.value);
        const messages = Array.isArray(value.messages)
          ? value.messages
          : [];

        for (const rawMessage of messages) {
          const message = this.record(rawMessage);

          if (!Object.keys(message).length) {
            continue;
          }

          result.push({
            ...body,
            entry: [
              {
                ...entry,
                changes: [
                  {
                    ...change,
                    value: {
                      ...value,
                      messages: [message],
                      statuses: [],
                    },
                  },
                ],
              },
            ],
          });
        }
      }
    }

    return result;
  }

  private withoutIncomingMessages(
    bodyInput: unknown,
  ): unknown {
    const body = this.record(bodyInput);
    const entries = Array.isArray(body.entry)
      ? body.entry
      : [];

    return {
      ...body,
      entry: entries.map((rawEntry) => {
        const entry = this.record(rawEntry);
        const changes = Array.isArray(entry.changes)
          ? entry.changes
          : [];

        return {
          ...entry,
          changes: changes.map((rawChange) => {
            const change = this.record(rawChange);
            const value = this.record(change.value);

            return {
              ...change,
              value: {
                ...value,
                messages: [],
              },
            };
          }),
        };
      }),
    };
  }

  private record(value: unknown): JsonObject {
    return value &&
      typeof value === 'object' &&
      !Array.isArray(value)
      ? value as JsonObject
      : {};
  }
}
