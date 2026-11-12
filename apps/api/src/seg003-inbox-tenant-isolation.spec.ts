/**
 * SEG-003 — Offline tenant/role authorization regression tests.
 *
 * All companies, roles, sessions, contacts and messages below are synthetic.
 * No real Supabase keys, credentials, HTTP requests, or database writes.
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { InboxController } from './inbox.controller';
import { ConversationMemoryService } from './conversation-memory.service';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const COMPANY_A = 'company-fixture-alpha';
const COMPANY_B = 'company-fixture-beta';
const USER_A = 'user-fixture-alpha';
const USER_B = 'user-fixture-beta';

/** Minimal PostgREST-like in-memory query with audit of every tenant filter. */
function fakeSupabase(tables: Tables) {
  const queries: Array<{ table: string; filters: Array<{ field: string; value: any }> }> = [];

  return {
    queries,
    getClient: () => ({
      from(table: string) {
        const entry = { table, filters: [] as Array<{ field: string; value: any }> };
        queries.push(entry);
        let limit = Number.MAX_SAFE_INTEGER;
        const result = () => {
          let rows = [...(tables[table] ?? [])];
          for (const filter of entry.filters) {
            rows = rows.filter(row =>
              Array.isArray(filter.value)
                ? filter.value.includes(row[filter.field])
                : row[filter.field] === filter.value,
            );
          }
          return { data: rows.slice(0, limit), error: null };
        };
        const query: any = {
          select: () => query,
          eq: (field: string, value: any) => {
            entry.filters.push({ field, value });
            return query;
          },
          in: (field: string, values: any[]) => {
            entry.filters.push({ field, value: values });
            return query;
          },
          order: () => query,
          limit: (value: number) => {
            limit = value;
            return query;
          },
          maybeSingle: async () => {
            const { data } = result();
            return { data: data[0] ?? null, error: null };
          },
          then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject),
        };
        return query;
      },
    }),
  };
}

function actorFixture(options: {
  effectiveRole?: 'owner' | 'admin' | 'advisor';
  activeMembership?: boolean;
  activeProfile?: boolean;
  inboxView?: boolean;
  membershipCompany?: string;
} = {}) {
  const effectiveRole = options.effectiveRole ?? 'advisor';
  const roleId = 'role-' + effectiveRole;
  const store = fakeSupabase({
    company_memberships: [{
      company_id: options.membershipCompany ?? COMPANY_A,
      user_id: USER_A,
      role_id: roleId,
      active: options.activeMembership !== false,
    }],
    app_profiles: [{ user_id: USER_A, active: options.activeProfile !== false }],
    app_roles: [{ id: roleId, key: effectiveRole }],
    app_role_permissions: options.inboxView === false
      ? []
      : [{ role_id: roleId, permission_id: 'perm-inbox-view' }],
    app_permissions: [{ id: 'perm-inbox-view', key: 'inbox.view' }],
  });
  const controller: any = Object.create(InboxController.prototype);
  controller.supabaseService = store;
  const actor = (claim: string, company = COMPANY_A) =>
    controller.actor('user', USER_A, 'Asesor Ficticio', company, claim, company);
  return { actor, queries: store.queries };
}

function session(companyId: string, id: string, phone: string): Row {
  return {
    id, company_id: companyId, customer_phone: phone, stage: 'main',
    context: {}, last_message_at: '2026-11-12T15:00:00Z',
    pending_count: 0, pending_since: null, attention_status: 'ai',
    assigned_to_user_id: null, assigned_to_name: null, taken_at: null, closed_at: null,
  };
}

