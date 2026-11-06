import { AutomationRuntimeService } from './automation-runtime.service';
import { SupabaseService } from './supabase.service';

type FakeExecution = {
  id: string;
  company_id: string;
  automation_key: string;
  status: string;
  attempt_count: number;
  sent_at: string | null;
  payload: Record<string, unknown>;
};

function setup(execution: FakeExecution) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: jest.fn((_table: string) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({ data: execution, error: null })),
        })),
      })),
      update: jest.fn((data: Record<string, unknown>) => ({
        eq: jest.fn(async () => {
          updates.push(data);
          return { error: null };
        }),
      })),
    })),
  };
  const runtime = new AutomationRuntimeService(
    { getClient: () => db } as unknown as SupabaseService,
  );
  const apply = (status: string, error: string | null = null) =>
    runtime.applyProviderStatus({
      messageId: 'wamid.test-123',
      status,
      timestamp: '2026-11-06T20:00:00.000Z',
      recipient: '573000000000',
      error,
    });
  return { apply, updates, db };
}

const completed = (providerStatus = 'accepted'): FakeExecution => ({
  id: 'execution-1',
  company_id: 'company-1',
  automation_key: 'order_created',
  status: 'sent',
  attempt_count: 1,
  sent_at: '2026-11-06T19:59:00.000Z',
  payload: { provider_status: providerStatus },
});

describe('AutomationRuntimeService Meta delivery callbacks', () => {
  it('does not reopen a completed automation when Meta reports sent', async () => {
    const { apply, updates } = setup(completed());
    expect(await apply('sent')).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('sent');
    expect(updates[0]).not.toHaveProperty('locked_at');
  });

  it('records Meta failed after accepted sent without retry scheduling', async () => {
    const { apply, updates } = setup(completed('sent'));
    expect(await apply('failed', '131026: Message undeliverable')).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('failed');
    expect(updates[0].next_retry_at).toBeNull();
    expect(updates[0].error_message).toContain('131026');
  });

  it('stores a delivery confirmation', async () => {
    const { apply, updates } = setup(completed('sent'));
    expect(await apply('delivered')).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('sent');
    expect((updates[0].payload as Record<string, unknown>).provider_status).toBe('delivered');
  });

  it('does not regress read to delivered or sent', async () => {
    const { apply, updates } = setup(completed('read'));
    expect(await apply('delivered')).toBe(true);
    expect(await apply('sent')).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it('does not overwrite a confirmed delivery with a late failure', async () => {
    const { apply, updates } = setup(completed('delivered'));
    expect(await apply('failed', 'late error')).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it('does not clear a terminal failed state with a late sent', async () => {
    const { apply, updates } = setup({ ...completed('failed'), status: 'failed' });
    expect(await apply('sent')).toBe(true);
    expect(updates).toHaveLength(0);
  });
});
