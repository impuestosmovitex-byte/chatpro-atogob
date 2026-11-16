import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { InboxController } from './inbox.controller';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConversationMemoryService } from './conversation-memory.service';
import { SupabaseService } from './supabase.service';
import { WhatsappMessagingService } from './whatsapp-messaging.service';
import { ChatAgentService } from './chat-agent.service';
import { MetaSocialInboxService } from './meta-social-inbox.service';
import { MetaSocialMessagingService } from './meta-social-messaging.service';

const TENANT = 'synthetic-tenant-a';
const FOREIGN_TENANT = 'synthetic-tenant-b';
const SESSION = 'synthetic-social-session';
const MESSAGE = 'synthetic-social-message';
const INTERNAL_KEY = 'synthetic-inbox-key';

type Scenario = {
  membership?: boolean;
  permission?: boolean;
  mediaUrl?: string;
  mediaExists?: boolean;
  companyId?: string;
};

function scenario(options: Scenario = {}) {
  const cfg = {
    membership: true,
    permission: true,
    mediaUrl: 'synthetic/social/asset.png',
    mediaExists: true,
    companyId: TENANT,
    ...options,
  };
  const mediaQueries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const storageDownload = jest.fn().mockResolvedValue({
    data: {
      type: 'image/png',
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    },
    error: null,
  });
  const from = jest.fn((table: string) => {
    const state: { table: string; filters: Record<string, unknown> } = {
      table, filters: {},
    };
    mediaQueries.push(state);
    const query: any = {
      select: () => query,
      eq: (field: string, value: unknown) => {
        state.filters[field] = value;
        return query;
      },
      in: () => query,
      maybeSingle: async () => {
        if (table === 'company_memberships') {
          return { data: cfg.membership ? { active: true, role_id: 'synthetic-role' } : null, error: null };
        }
        if (table === 'social_conversations') {
          const isScoped = state.filters.company_id === TENANT &&
            state.filters.session_id === SESSION &&
            state.filters.id === MESSAGE;
          return { data: cfg.mediaExists && isScoped
            ? { id: MESSAGE, media_url: cfg.mediaUrl, message_type: 'image' }
            : null, error: null };
        }
        throw new Error('Unexpected maybeSingle: ' + table);
      },
      then: (accept: (value: unknown) => unknown) => {
        if (table === 'app_role_permissions') {
          return Promise.resolve({ data: [{ permission_id: 'synthetic-permission' }], error: null }).then(accept);
        }
        if (table === 'app_permissions') {
          return Promise.resolve({ data: cfg.permission ? [{ key: 'inbox.view' }] : [], error: null }).then(accept);
        }
        throw new Error('Unexpected query: ' + table);
      },
    };
    return query;
  });
  const db = {
    from,
    storage: { from: jest.fn(() => ({ download: storageDownload })) },
  };
  const conversationMemoryService = {
    getCompanyProfile: jest.fn(async () => ({ id: cfg.companyId, slug: 'synthetic', name: 'Synthetic company' })),
  };
  const metaSocialInboxService = {
    getConversation: jest.fn(async () => ({
      company: { id: cfg.companyId, slug: 'synthetic', name: 'Synthetic company' },
      session: { id: SESSION, companyId: cfg.companyId, attentionStatus: 'human', assignedToUserId: 'other-advisor' },
    })),
  };
  const controller = new InboxController(
    conversationMemoryService as any,
    { getClient: () => db } as any,
    {} as any,
    {} as any,
    metaSocialInboxService as any,
    {} as any,
  );
  const response = {
    setHeader: jest.fn(),
    send: jest.fn((data: unknown) => data),
  };
  const call = (headerCompanyId = TENANT, userId = 'synthetic-advisor') =>
    controller.getMessageMedia(
      INTERNAL_KEY,
      'user',
      userId,
      'Synthetic Advisor',
      headerCompanyId,
      'advisor',
      'synthetic',
      SESSION,
      MESSAGE,
      response as any,
    );
  return { cfg, call, from, db, mediaQueries, storageDownload, response, metaSocialInboxService, conversationMemoryService };
}

