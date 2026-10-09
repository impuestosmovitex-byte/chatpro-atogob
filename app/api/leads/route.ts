import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type LeadClient = {
  customerPhone?: string;
  lastMessageAt?: string;
  contact?: {
    id?: string;
    tags?: string[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

type LeadRegistryResponse = {
  ok?: boolean;
  error?: string;
  company?: { id?: string; slug?: string; name?: string };
  clients?: LeadClient[];
  leadStatuses?: string[];
};

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

function trustedHeaders(
  inboxKey: string,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
) {
  const headers: Record<string, string> = {
    'x-chatpro-inbox-key': inboxKey,
    'x-chatpro-session-type': session.type,
    'x-chatpro-user-name': session.fullName,
    'x-chatpro-company-id': session.companyId,
    'x-chatpro-role-key': session.roleKey,
  };

  if (session.type === 'user' && session.userId) {
    headers['x-chatpro-user-id'] = session.userId;
  }

  return headers;
}

async function getSession(request?: NextRequest) {
  if (!request) return null;
  return getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();
    const requestedLimit = request.nextUrl.searchParams.get('limit')?.trim();
    const limit = requestedLimit || '5000';

    async function fetchTag(tag: string): Promise<LeadRegistryResponse> {
      const target = new URL(`${apiBase}/lead-registry`);
      target.searchParams.set('company', session.companySlug);
      target.searchParams.set('tag', tag);
      target.searchParams.set('limit', limit);

      const response = await fetch(target, {
        headers: trustedHeaders(inboxKey, session),
        cache: 'no-store',
      });

      const payload = (await response.json()) as LeadRegistryResponse;

      if (!response.ok || payload.ok !== true) {
        throw new Error(
          payload.error || `No se pudieron consultar los leads ${tag}.`,
        );
      }

      return payload;
    }

    const [effix, metaAds] = await Promise.all([
      fetchTag('EFFIX-2026'),
      fetchTag('META-ADS'),
    ]);

    const byContact = new Map<string, LeadClient>();

    for (const client of [...(effix.clients ?? []), ...(metaAds.clients ?? [])]) {
      const contactId = client.contact?.id?.trim() || '';
      const phone =
        typeof client.customerPhone === 'string'
          ? client.customerPhone.trim()
          : '';
      const key = contactId || phone;

      if (!key) continue;

      const current = byContact.get(key);

      if (!current) {
        byContact.set(key, client);
        continue;
      }

      const currentTags = Array.isArray(current.contact?.tags)
        ? current.contact?.tags ?? []
        : [];
      const nextTags = Array.isArray(client.contact?.tags)
        ? client.contact?.tags ?? []
        : [];

      byContact.set(key, {
        ...current,
        ...client,
        contact: client.contact
          ? {
              ...(current.contact ?? {}),
              ...client.contact,
              tags: Array.from(new Set([...currentTags, ...nextTags])),
            }
          : current.contact,
      });
    }

    return NextResponse.json({
      ok: true,
      company: effix.company ?? metaAds.company,
      clients: Array.from(byContact.values()).sort((left, right) => {
        const leftTime = Date.parse(
          typeof left.lastMessageAt === 'string' ? left.lastMessageAt : '',
        );
        const rightTime = Date.parse(
          typeof right.lastMessageAt === 'string' ? right.lastMessageAt : '',
        );

        return (Number.isFinite(rightTime) ? rightTime : 0) -
          (Number.isFinite(leftTime) ? leftTime : 0);
      }),
      leadStatuses: Array.from(
        new Set([...(effix.leadStatuses ?? []), ...(metaAds.leadStatuses ?? [])]),
      ),
      sources: ['EFFIX 2026', 'Meta Ads'],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron consultar los leads.',
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();
    const body = (await request.json()) as {
      contactId?: unknown;
      phone?: unknown;
      status?: unknown;
      source?: unknown;
    };

    const source =
      typeof body.source === 'string' ? body.source.trim().toLowerCase() : '';
    const isMetaAds = source === 'meta_ads';
    const target = isMetaAds
      ? `${apiBase}/meta-ads-leads/status`
      : `${apiBase}/lead-registry/status`;

    const response = await fetch(target, {
      method: 'PATCH',
      headers: {
        ...trustedHeaders(inboxKey, session),
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        isMetaAds
          ? {
              company: session.companySlug,
              contactId: body.contactId,
              status: body.status,
            }
          : {
              company: session.companySlug,
              phone: body.phone,
              status: body.status,
            },
      ),
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo actualizar el estado del lead.',
      },
      { status: 500 },
    );
  }
}
