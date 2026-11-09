import { isKnownInstagramWebhookApp } from './staging-integrations.controller';

describe('Instagram webhook subscription app identification', () => {
  const knownIds = ['1079916404666757', '1674184274384954'];

  it('matches the Instagram platform app nested under application.id', () => {
    expect(isKnownInstagramWebhookApp({
      application: { id: '1674184274384954', name: 'MW1 Chat Pro' },
      subscribed_fields: ['messages'],
    }, knownIds)).toBe(true);
  });

  it('supports flat Meta application IDs for backward compatibility', () => {
    expect(isKnownInstagramWebhookApp({
      id: '1079916404666757',
      subscribed_fields: ['messages'],
    }, knownIds)).toBe(true);
  });

  it('never accepts unrelated apps, even when subscribed to messages', () => {
    expect(isKnownInstagramWebhookApp({
      application: { id: '123456789', name: 'Another app' },
      subscribed_fields: ['messages'],
    }, knownIds)).toBe(false);
  });

  it('does not trust app name or a missing identifier', () => {
    expect(isKnownInstagramWebhookApp({
      application: { name: 'MW1 Chat Pro' },
      subscribed_fields: ['messages'],
    }, knownIds)).toBe(false);
  });
});
