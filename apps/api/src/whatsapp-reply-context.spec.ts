import { whatsappQuotedReplyContext } from './whatsapp-reply-context';

describe('WhatsApp quoted reply context', () => {
  it('keeps an ordinary outgoing message unquoted', () => {
    expect(whatsappQuotedReplyContext()).toEqual({});
    expect(whatsappQuotedReplyContext('  ')).toEqual({});
  });
  it('uses the exact Meta message ID selected by the advisor', () => {
    expect(whatsappQuotedReplyContext(' wamid.sample ')).toEqual({
      context: { message_id: 'wamid.sample' },
    });
  });
});
