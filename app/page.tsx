"use client";


import { AppSidebar } from './components/AppSidebar';
import { FormEvent, useEffect, useMemo, useState, useRef} from "react";

type AttentionStatus = "ai" | "waiting" | "human" | "closed";

type Contact = {
  id: string;
  phone: string;
  displayName: string | null;
  primaryChannel: "whatsapp" | "instagram" | "messenger" | "manual";
  tags: string[];
  notes: string;
};

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
  assignedToUserId: string | null;
  assignedToName: string | null;
  takenAt: string | null;
  closedAt: string | null;
};

type InboxSession = ConversationSession & {
  contact?: Contact | null;
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

type InboxProductVariant = {
  legacyResourceId: string;
  title: string;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  tracked: boolean;
};

type InboxProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  saleReady: boolean;
  variants: {
    total: number;
    shown: number;
    sellable: number;
    withoutStock: number;
    notTracked: number;
    hasMore: boolean;
  };
  previewVariants: InboxProductVariant[];
};

type ProductsApiResponse = {
  ok?: boolean;
  error?: string;
  products?: InboxProduct[];
};

type AdvisorStatus = "available" | "busy" | "away" | "offline";
type CurrentUser = { userId: string; companyName: string; fullName: string; roleName: string };
type AdvisorPresence = { status: AdvisorStatus };
const advisorStatusLabel: Record<AdvisorStatus, string> = { available: "Disponible", busy: "Ocupado", away: "Ausente", offline: "Desconectado" };

type InboxConversation = {
  company: { id: string; slug: string; name: string };
  session: ConversationSession;
  contact?: Contact | null;
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
  contact?: Contact | null;
};

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

function customerLabel(phone: string, contact?: Contact | null) {
  return contact?.displayName?.trim() || (phone ? `Cliente ${phone}` : "Cliente sin número");
}

function getCart(context: Record<string, unknown>) {
  const value = context.cart;

  if (!Array.isArray(value)) return [] as Array<Record<string, unknown>>;

  return value.filter(
    (line): line is Record<string, unknown> =>
      Boolean(line) && typeof line === "object" && !Array.isArray(line),
  );
}

function buildVariantUrl(product: InboxProduct, variant: InboxProductVariant) {
  if (!product.onlineStoreUrl) return "";

  try {
    const url = new URL(product.onlineStoreUrl);
    url.searchParams.set("variant", variant.legacyResourceId);
    return url.toString();
  } catch {
    return product.onlineStoreUrl;
  }
}

function buildCheckoutUrl(product: InboxProduct, variant: InboxProductVariant) {
  if (!product.onlineStoreUrl || !variant.legacyResourceId) return "";

  try {
    const url = new URL(product.onlineStoreUrl);
    return `${url.origin}/cart/${variant.legacyResourceId}:1`;
  } catch {
    return "";
  }
}

function cleanVariantTitle(value: string) {
  const title = value.trim();

  return title && title.toLowerCase() !== "default title" ? title : "";
}

function variantStockLabel(variant: InboxProductVariant) {
  if (!variant.availableForSale) return "No disponible";

  if (!variant.tracked) return "Disponible";

  const quantity = Number(variant.inventoryQuantity ?? 0);

  if (quantity <= 0) return "Sin stock";

  return `${quantity.toLocaleString("es-CO")} disponible${quantity === 1 ? "" : "s"}`;
}

