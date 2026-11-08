import { instagramWebhookBusinessIds } from './staging-instagram-webhook.controller';

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
