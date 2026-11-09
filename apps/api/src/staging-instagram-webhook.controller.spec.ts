import { instagramWebhookBusinessIds } from './staging-instagram-webhook.controller';
import { createHmac } from 'node:crypto';
import { validMetaSignature } from './staging-meta-signature';

describe('Instagram staging webhook tenant candidate selection', () => {
  const event = {
    object: 'instagram',
    entry: [{ id: '17841400000000123', messaging: [{
      sender: { id: '9876543210123456' },
      recipient: { id: '17841400000000123' },
      timestamp: 1700000000000,
      message: { mid: 'mid.test-1', text: 'Hola' },
    }] }],
  };

  it('extracts only the professional account, not the sender', () => {
    expect(instagramWebhookBusinessIds(event)).toEqual(['17841400000000123']);
  });

  it('rejects recipient mismatch rather than routing to a guessed tenant', () => {
    const mismatched = JSON.parse(JSON.stringify(event));
    mismatched.entry[0].messaging[0].recipient.id = '17841400000000999';
    expect(instagramWebhookBusinessIds(mismatched)).toEqual([]);
  });

  it('detects multiple account destinations to fail closed in the controller', () => {
    const second = JSON.parse(JSON.stringify(event.entry[0]));
    second.id = '17841400000000999';
    second.messaging[0].recipient.id = second.id;
    expect(instagramWebhookBusinessIds({object:'instagram', entry:[event.entry[0], second]}))
      .toEqual(['17841400000000123', '17841400000000999']);
  });

  it('rejects missing or malformed Instagram event payloads', () => {
    expect(instagramWebhookBusinessIds({object:'page',entry:event.entry})).toEqual([]);
    expect(instagramWebhookBusinessIds({object:'instagram',entry:'bad'})).toEqual([]);
    expect(instagramWebhookBusinessIds({object:'instagram',entry:[{id:'x',messaging:[]}]})).toEqual([]);
    expect(instagramWebhookBusinessIds({object:'instagram',entry:[{id:'17841400000000123'}]})).toEqual([]);
  });
});

describe('Instagram pilot signed webhook', () => {
  const secret = 'test-signature-secret-with-sufficient-entropy';
  const bytes = Buffer.from(JSON.stringify({
    object:'instagram',entry:[{id:'17841400000000123',
      messaging:[{sender:{id:'9876543210123456'},
        recipient:{id:'17841400000000123'},
        message:{mid:'mid.test-1',text:'Hola'}}]}],
  }));
  const signature = 'sha256=' + createHmac('sha256',secret).update(bytes).digest('hex');

  it('accepts a correctly signed body from Meta', () => {
    expect(validMetaSignature(bytes,signature,secret)).toBe(true);
  });

  it('rejects a modified body without an updated signature', () => {
    expect(validMetaSignature(Buffer.concat([bytes,Buffer.from(' ')]),signature,secret))
      .toBe(false);
  });

  it('rejects absent and malformed signatures', () => {
    expect(validMetaSignature(bytes,undefined,secret)).toBe(false);
    expect(validMetaSignature(bytes,'sha1=abc',secret)).toBe(false);
  });
});