function productMessage(
  product: InboxProduct,
  variant: InboxProductVariant,
  mode: "product" | "checkout",
) {
  const variantTitle = cleanVariantTitle(variant.title);
  const link =
    mode === "checkout"
      ? buildCheckoutUrl(product, variant)
      : buildVariantUrl(product, variant);
  const lines = [
    mode === "checkout"
      ? "Te dejo el link para comprar este producto:"
      : "Te comparto este producto:",
    "",
    product.title,
    variantTitle ? `Variante: ${variantTitle}` : "",
    `Precio: ${formatMoney(variant.price)}`,
    link ? `Link: ${link}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

export default function Home() {
  const [filter, setFilter] = useState<"all" | AttentionStatus>("all");
  const [sessions, setSessions] = useState<InboxSession[]>([]);
  const [selected, setSelected] = useState<InboxConversation | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [presence, setPresence] = useState<AdvisorPresence | null>(null);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [internalTestLoading, setInternalTestLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTags, setContactTags] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<InboxProduct[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState("");

  async function loadIdentityAndPresence() {
    try {
      const meResponse = await fetch("/api/auth/session", { cache: "no-store" });
      const me = await readJson(meResponse) as { ok?: boolean; error?: string; session?: CurrentUser };
      if (!meResponse.ok || !me.ok || !me.session?.userId) throw new Error(me.error || "No se pudo identificar al usuario.");
      setCurrentUser(me.session);
      const presenceResponse = await fetch("/api/advisor-presence", { cache: "no-store" });
      const data = await readJson(presenceResponse) as { ok?: boolean; error?: string; advisor?: AdvisorPresence };
      if (!presenceResponse.ok || !data.ok || !data.advisor) throw new Error(data.error || "No se pudo cargar la disponibilidad.");
      setPresence(data.advisor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar tu disponibilidad.");
    }
  }

  async function changePresence(status: AdvisorStatus) {
    setPresenceLoading(true);
    try {
      const response = await fetch("/api/advisor-presence", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await readJson(response) as { ok?: boolean; error?: string; advisor?: AdvisorPresence };
      if (!response.ok || !data.ok || !data.advisor) throw new Error(data.error || "No se pudo guardar la disponibilidad.");
      setPresence(data.advisor);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la disponibilidad.");
    } finally { setPresenceLoading(false); }
  }

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
        `/api/inbox?status=${filter}&limit=80`,
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
        "/api/quick-replies",
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
        `/api/inbox?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      const data = (await readJson(response)) as ApiConversation;

      if (!response.ok || !data.ok || !data.session || !data.company) {
        throw new Error(data.error || "No se pudo abrir la conversación.");
      }

      setSelected({
        company: data.company,
        session: data.session,
        contact: data.contact ?? null,
        messages: data.messages ?? [],
      });
      setMessage("");
      setQuickReplyOpen(false);
      setActionMessage("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir la conversación.");
    } finally {
      setLoadingChat(false);
    }
  }

  async function runAction(action: "take" | "close" | "resume_ai" | "message") {
    if (!selected) return;

    const cleanMessage = message.trim();

    if (action === "message" && !cleanMessage) return;

    setActionLoading(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selected.session.id,
          action,
          message: action === "message" ? cleanMessage : undefined,
        }),
      });

      const data = (await readJson(response)) as {
        ok?: boolean;
        error?: string;
        message?: string;
        session?: ConversationSession;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.message || "No se pudo completar la acción.");
      }

      if (action === "message") {
        setMessage("");
        setQuickReplyOpen(false);
      }

      await loadList(false);
      await openConversation(selected.session.id);

      const actionLabels: Record<"take" | "close" | "resume_ai" | "message", string> = {
        take: "Conversación tomada. La IA queda pausada mientras respondes.",
        message: "Mensaje enviado por WhatsApp.",
        resume_ai: "Conversación devuelta a la IA.",
        close: "Conversación finalizada.",
      };

      setActionMessage(actionLabels[action]);
    } catch (caught) {
      setActionMessage("");
      setError(caught instanceof Error ? caught.message : "No se pudo completar la acción.");
    } finally {
      setActionLoading(false);
    }
  }

  async function startInternalTest() {
    setInternalTestLoading(true);

    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "internal_test_start",
        }),
      });
      const data = (await readJson(response)) as ApiConversation;

      if (!response.ok || !data.ok || !data.conversation) {
        throw new Error(data.error || "No se pudo iniciar la prueba del agente.");
      }

      setSelected(data.conversation);
      setMessage("");
      setQuickReplyOpen(false);
      setError("");
      await loadList(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo iniciar la prueba del agente.",
      );
    } finally {
      setInternalTestLoading(false);
    }
  }

  async function sendInternalTestMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selected || !message.trim()) return;

    setInternalTestLoading(true);

    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "internal_test_message",
          sessionId: selected.session.id,
          message,
        }),
      });
      const data = (await readJson(response)) as ApiConversation;

      if (!response.ok || !data.ok || !data.conversation) {
        throw new Error(data.error || "No se pudo enviar el mensaje de prueba.");
      }

      setSelected(data.conversation);
      setMessage("");
      setQuickReplyOpen(false);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo enviar el mensaje de prueba.",
      );
    } finally {
      setInternalTestLoading(false);
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
    void loadIdentityAndPresence();

    const targetSession = new URLSearchParams(window.location.search).get("session");
    if (targetSession) {
      void openConversation(targetSession);
    }

    const timer = window.setInterval(() => void loadList(false), 12000);

    return () => window.clearInterval(timer);
  }, [filter]);

  const isInternalTest = Boolean(
    selected?.session.context?.internal_test === true,
  );

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


  const selectedContactTags = selected?.contact?.tags?.join(", ") ?? "";

  useEffect(() => {
    if (!selected) {
      setContactName("");
      setContactTags("");
      setContactNotes("");
      return;
    }

    setContactName(selected.contact?.displayName ?? "");
    setContactTags(selectedContactTags);
    setContactNotes(selected.contact?.notes ?? "");
  }, [
    selected?.session.id,
    selected?.contact?.displayName,
    selected?.contact?.notes,
    selectedContactTags,
  ]);

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

  async function searchInboxProducts(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const query = productSearch.trim();

    if (!query) {
      setProductError("Escribe qué producto quieres buscar.");
      return;
    }

    setProductLoading(true);
    setProductError("");

    try {
      const params = new URLSearchParams({
        search: query,
        status: "active",
        limit: "8",
      });
      const response = await fetch(`/api/products?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await readJson(response)) as ProductsApiResponse;

      if (!response.ok || !data.ok || !data.products) {
        throw new Error(data.error || "No se pudieron buscar productos.");
      }

      setProductResults(data.products.filter((product) => product.saleReady));
      if (!data.products.filter((product) => product.saleReady).length) {
        setProductError("No encontré productos disponibles con esa búsqueda.");
      }
    } catch (caught) {
      setProductResults([]);
      setProductError(caught instanceof Error ? caught.message : "No se pudieron buscar productos.");
    } finally {
      setProductLoading(false);
    }
  }

  function prepareProductForReply(
    product: InboxProduct,
    variant: InboxProductVariant,
    mode: "product" | "checkout",
  ) {
    const preparedMessage = productMessage(product, variant, mode);

    setMessage((current) =>
      current.trim()
        ? `${current.trim()}\n\n${preparedMessage}`
        : preparedMessage,
    );
    setQuickReplyOpen(false);

    if (selected?.session.attentionStatus === "human") {
      setActionMessage(
        mode === "checkout"
          ? "Checkout preparado. Revisa el mensaje y envíalo."
          : "Producto preparado. Revisa el mensaje y envíalo.",
      );
    } else {
      setActionMessage("Producto preparado. Toma la conversación para poder enviarlo.");
    }
  }

  async function saveContactFromInbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selected || isInternalTest) return;

    setContactSaving(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          phone: selected.session.customerPhone,
          displayName: contactName,
          tags: contactTags,
          notes: contactNotes,
        }),
      });

      const data = (await readJson(response)) as {
        ok?: boolean;
        error?: string;
        contact?: Contact;
      };

      if (!response.ok || !data.ok || !data.contact) {
        throw new Error(data.error || "No se pudo guardar la ficha del cliente.");
      }

      const savedContact = data.contact;

      setSelected((current) =>
        current && current.session.id === selected.session.id
          ? { ...current, contact: savedContact }
          : current,
      );

      setSessions((current) =>
        current.map((item) =>
          item.id === selected.session.id
            ? { ...item, contact: savedContact }
            : item,
        ),
      );

      setActionMessage("Ficha comercial del cliente guardada.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la ficha del cliente.");
    } finally {
      setContactSaving(false);
    }
  }

  function chooseQuickReply(reply: QuickReply) {
    setMessage(reply.body);
    setQuickReplyOpen(false);
  }

  const selectedStatus = selected?.session.attentionStatus;
  const showTakeButton =
    !isInternalTest &&
    (selectedStatus === "ai" || selectedStatus === "waiting");
  const showHumanActions = !isInternalTest && selectedStatus === "human";

  return (
    <main className="chatpro-shell">
      <AppSidebar companyName={currentUser?.companyName ?? "Empresa"} />

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Bandeja unificada</p>
            <h1>Conversaciones</h1>
          </div>
          <div className="advisor-presence">
            <span className={`presence-dot ${presence?.status ?? "offline"}`} />
            <div className="advisor-presence-copy">
              <b>{currentUser?.fullName ?? "Cargando usuario…"}</b>
              <small>{currentUser?.roleName ?? "Asesor"}</small>
            </div>
            <select value={presence?.status ?? "offline"} disabled={presenceLoading || !currentUser} onChange={(event) => void changePresence(event.target.value as AdvisorStatus)}>
              {Object.entries(advisorStatusLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </header>

        <div className="channel-tabs" aria-label="Canales">
          <button className="channel-tab active" type="button">
            <span className="whatsapp-icon">◔</span> WhatsApp
          </button>
          <button
            className="channel-tab"
            type="button"
            onClick={() => void startInternalTest()}
            disabled={internalTestLoading}
          >
            {internalTestLoading ? "Preparando prueba…" : "Probar agente"}
          </button>
          <button className="channel-tab" type="button" disabled>
            Instagram <small>Próximamente</small>
          </button>
          <button className="channel-tab" type="button" disabled>
            Messenger <small>Próximamente</small>
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {actionMessage ? <div className="success-banner">{actionMessage}</div> : null}

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
                      <strong>{customerLabel(session.customerPhone, session.contact)}</strong>
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
                    <p className="eyebrow">
                      {isInternalTest ? "Prueba interna · no envía WhatsApp" : "WhatsApp"}
                    </p>
                    <h2>
                      {isInternalTest
                        ? `Probar a ${selected.company.name}`
                        : customerLabel(selected.session.customerPhone, selected.contact)}
                    </h2>
                    <p className="chat-subtitle">
                      {isInternalTest
                        ? "Conversación real con el agente y las integraciones de esta empresa."
                        : `${statusLabel[selected.session.attentionStatus]}${selected.session.assignedToName ? ` · ${selected.session.assignedToName}` : ""}`}
                    </p>
                  </div>
                  <div className="chat-actions">
                    {isInternalTest ? (
                      <button
                        className="button quiet"
                        type="button"
                        disabled={internalTestLoading}
                        onClick={() => void startInternalTest()}
                      >
                        {internalTestLoading ? "Reiniciando…" : "Nueva prueba"}
                      </button>
                    ) : null}
                    {showTakeButton ? (
                      <button
                        className="button primary"
                        type="button"
                        disabled={actionLoading}
                        onClick={() => void runAction("take")}
                      >
                        {actionLoading ? "Tomando…" : "Tomar conversación"}
                      </button>
                    ) : null}
                    {showHumanActions ? (
                      <>
                        <button
                          className="button quiet"
                          type="button"
                          disabled={actionLoading}
                          onClick={() => void runAction("resume_ai")}
                        >
                          {actionLoading ? "Actualizando…" : "Devolver a IA"}
                        </button>
                        <button
                          className="button quiet"
                          type="button"
                          disabled={actionLoading}
                          onClick={() => void runAction("close")}
                        >
                          {actionLoading ? "Finalizando…" : "Finalizar conversación"}
                        </button>
                      </>
                    ) : null}
                    {!isInternalTest && selected.session.attentionStatus === "closed" ? (
                      <span className="history-badge">En historial</span>
                    ) : null}
                  </div>
                </header>

                <div className="message-feed" ref={messageFeedRef}>
                  {loadingChat ? <p className="feed-loading">Abriendo historial…</p> : null}
                  {!loadingChat && !selected.messages.length ? (
                    <p className="feed-loading">
                      {isInternalTest
                        ? "Escribe como cliente para probar el agente. Esta prueba no envía mensajes por WhatsApp."
                        : "No hay mensajes todavía."}
                    </p>
                  ) : null}
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

                {isInternalTest ? (
                  <form className="reply-box" onSubmit={sendInternalTestMessage}>
                    <textarea
                      value={message}
                      onChange={(event) => {
                        setMessage(event.target.value);
                        setQuickReplyOpen(false);
                      }}
                      placeholder="Escribe como cliente para probar el agente…"
                      rows={3}
                    />
                    <button
                      className="button primary"
                      type="submit"
                      disabled={internalTestLoading || !message.trim()}
                    >
                      {internalTestLoading ? "Probando…" : "Enviar al agente"}
                    </button>
                  </form>
                ) : selected.session.attentionStatus === "human" ? (
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
                      : selected.session.attentionStatus === "waiting"
                        ? "Este chat está pendiente de asesor. Tómalo para responder como persona."
                        : "La IA está atendiendo. Toma la conversación solo si necesitas intervenir como asesor."}
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
                  {selected.contact?.tags?.length ? (
                    <div>
                      <dt>Etiquetas</dt>
                      <dd>{selected.contact.tags.join(" · ")}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Flujo actual</dt>
                    <dd>{selected.session.stage}</dd>
                  </div>
                  <div>
                    <dt>Estado</dt>
                    <dd>{statusLabel[selected.session.attentionStatus]}</dd>
                  </div>
                </dl>

                {!isInternalTest ? (
                  <form className="contact-card-form" onSubmit={saveContactFromInbox}>
                    <div className="contact-card-heading">
                      <h3>Ficha comercial</h3>
                      <button type="submit" disabled={contactSaving}>
                        {contactSaving ? "Guardando…" : "Guardar"}
                      </button>
                    </div>

                    <label>
                      <span>Nombre visible</span>
                      <input
                        value={contactName}
                        onChange={(event) => setContactName(event.target.value)}
                        placeholder="Nombre del cliente"
                      />
                    </label>

                    <label>
                      <span>Etiquetas</span>
                      <input
                        value={contactTags}
                        onChange={(event) => setContactTags(event.target.value)}
                        placeholder="Ej. mayorista, seguimiento, VIP"
                      />
                    </label>

                    <label>
                      <span>Notas internas</span>
                      <textarea
                        value={contactNotes}
                        onChange={(event) => setContactNotes(event.target.value)}
                        placeholder="Datos útiles para vender y atender mejor. No lo ve el cliente."
                        rows={4}
                      />
                    </label>

                    <p className="contact-card-helper">
                      Separa las etiquetas con comas. Las notas son solo para el equipo.
                    </p>
                  </form>
                ) : null}

                {!isInternalTest ? (
                  <section className="seller-product-panel">
                    <div className="seller-product-heading">
                      <h3>Vender producto</h3>
                      <span>Shopify</span>
                    </div>

                    <form className="seller-product-search" onSubmit={searchInboxProducts}>
                      <input
                        value={productSearch}
                        onChange={(event) => setProductSearch(event.target.value)}
                        placeholder="Buscar producto, referencia o SKU"
                      />
                      <button type="submit" disabled={productLoading}>
                        {productLoading ? "Buscando…" : "Buscar"}
                      </button>
                    </form>

                    {productError ? (
                      <p className="seller-product-error">{productError}</p>
                    ) : null}

                    {productResults.length ? (
                      <div className="seller-product-results">
                        {productResults.map((product) => (
                          <article className="seller-product-card" key={product.id}>
                            <div className="seller-product-top">
                              {product.imageUrl ? (
                                <img src={product.imageUrl} alt={product.imageAlt || product.title} />
                              ) : (
                                <span className="seller-product-empty-image">Sin foto</span>
                              )}
                              <div>
                                <strong>{product.title}</strong>
                                <small>
                                  {product.previewVariants.length} variante
                                  {product.previewVariants.length === 1 ? "" : "s"}
                                  {product.variants.hasMore ? " · hay más en Shopify" : ""}
                                </small>
                              </div>
                            </div>

                            <div className="seller-variant-list">
                              {product.previewVariants.slice(0, 4).map((variant) => {
                                const canSell = variant.availableForSale;
                                return (
                                  <div className="seller-variant-row" key={variant.legacyResourceId}>
                                    <div>
                                      <span>{cleanVariantTitle(variant.title) || "Producto"}</span>
                                      <small>
                                        {formatMoney(variant.price)} · {variantStockLabel(variant)}
                                      </small>
                                    </div>
                                    <div className="seller-variant-actions">
                                      <button
                                        type="button"
                                        disabled={!canSell}
                                        onClick={() => prepareProductForReply(product, variant, "product")}
                                      >
                                        Producto
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!canSell || !buildCheckoutUrl(product, variant)}
                                        onClick={() => prepareProductForReply(product, variant, "checkout")}
                                      >
                                        Checkout
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}

                    <p className="seller-product-helper">
                      El botón Producto prepara el mensaje con link del producto. Checkout prepara un link directo de carrito por 1 unidad.
                    </p>
                  </section>
                ) : null}

                {typeof (selected.session.context as Record<string, unknown>).handoff === "object" ? (
                  <section className="contact-notes-context">
                    <h3>Resumen de transferencia</h3>
                    <p><strong>Motivo:</strong> {String(((selected.session.context as Record<string, any>).handoff?.reason) || "Caso transferido")}</p>
                    <p>{String(((selected.session.context as Record<string, any>).handoff?.summary) || "Revisa el historial de la conversación.")}</p>
                  </section>
                ) : null}


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
