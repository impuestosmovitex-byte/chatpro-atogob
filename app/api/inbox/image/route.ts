import { NextRequest, NextResponse } from "next/server";
import { INBOX_SESSION_COOKIE, getInboxSession } from "../../../lib/inbox-auth";

export const dynamic = "force-dynamic";

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, "");
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error("Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.");
  }

  return { apiBase, inboxKey };
}

function trustedHeaders(
  inboxKey: string,
  session: NonNullable<Awaited<ReturnType<typeof getInboxSession>>>,
) {
  const headers: Record<string, string> = {
    "x-chatpro-inbox-key": inboxKey,
    "x-chatpro-session-type": session.type,
    "x-chatpro-user-name": session.fullName,
    "x-chatpro-company-id": session.companyId,
    "x-chatpro-role-key": session.roleKey,
  };

  if (session.type === "user" && session.userId) {
    headers["x-chatpro-user-id"] = session.userId;
  }

  return headers;
}

export async function POST(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Sesión requerida." },
      { status: 401 },
    );
  }

  try {
    const incoming = await request.formData();
    const sessionId = String(incoming.get("sessionId") ?? "").trim();
    const image = incoming.get("image");
    const caption = String(incoming.get("caption") ?? "").trim();

    if (!sessionId || !(image instanceof File) || !image.size) {
      return NextResponse.json(
        { ok: false, error: "Falta la imagen o la conversación." },
        { status: 400 },
      );
    }

    if (image.size > 8 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "La imagen supera el límite de 8 MB." },
        { status: 400 },
      );
    }

    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
        image.type,
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Formato no permitido. Usa JPG, PNG o WEBP." },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(
      `${apiBase}/inbox/${encodeURIComponent(sessionId)}/image`,
    );
    target.searchParams.set("company", session.companySlug);

    const payload = new FormData();
    payload.set("image", image, image.name || "imagen.jpg");
    if (caption) payload.set("caption", caption.slice(0, 1024));

    const response = await fetch(target, {
      method: "POST",
      headers: trustedHeaders(inboxKey, session),
      body: payload,
      cache: "no-store",
    });
    const contentType =
      response.headers.get("content-type") ?? "application/json";
    const body = await response.arrayBuffer();

    if (!response.ok && contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(body)) as {
          error?: unknown;
          message?: unknown;
        };
        const detail =
          typeof parsed.error === "string"
            ? parsed.error
            : typeof parsed.message === "string"
              ? parsed.message
              : "No se pudo enviar la imagen.";

        return NextResponse.json(
          { ok: false, error: detail },
          { status: response.status },
        );
      } catch {}
    }

    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": contentType },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo enviar la imagen.",
      },
      { status: 500 },
    );
  }
}
