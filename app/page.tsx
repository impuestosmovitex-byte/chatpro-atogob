"use client";


import { AppSidebar } from './components/AppSidebar';
import { FormEvent, useEffect, useMemo, useState, useRef} from "react";

type AttentionStatus = "ai" | "waiting" | "human" | "closed";

type InboxMessage = {
  id: string | null;
  sessionId: string;
  message: string;
  sender: string;
  authorType: "customer" | "ai" | "advisor";
  createdAt: string | null;
};

type ConversationSession = {
  id: string;
  companyId: string;
  customerPhone: string;
  stage: string;
  context: Record<string, unknown>;
  lastMessageAt: string;
  attentionStatus: AttentionStatus;
  assignedToName: string | null;
  takenAt: string | null;
  closedAt: string | null;
};

type InboxSession = ConversationSession & {
  lastMessage: InboxMessage | null;
};

type QuickReply = {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  category: string;
  isActive: boolean;
};

type InboxConversation = {
  company: { id: string; slug: string; name: string };
  session: ConversationSession;
  messages: InboxMessage[];
};

type ApiList = {
  ok: boolean;
  error?: string;
  company?: { id: string; slug: string; name: string };
  sessions?: InboxSession[];
};

type ApiConversation = {
  ok: boolean;
  error?: string;
  company?: InboxConversation["company"];
  session?: ConversationSession;
  messages?: InboxMessage[];
  conversation?: InboxConversation;
};

const COMPANY = process.env.NEXT_PUBLIC_CHATPRO_COMPANY || "atogob";

const statusLabel: Record<AttentionStatus, string> = {
  ai: "IA atendiendo",
  waiting: "Pendiente de asesor",
  human: "Tomado por asesor",
  closed: "Finalizado",
};

const filters: Array<{ value: "all" | AttentionStatus; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "waiting", label: "Pendientes" },
  { value: "ai", label: "IA atendiendo" },
  { value: "human", label: "Tomados" },
  { value: "closed", label: "Historial" },
];

function formatDate(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatMoney(value: unknown) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) return "Sin total";

  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function customerLabel(phone: string) {
  return phone ? `Cliente ${phone}` : "Cliente sin número";
}

function getCart(context: Record<string, unknown>) {
  const value = context.cart;

  if (!Array.isArray(value)) return [] as Array<Record<string, unknown>>;

  return value.filter(
    (line): line is Record<string, unknown> =>
      Boolean(line) && typeof line === "object" && !Array.isArray(line),
  );
}

