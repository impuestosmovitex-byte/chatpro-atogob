import { createHmac } from 'node:crypto';
import { StagingWhatsappWebhookController } from './staging-whatsapp-webhook.controller';
import { SupabaseService } from './supabase.service';

describe('staging WhatsApp verification isolation', () => {
  let matches: Array<{company_id:string;status:string}> = [];
  let queryCount = 0;
  const db = {from: (_table:string) => {
    queryCount++;
    const query = {
      select: (_s:string) => query,
      eq: (_k:string,_v:string) => query,
      limit: async (_n:number) => ({ data:matches, error:null }),
    };
    return query;
  }};
  const controller = new StagingWhatsappWebhookController({getClient:()=>db} as unknown as SupabaseService);
  const original = process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN;
  const originalSecret = process.env.META_WHATSAPP_APP_SECRET;
  const valid = 'staging-test-only-verify-token-123456789';
  const secret = 'staging-fixture-secret-123456789';
  const body = {object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456789'}}}]}]};
  const rawBody=Buffer.from(JSON.stringify(body));
  const signature='sha256='+createHmac('sha256',secret).update(rawBody).digest('hex');
  beforeEach(() => { process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN = valid; process.env.META_WHATSAPP_APP_SECRET=secret; matches=[];queryCount=0; });
  afterAll(() => {
    if (original === undefined) delete process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN;
    else process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN = original;
    if (originalSecret === undefined) delete process.env.META_WHATSAPP_APP_SECRET;
    else process.env.META_WHATSAPP_APP_SECRET = originalSecret;
  });
  it('returns a valid verification challenge', () => expect(controller.verify('subscribe',valid,'123456')).toBe('123456'));
  it('rejects invalid verification', () => expect(()=>controller.verify('subscribe','wrong','123456')).toThrow());
  it('rejects missing signatures before any database read', async () => {
    await expect(controller.receive()).rejects.toThrow(/Firma Meta no válida/);
    expect(queryCount).toBe(0);
  });
  it('rejects unknown phone after valid signature', async () => {
    await expect(controller.receive({rawBody,body} as any,signature)).rejects.toThrow(/empresa autorizada única/);
  });
  it('rejects duplicate phone assignments', async () => {
    matches=[{company_id:'tenant-a',status:'active'},{company_id:'tenant-b',status:'active'}];
    await expect(controller.receive({rawBody,body} as any,signature)).rejects.toThrow(/empresa autorizada única/);
  });
  it('does not process a valid signed, tenant-owned event', async () => {
    matches=[{company_id:'tenant-a',status:'active'}];
    await expect(controller.receive({rawBody,body} as any,signature)).rejects.toThrow(/deshabilitada/);
  });
});