function conversationFixture() {
  const store = fakeSupabase({
    conversation_sessions: [
      session(COMPANY_A, 'session-alpha', '573001111111'),
      session(COMPANY_B, 'session-beta', '573002222222'),
    ],
    conversations: [
      {
        id: 'msg-alpha', company_id: COMPANY_A, session_id: 'session-alpha',
        message: 'Mensaje privado Alfa', sender: 'customer',
        author_type: 'customer', message_type: 'text', created_at: '2026-11-12T15:00:00Z',
      },
      {
        id: 'msg-beta', company_id: COMPANY_B, session_id: 'session-beta',
        message: 'Mensaje privado Beta', sender: 'customer',
        author_type: 'customer', message_type: 'text', created_at: '2026-11-12T15:01:00Z',
      },
      // Deliberately inconsistent fixture: same session id but wrong owner.
      // The company_id predicate must still keep this record out.
      {
        id: 'wrong-company-message', company_id: COMPANY_B, session_id: 'session-alpha',
        message: 'NO DEBE FILTRARSE A ALFA', sender: 'customer',
        author_type: 'customer', message_type: 'text', created_at: '2026-11-12T15:02:00Z',
      },
    ],
    automation_executions: [],
    contacts: [],
  });
  const memory: any = Object.create(ConversationMemoryService.prototype);
  memory.supabaseService = store;
  memory.getCompanyProfile = jest.fn(async (slug: string) => ({
    id: slug === 'alpha' ? COMPANY_A : COMPANY_B,
    slug,
    name: slug === 'alpha' ? 'Compañía Alfa Ficticia' : 'Compañía Beta Ficticia',
    assistantName: null,
    settings: {},
    aiInstructions: '',
  }));
  memory.getContactsByPhones = jest.fn(async () => new Map());
  return { memory, queries: store.queries };
}

describe('SEG-003 — roles derivados de membresía activa (dos empresas ficticias)', () => {
  it('un asesor NO escala privilegios declarando owner en su encabezado', async () => {
    const { actor, queries } = actorFixture({ effectiveRole: 'advisor' });
    const result = await actor('owner');
    expect(result.isFullAccess).toBe(false);
    expect(result.permissions.has('inbox.view')).toBe(true);
    expect(queries.find(q => q.table === 'app_roles')?.filters).toContainEqual({
      field: 'id', value: 'role-advisor',
    });
  });

  it('un propietario real conserva acceso completo aunque el encabezado diga advisor', async () => {
    const { actor } = actorFixture({ effectiveRole: 'owner' });
    await expect(actor('advisor')).resolves.toMatchObject({ isFullAccess: true });
  });

  it('el rol admin real conserva acceso completo', async () => {
    const { actor } = actorFixture({ effectiveRole: 'admin' });
    await expect(actor('advisor')).resolves.toMatchObject({ isFullAccess: true });
  });

  it('se rechaza una membresía revocada aunque exista sesión anterior', async () => {
    const { actor } = actorFixture({ activeMembership: false, effectiveRole: 'owner' });
    await expect(actor('owner')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('se rechaza el perfil desactivado aunque tenga membresía y permiso', async () => {
    const { actor } = actorFixture({ activeProfile: false, effectiveRole: 'owner' });
    await expect(actor('owner')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('se deniega el acceso sin el permiso inbox.view', async () => {
    const { actor } = actorFixture({ inboxView: false });
    await expect(actor('owner')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('usuario de Alfa no puede hacerse pasar por miembro de Beta', async () => {
    const { actor } = actorFixture({ membershipCompany: COMPANY_A, effectiveRole: 'owner' });
    await expect(actor('owner', COMPANY_B)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('SEG-003 — aislamiento de historial con dos empresas ficticias', () => {
  it('la sesión de Beta no es accesible desde Alfa aunque conozcan su ID', async () => {
    const { memory, queries } = conversationFixture();
    await expect(memory.getInboxConversation('alpha', 'session-beta'))
      .rejects.toThrow('La conversación no existe para esta empresa.');
    const check = queries.find(q => q.table === 'conversation_sessions');
    expect(check?.filters).toContainEqual({ field: 'company_id', value: COMPANY_A });
    expect(queries.some(q => q.table === 'conversations')).toBe(false);
  });

  it('Alfa recibe sus mensajes, nunca los de Beta ni registros de dueño inconsistente', async () => {
    const { memory, queries } = conversationFixture();
    const result = await memory.getInboxConversation('alpha', 'session-alpha');
    expect(result.company.id).toBe(COMPANY_A);
    expect(result.messages.map((m: any) => m.message)).toEqual(['Mensaje privado Alfa']);
    const reads = queries.filter(q => q.table === 'conversations');
    expect(reads).toHaveLength(1);
    expect(reads[0].filters).toContainEqual({ field: 'company_id', value: COMPANY_A });
  });

  it('Beta conserva su propia conversación y no ve mensajes de Alfa', async () => {
    const { memory } = conversationFixture();
    const result = await memory.getInboxConversation('beta', 'session-beta');
    expect(result.company.id).toBe(COMPANY_B);
    expect(result.messages.map((m: any) => m.message)).toEqual(['Mensaje privado Beta']);
  });
});
