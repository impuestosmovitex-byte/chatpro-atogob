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
  it('never processes inbound messages yet', () => {
    expect(() => controller.receive()).toThrow(/deshabilitada/);
  });
});
