import { createHmac } from 'node:crypto';
import { StagingWhatsappWebhookController } from './staging-whatsapp-webhook.controller';

describe('staging WhatsApp verification isolation', () => {
  const controller = new StagingWhatsappWebhookController();
  const original = process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN;
  const valid = 'staging-test-only-verify-token-123456789';
  beforeEach(() => { process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN = valid; });
  afterAll(() => {
    if (original === undefined) delete process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN;
    else process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN = original;
  });
  it('returns the challenge only for a matching token', () => {
    expect(controller.verify('subscribe', valid, '123456')).toBe('123456');
  });
  it('rejects wrong tokens and modes', () => {
    expect(() => controller.verify('subscribe', 'wrong', '123456')).toThrow();
    expect(() => controller.verify('other', valid, '123456')).toThrow();
  });
  it('rejects missing verifier configuration', () => {
    delete process.env.MW1_STAGING_WHATSAPP_VERIFY_TOKEN;
    expect(() => controller.verify('subscribe', valid, '123456')).toThrow();
  });
  it('rejects missing signatures before processing inbound messages', () => {
    expect(() => controller.receive()).toThrow(/Firma Meta no válida/);
  });
  it('still blocks real processing after valid signature', () => {
    const previous = process.env.META_WHATSAPP_APP_SECRET;
    const secret = 'staging-fixture-secret-123456789';
    const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
    const signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    process.env.META_WHATSAPP_APP_SECRET = secret;
    try {
      expect(() => controller.receive({rawBody} as any, signature)).toThrow(/deshabilitada/);
    } finally {
      if (previous === undefined) delete process.env.META_WHATSAPP_APP_SECRET;
      else process.env.META_WHATSAPP_APP_SECRET = previous;
    }
  });
});
