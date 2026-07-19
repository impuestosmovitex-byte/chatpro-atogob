import { NextRequest, NextResponse } from "next/server";
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from "../../lib/inbox-auth";

export const dynamic = "force-dynamic";

type PushAction = "subscribe" | "unsubscribe" | "test";

type PushRequestBody = {
  action?: unknown;
  subscription?: unknown;
  endpoint?: unknown;
  userAgent?: unknown;
  platform?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, "");
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error(
      "Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.",
    );
  }

  return { apiBase, inboxKey };
}

async function currentSession(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  return session?.type === "user" && session.userId ? session : null;
}

function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Las notificaciones requieren iniciar sesión con un usuario individual.",
    },
    { status: 401 },
  );
}

function trustedHeaders(
  inboxKey: string,
  session: NonNullable<Awaited<ReturnType<typeof currentSession>>>,
) {
  return {
    "content-type": "application/json",
    "x-chatpro-inbox-key": inboxKey,
    "x-chatpro-session-type": session.type,
    "x-chatpro-user-id": session.userId ?? "",
    "x-chatpro-user-name": session.fullName,
    "x-chatpro-company-id": session.companyId,
    "x-chatpro-role-key": session.roleKey,
  };
}

async function proxyResponse(response: Response) {
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const response = await fetch(`${apiBase}/push-notifications/config`, {
      headers: trustedHeaders(inboxKey, session),
      cache: "no-store",
    });

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo consultar la configuración de notificaciones.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await currentSession(request);

  if (!session) {
    return unauthorized();
  }

  try {
    const { apiBase, inboxKey } = config();
    const body = (await request.json()) as PushRequestBody;
    const action = text(body.action) as PushAction;
    const allowedActions: PushAction[] = [
      "subscribe",
      "unsubscribe",
      "test",
    ];

    if (!allowedActions.includes(action)) {
      return NextResponse.json(
        { ok: false, error: "Acción de notificación no válida." },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${apiBase}/push-notifications/${action}`,
      {
        method: "POST",
        headers: trustedHeaders(inboxKey, session),
        body: JSON.stringify({
          subscription:
            body.subscription &&
            typeof body.subscription === "object" &&
            !Array.isArray(body.subscription)
              ? body.subscription
              : null,
          endpoint: text(body.endpoint),
          userAgent: text(body.userAgent).slice(0, 900),
          platform: text(body.platform).slice(0, 200),
        }),
        cache: "no-store",
      },
    );

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo procesar la configuración de notificaciones.",
      },
      { status: 500 },
    );
  }
}
