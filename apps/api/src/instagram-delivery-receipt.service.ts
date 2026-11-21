import { Injectable } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { CompanyIntegrationService } from './company-integration.service';
import { parseInstagramReceipts, type SocialReceipt } from './instagram-receipt-parser';

/**
 * Persist only actual Instagram delivery/read receipts. A Graph API send
 * response is NOT proof of delivery, and customer replies are NOT read receipts.
 */
@Injectable()
export class InstagramDeliveryReceiptService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly integrations: CompanyIntegrationService,
  ) {}

  async capture(body: unknown): Promise<void> {
    const receipts = parseInstagramReceipts(body);
    if (!receipts.length) return;
    const accountMap = new Map<string, string | null>();

    for (const receipt of receipts) {
      try {
        let companyId = accountMap.get(receipt.accountId);
        if (companyId === undefined) {
          const integration = await this.integrations.findActiveIntegrationByExternalId(
            'meta', 'instagram', receipt.accountId,
          );
          companyId = integration?.companyId || null;
          accountMap.set(receipt.accountId, companyId);
        }
        if (!companyId) continue;
        const affected = await this.updateReceipt(companyId, receipt);
        console.log(
          `[MW1][instagram-receipt] type=${receipt.kind} messages=${affected} account=${receipt.accountId}`,
        );
      } catch (error) {
        console.error('[MW1][instagram-receipt] Error procesando confirmación:', error);
      }
    }
  }

  private async updateReceipt(companyId: string, receipt: SocialReceipt): Promise<number> {
    const client = this.supabase.getClient();
    const now = new Date().toISOString();
    const patch = receipt.kind === 'read'
      ? { delivery_status: 'read', read_at: now, delivered_at: now }
      : { delivery_status: 'delivered', delivered_at: now };

    let query = client
      .from('social_conversations')
      .update(patch)
      .eq('company_id', companyId)
      .eq('channel', 'instagram')
      .eq('external_customer_id', receipt.customerId)
      .in('author_type', ['advisor', 'assistant'])
      .not('provider_message_id', 'is', null);

    if (receipt.mids.length) {
      query = query.in('provider_message_id', receipt.mids);
    } else if (receipt.watermark) {
      query = query
        .lte('created_at', receipt.watermark)
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
    } else {
      return 0;
    }

    // A late delivery receipt must never downgrade a message already read.
    if (receipt.kind === 'delivered') {
      query = query.or('delivery_status.is.null,delivery_status.eq.sent,delivery_status.eq.delivered');
    }

    const { data, error } = await query.select('id');
    if (error) throw new Error(`No se pudo guardar estado Meta: ${error.message}`);
    return data?.length || 0;
  }
}
