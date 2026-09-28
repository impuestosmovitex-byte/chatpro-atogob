import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type Integration = {
  id?: string;
  key?: string;
  integrationType?: string;
  name?: string;
  status?: string;
};

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error(
      'Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.',
    );
  }

  return { apiBase, inboxKey };
}

function channelLabel(channel: string) {
  if (channel === 'instagram') return 'Instagram';
  if (channel === 'messenger') return 'Messenger';
  return 'WhatsApp';
}

export async function GET(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();

    const target = new URL(`${apiBase}/integrations`);
    target.searchParams.set('company', session.companySlug);

    const response = await fetch(target, {
      headers: {
        'x-chatpro-inbox-key': inboxKey,
      },
      cache: 'no-store',
    });

    const data = (await response.json()) as {
      ok?: boolean;
      error?: string;
      integrations?: Integration[];
    };

    if (!response.ok || !data.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            data.error ||
            'No se pudieron consultar los canales conectados.',
        },
        { status: response.status || 500 },
      );
    }

    const supported = new Set([
      'whatsapp',
      'instagram',
      'messenger',
    ]);

    const channels = (data.integrations ?? [])
      .filter((integration) => {
        const channel = integration.integrationType ?? '';

        if (!supported.has(channel)) {
          return false;
        }

        /*
         * Una integración activa puede mostrarse con estado "error"
         * cuando existe pero tiene un problema técnico temporal.
         * No debe desaparecer de la Bandeja por eso.
         */
        return (
          integration.status === 'active' ||
          (integration.status === 'error' && Boolean(integration.id))
        );
      })
      .map((integration) => {
        const channel =
          integration.integrationType as
            | 'whatsapp'
            | 'instagram'
            | 'messenger';

        return {
          id: integration.id || integration.key || channel,
          channel,
          label: channelLabel(channel),
        };
      });

    return NextResponse.json({
      ok: true,
      channels,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar los canales.',
      },
      { status: 500 },
    );
  }
}
