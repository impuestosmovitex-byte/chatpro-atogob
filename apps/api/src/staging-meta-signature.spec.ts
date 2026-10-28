import { createHmac } from 'node:crypto';
import { validMetaSignature } from './staging-meta-signature';

describe('Meta staging webhook signature', () => {
  const secret = 'test-only-secret-not-for-production';
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', 'utf8');
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  it('accepts signature of identical original bytes', () => {
    expect(validMetaSignature(body, signature, secret)).toBe(true);
  });
  it('rejects tampered contents, wrong secrets and malformed signatures', () => {
    expect(validMetaSignature(Buffer.from('different'), signature, secret)).toBe(false);
    expect(validMetaSignature(body, signature, 'another-secret-long-enough')).toBe(false);
    expect(validMetaSignature(body, 'sha256=bad', secret)).toBe(false);
    expect(validMetaSignature(body, undefined, secret)).toBe(false);
  });
});
