import { canArchiveAnsweredHumanChat, isInstagramNativeOutgoingEcho } from './social-inbox-rules';

describe('Native Instagram outgoing reply sync', () => {
  it('accepts an Instagram native reply when the business is the sender', () => {
    expect(isInstagramNativeOutgoingEcho('business','business','customer',false)).toBe(true);
  });
  it('accepts explicit outgoing echo events', () => {
    expect(isInstagramNativeOutgoingEcho('business','other','customer',true)).toBe(true);
  });
  it('does not misclassify customer messages as business replies', () => {
    expect(isInstagramNativeOutgoingEcho('business','customer','business',false)).toBe(false);
    expect(isInstagramNativeOutgoingEcho('business','business','business',true)).toBe(false);
    expect(isInstagramNativeOutgoingEcho('business','customer','customer',false)).toBe(false);
  });
});

describe('12-hour archive condition', () => {
  const cutoff = '2026-11-20T00:00:00.000Z';
  it('allows a last advisor reply older than 12h', () => {
    expect(canArchiveAnsweredHumanChat({author_type:'advisor',created_at:'2026-11-19T22:00:00.000Z'},cutoff)).toBe(true);
  });
  it('retains any conversation where the customer spoke last', () => {
    expect(canArchiveAnsweredHumanChat({author_type:'customer',created_at:'2026-11-19T21:00:00.000Z'},cutoff)).toBe(false);
  });
  it('retains AI or recently answered chats', () => {
    expect(canArchiveAnsweredHumanChat({author_type:'ai',created_at:'2026-11-19T21:00:00.000Z'},cutoff)).toBe(false);
    expect(canArchiveAnsweredHumanChat({author_type:'advisor',created_at:'2026-11-20T01:00:00.000Z'},cutoff)).toBe(false);
  });
  it('rejects unknown or malformed timestamps', () => {
    expect(canArchiveAnsweredHumanChat(null,cutoff)).toBe(false);
    expect(canArchiveAnsweredHumanChat({author_type:'advisor',created_at:'not-a-date'},cutoff)).toBe(false);
  });
});