describe('social attachment controller, synthetic integration', () => {
  const oldKey = process.env.CHATPRO_INBOX_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.CHATPRO_INBOX_KEY = INTERNAL_KEY;
    global.fetch = jest.fn() as typeof fetch;
  });
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(() => {
    if (oldKey === undefined) delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY = oldKey;
    global.fetch = originalFetch;
  });

  it('serves a tenant-scoped storage file to a member with inbox.view', async () => {
    const x = scenario();
    const result = await x.call();
    expect(Buffer.from(result as Buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(x.storageDownload).toHaveBeenCalledWith('synthetic/social/asset.png');
    expect(x.response.send).toHaveBeenCalledTimes(1);
    expect(x.mediaQueries.find(q => q.table === 'social_conversations')?.filters)
      .toEqual({ id: MESSAGE, session_id: SESSION, company_id: TENANT });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows another adviser with inbox.view to read, consistent with shared inbox policy', async () => {
    const x = scenario();
    await expect(x.call(TENANT, 'another-synthetic-advisor')).resolves.toBeDefined();
  });

  it('rejects a header from the wrong company before querying messages', async () => {
    const x = scenario();
    await expect(x.call(FOREIGN_TENANT)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(x.mediaQueries.some(q => q.table === 'social_conversations')).toBe(false);
    expect(x.storageDownload).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive membership before querying messages', async () => {
    const x = scenario({ membership: false });
    await expect(x.call()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(x.mediaQueries.some(q => q.table === 'social_conversations')).toBe(false);
    expect(x.storageDownload).not.toHaveBeenCalled();
  });

  it('rejects an adviser without inbox.view before querying messages', async () => {
    const x = scenario({ permission: false });
    await expect(x.call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(x.mediaQueries.some(q => q.table === 'social_conversations')).toBe(false);
    expect(x.storageDownload).not.toHaveBeenCalled();
  });

  it('does not serve a message that does not match company/session/message', async () => {
    const x = scenario({ mediaExists: false });
    await expect(x.call()).rejects.toBeInstanceOf(BadRequestException);
    expect(x.storageDownload).not.toHaveBeenCalled();
  });

  it('downloads a synthetic remote file only from validated Meta origin without redirect', async () => {
    const x = scenario({ mediaUrl: 'https://scontent.xx.fbcdn.net/synthetic/image.png' });
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(Uint8Array.from([4, 5, 6]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '3' },
      }),
    );
    const result = await x.call();
    expect(Buffer.from(result as Buffer)).toEqual(Buffer.from([4, 5, 6]));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBe('manual');
    expect(x.storageDownload).not.toHaveBeenCalled();
  });

  it('blocks URL pointing at arbitrary or private host without fetching', async () => {
    const x = scenario({ mediaUrl: 'https://localhost/synthetic/image.png' });
    await expect(x.call()).rejects.toBeInstanceOf(BadRequestException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks Meta redirect without following target', async () => {
    const x = scenario({ mediaUrl: 'https://graph.facebook.com/synthetic/image.png' });
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }),
    );
    await expect(x.call()).rejects.toBeInstanceOf(BadRequestException);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(x.response.send).not.toHaveBeenCalled();
  });

  it('blocks response that exceeds media size budget before materializing it', async () => {
    const x = scenario({ mediaUrl: 'https://scontent.xx.fbcdn.net/synthetic/image.png' });
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('synthetic', {
        status: 200,
        headers: { 'content-length': String(16 * 1024 * 1024) },
      }),
    );
    await expect(x.call()).rejects.toBeInstanceOf(BadRequestException);
    expect(x.response.send).not.toHaveBeenCalled();
  });
});

/**
 * These tests exercise the actual Nest HTTP routing and error translation
 * using in-memory synthetic providers. No port is exposed, no real DB,
 * no Meta credentials, no file network access, no Railway deployment.
 */
describe('social attachment HTTP in-memory pilot preflight', () => {
  let app: INestApplication | undefined;
  const originalKey = process.env.CHATPRO_INBOX_KEY;
  const originalFetch = global.fetch;
  const mediaPath = '/inbox/' + SESSION + '/messages/' + MESSAGE + '/media';

  const headers = (companyId = TENANT) => ({
    'x-chatpro-inbox-key': INTERNAL_KEY,
    'x-chatpro-session-type': 'user',
    'x-chatpro-user-id': 'synthetic-advisor',
    'x-chatpro-user-name': 'Synthetic Advisor',
    'x-chatpro-company-id': companyId,
    'x-chatpro-role-key': 'advisor',
  });

  const setup = async (options: Scenario = {}) => {
    const x = scenario(options);
    const module = await Test.createTestingModule({
      controllers: [InboxController],
      providers: [
        { provide: ConversationMemoryService, useValue: x.conversationMemoryService },
        { provide: SupabaseService, useValue: { getClient: () => x.db } },
        { provide: WhatsappMessagingService, useValue: {} },
        { provide: ChatAgentService, useValue: {} },
        { provide: MetaSocialInboxService, useValue: x.metaSocialInboxService },
        { provide: MetaSocialMessagingService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    return x;
  };

  beforeEach(() => {
    process.env.CHATPRO_INBOX_KEY = INTERNAL_KEY;
    // Fail closed if code attempts real network egress in any test.
    global.fetch = jest.fn(() => Promise.reject(new Error('Outbound traffic forbidden in synthetic test'))) as typeof fetch;
  });
  afterEach(async () => {
    if (app) { await app.close(); app = undefined; }
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY = originalKey;
  });

  it('GET returns the synthetic storage bytes with proper tenant and inbox.view', async () => {
    const x = await setup();
    const reply = await request(app!.getHttpServer())
      .get(mediaPath).query({company:'synthetic'}).set(headers());
    expect(reply.status).toBe(200);
    expect(Buffer.from(reply.body)).toEqual(Buffer.from([1, 2, 3]));
    expect(x.storageDownload).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('GET without internal authentication key returns 401 before storage', async () => {
    const x = await setup();
    const h: Record<string, string> = headers();
    delete h['x-chatpro-inbox-key'];
    const reply = await request(app!.getHttpServer())
      .get(mediaPath).query({company:'synthetic'}).set(h);
    expect(reply.status).toBe(401);
    expect(x.storageDownload).not.toHaveBeenCalled();
  });

  it('GET with a tenant header from another company returns 401', async () => {
    const x = await setup();
    const reply = await request(app!.getHttpServer())
      .get(mediaPath).query({company:'synthetic'}).set(headers(FOREIGN_TENANT));
    expect(reply.status).toBe(401);
    expect(x.storageDownload).not.toHaveBeenCalled();
    expect(x.mediaQueries.some(q => q.table === 'social_conversations')).toBe(false);
  });

  it('GET without inbox.view returns 403 and does not access media', async () => {
    const x = await setup({permission:false});
    const reply = await request(app!.getHttpServer())
      .get(mediaPath).query({company:'synthetic'}).set(headers());
    expect(reply.status).toBe(403);
    expect(x.storageDownload).not.toHaveBeenCalled();
  });

  it('GET rejects fake media URL without any remote request', async () => {
    const x = await setup({mediaUrl:'https://127.0.0.1/private-file'});
    const reply = await request(app!.getHttpServer())
      .get(mediaPath).query({company:'synthetic'}).set(headers());
    expect(reply.status).toBe(400);
    expect(x.storageDownload).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