export default function Home() {
  const [filter, setFilter] = useState<"all" | AttentionStatus>("all");
  const [sessions, setSessions] = useState<InboxSession[]>([]);
  const [selected, setSelected] = useState<InboxConversation | null>(null);
  const [agentName, setAgentName] = useState("Asesor");
  const [message, setMessage] = useState("");
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  async function readJson(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(text || "La respuesta de Chat Pro no fue válida.");
    }

    return response.json();
  }

  async function loadList(showSpinner = true) {
    if (showSpinner) setLoadingList(true);

    try {
      const response = await fetch(
        `/api/inbox?company=${encodeURIComponent(COMPANY)}&status=${filter}&limit=80`,
        { cache: "no-store" },
      );
      const data = (await readJson(response)) as ApiList;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo cargar la bandeja.");
      }

      setSessions(data.sessions ?? []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la bandeja.");
    } finally {
      if (showSpinner) setLoadingList(false);
    }
  }

  async function loadQuickReplies() {
    try {
      const response = await fetch(
        `/api/quick-replies?company=${encodeURIComponent(COMPANY)}`,
        { cache: "no-store" },
      );
      const data = (await readJson(response)) as {
        ok?: boolean;
        quickReplies?: QuickReply[];
      };

      if (response.ok && data.ok) {
        setQuickReplies(
          (data.quickReplies ?? []).filter((reply) => reply.isActive),
        );
      }
    } catch {
      // La bandeja sigue funcionando si las respuestas rápidas no cargan.
    }
  }

  async function openConversation(sessionId: string) {
    setLoadingChat(true);

    try {
      const response = await fetch(
        `/api/inbox?company=${encodeURIComponent(COMPANY)}&sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      const data = (await readJson(response)) as ApiConversation;

      if (!response.ok || !data.ok || !data.session || !data.company) {
        throw new Error(data.error || "No se pudo abrir la conversación.");
      }

      setSelected({
        company: data.company,
        session: data.session,
        messages: data.messages ?? [],
      });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir la conversación.");
    } finally {
      setLoadingChat(false);
    }
  }

  async function runAction(action: "take" | "close" | "message") {
    if (!selected) return;

    setActionLoading(true);

    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: COMPANY,
          sessionId: selected.session.id,
          action,
          agentName,
          message,
        }),
      });
      const data = (await readJson(response)) as ApiConversation;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo actualizar la conversación.");
      }

      if (action === "message") {
        setMessage("");
      }

      await loadList(false);
      await openConversation(selected.session.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo completar la acción.");
    } finally {
      setActionLoading(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!message.trim()) return;

    await runAction("message");
  }

  useEffect(() => {
    void loadList();
    void loadQuickReplies();

    const targetSession = new URLSearchParams(window.location.search).get("session");
    if (targetSession) {
      void openConversation(targetSession);
    }

    const timer = window.setInterval(() => void loadList(false), 12000);

    return () => window.clearInterval(timer);
  }, [filter]);

  const cartLines = useMemo(
    () => (selected ? getCart(selected.session.context) : []),
    [selected],
  );

  const cartTotal = useMemo(
    () =>
      cartLines.reduce(
        (total, line) =>
          total + Number(line.unitPrice ?? 0) * Number(line.quantity ?? 0),
        0,
      ),
    [cartLines],
  );


  const messageFeedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const feed = messageFeedRef.current;

    if (!feed || !selected || loadingChat) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [selected?.session.id, selected?.messages.length, loadingChat]);


  const quickReplyQuery = message.trimStart().startsWith("/")
    ? message.trimStart().slice(1).toLowerCase()
    : "";

  const visibleQuickReplies =
    quickReplyOpen && message.trimStart().startsWith("/")
      ? quickReplies
          .filter(
            (reply) =>
              !quickReplyQuery ||
              reply.shortcut.includes(quickReplyQuery) ||
              reply.title.toLowerCase().includes(quickReplyQuery) ||
              reply.category.toLowerCase().includes(quickReplyQuery),
          )
          .slice(0, 7)
      : [];

  function chooseQuickReply(reply: QuickReply) {
    setMessage(reply.body);
    setQuickReplyOpen(false);
  }

  return (
    <main className="chatpro-shell">
      <AppSidebar companyName="ATOGOB" />

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Bandeja unificada</p>
            <h1>Conversaciones</h1>
          </div>
          <label className="advisor-field">
            <span>Asesor</span>
            <input
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="Nombre del asesor"
            />
          </label>
        </header>

        <div className="channel-tabs" aria-label="Canales">
          <button className="channel-tab active" type="button">
            <span className="whatsapp-icon">◔</span> WhatsApp
          </button>
          <button className="channel-tab" type="button" disabled>
            Instagram <small>Próximamente</small>
          </button>
          <button className="channel-tab" type="button" disabled>
            Messenger <small>Próximamente</small>
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="inbox-layout">
          <section className="conversation-list-panel">
            <div className="list-panel-heading">
              <div>
                <h2>Chats</h2>
                <p>{loadingList ? "Actualizando…" : `${sessions.length} conversaciones`}</p>
              </div>
              <button className="refresh-button" type="button" onClick={() => void loadList()}>
                ↻
              </button>
            </div>

            <div className="filter-row">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`filter-chip ${filter === item.value ? "selected" : ""}`}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="conversation-list">
              {!loadingList && !sessions.length ? (
                <div className="empty-list">Aún no hay chats en este filtro.</div>
              ) : null}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`conversation-row ${selected?.session.id === session.id ? "selected" : ""}`}
                  onClick={() => void openConversation(session.id)}
                >
                  <span className="avatar">{session.customerPhone.slice(-2) || "CP"}</span>
                  <span className="conversation-summary">
                    <span className="conversation-topline">
                      <strong>{customerLabel(session.customerPhone)}</strong>
                      <time>{formatDate(session.lastMessageAt)}</time>
                    </span>
                    <span className="conversation-preview">{session.lastMessage?.message || "Sin mensajes todavía"}</span>
                    <span className={`status-pill ${session.attentionStatus}`}>
                      {statusLabel[session.attentionStatus]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="chat-panel">
            {!selected ? (
              <div className="chat-placeholder">
                <div className="placeholder-orb">◔</div>
                <h2>Abre una conversación</h2>
                <p>Desde aquí podrás ver el historial, tomar el chat y responder como asesor.</p>
              </div>
            ) : (
              <>
                <header className="chat-header">
                  <div>
                    <p className="eyebrow">WhatsApp</p>
                    <h2>{customerLabel(selected.session.customerPhone)}</h2>
                    <p className="chat-subtitle">
                      {statusLabel[selected.session.attentionStatus]}
                      {selected.session.assignedToName ? ` · ${selected.session.assignedToName}` : ""}
                    </p>
                  </div>
                  <div className="chat-actions">
                    {selected.session.attentionStatus !== "human" && selected.session.attentionStatus !== "closed" ? (
                      <button
                        className="button primary"
                        type="button"
                        disabled={actionLoading}
                        onClick={() => void runAction("take")}
                      >
                        {actionLoading ? "Tomando…" : "Tomar conversación"}
                      </button>
                    ) : null}
                    {selected.session.attentionStatus === "human" ? (
                      <button
                        className="button quiet"
                        type="button"
                        disabled={actionLoading}
                        onClick={() => void runAction("close")}
                      >
                        {actionLoading ? "Finalizando…" : "Finalizar conversación"}
                      </button>
                    ) : null}
                    {selected.session.attentionStatus === "closed" ? (
                      <span className="history-badge">En historial</span>
                    ) : null}
                  </div>
                </header>

                <div className="message-feed" ref={messageFeedRef}>
                  {loadingChat ? <p className="feed-loading">Abriendo historial…</p> : null}
                  {!loadingChat && !selected.messages.length ? <p className="feed-loading">No hay mensajes todavía.</p> : null}
                  {selected.messages.map((item) => (
                    <div key={item.id ?? `${item.sessionId}-${item.createdAt}-${item.message}`} className={`message-row ${item.authorType}`}>
                      <div className="message-bubble">
                        <span className="message-author">
                          {item.authorType === "customer" ? "Cliente" : item.authorType === "advisor" ? "Asesor" : "IA"}
                        </span>
                        <p>{item.message}</p>
                        <time>{formatDate(item.createdAt)}</time>
                      </div>
                    </div>
                  ))}
                </div>

                {selected.session.attentionStatus === "human" ? (
                  <form className="reply-box" onSubmit={sendMessage}>
                    <div className="quick-reply-wrap">
                      <textarea
                        value={message}
                        onChange={(event) => {
                          const next = event.target.value;
                          setMessage(next);
                          setQuickReplyOpen(next.trimStart().startsWith("/"));
                        }}
                        onFocus={() =>
                          setQuickReplyOpen(message.trimStart().startsWith("/"))
                        }
                        placeholder="Escribe una respuesta o usa / para atajos…"
                        rows={3}
                      />
                      {visibleQuickReplies.length ? (
                        <div className="quick-reply-menu">
                          {visibleQuickReplies.map((reply) => (
                            <button
                              key={reply.id}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => chooseQuickReply(reply)}
                            >
                              <code>/{reply.shortcut}</code>
                              <span>
                                <b>{reply.title}</b>
                                <small>{reply.category}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button className="button primary" type="submit" disabled={actionLoading || !message.trim()}>
                      {actionLoading ? "Enviando…" : "Enviar"}
                    </button>
                  </form>
                ) : (
                  <div className="reply-disabled">
                    {selected.session.attentionStatus === "closed"
                      ? "Esta conversación está finalizada. Si el cliente vuelve a escribir, la IA retomará automáticamente desde el historial."
                      : "Toma la conversación para responder como asesor. Mientras esté tomada, la IA queda pausada."}
                  </div>
                )}
              </>
            )}
          </section>

          <aside className="context-panel">
            <h2>Contexto del cliente</h2>
            {!selected ? (
              <p className="muted-copy">Selecciona un chat para ver el contexto comercial.</p>
            ) : (
              <>
                <dl className="context-list">
                  <div>
                    <dt>Canal</dt>
                    <dd>WhatsApp</dd>
                  </div>
                  <div>
                    <dt>Teléfono</dt>
                    <dd>{selected.session.customerPhone}</dd>
                  </div>
                  <div>
                    <dt>Flujo actual</dt>
                    <dd>{selected.session.stage}</dd>
                  </div>
                  <div>
                    <dt>Estado</dt>
                    <dd>{statusLabel[selected.session.attentionStatus]}</dd>
                  </div>
                </dl>

                <section className="cart-context">
                  <div className="cart-context-heading">
                    <h3>Carrito actual</h3>
                    <strong>{cartLines.length ? formatMoney(cartTotal) : "Vacío"}</strong>
                  </div>
                  {cartLines.length ? (
                    <ul>
                      {cartLines.map((line, index) => (
                        <li key={`${String(line.variantId ?? index)}-${index}`}>
                          <span>{String(line.productTitle ?? "Producto")}</span>
                          <small>
                            {String(line.variantTitle ?? "")}
                            {line.quantity ? ` · ${String(line.quantity)} und.` : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted-copy">No hay productos guardados en el carrito de esta conversación.</p>
                  )}
                </section>
              </>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
