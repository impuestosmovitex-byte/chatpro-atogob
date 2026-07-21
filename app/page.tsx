"use client";

import { AppSidebar } from "./components/AppSidebar";
import { FormEvent, useEffect, useMemo, useState, useRef } from "react";

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
  messageType: "text" | "audio" | "image";
  mediaMimeType: string | null;
  mediaStoragePath?: string | null;
  mediaVoice: boolean;
  createdAt: string | null;
};

type ConversationSession = {
  id: string;
  companyId: string;
  customerPhone: string;
  stage: string;
  context: Record<string, unknown>;
  lastMessageAt: string;
  pendingCount: number;
  pendingSince: string | null;
  attentionStatus: AttentionStatus;
  assignedToUserId: string | null;
  assignedToName: string | null;
  takenAt: string | null;
  closedAt: string | null;
  takeAvailable?: boolean;
  takeBlockedReason?: string | null;
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

type WhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
};

type WhatsappTemplateBinding = {
  id: string;
  eventKey: string;
  templateId: string | null;
  enabled: boolean;
  variableMapping: Record<string, unknown>;
};

type WhatsappTemplateEvent = {
  key: string;
  label: string;
};

type WhatsappTemplatesResponse = {
  ok?: boolean;
  error?: string;
  templates?: WhatsappTemplate[];
  bindings?: WhatsappTemplateBinding[];
  eventDefinitions?: WhatsappTemplateEvent[];
};

type PreparedWhatsappTemplate = {
  sessionId: string;
  templateId: string;
  name: string;
  language: string;
  variables: Record<string, string>;
  preview: string;
  usageLabels: string[];
};

type StorefrontResponse = {
  ok?: boolean;
  error?: string;
  storefrontUrl?: string;
};

type AdvisorStatus = "available" | "busy" | "away" | "offline";
type CurrentUser = {
  userId: string;
  companyName: string;
  fullName: string;
  roleName: string;
};
type AdvisorPresence = {
  status: AdvisorStatus;
  lastSeenAt?: string | null;
  statusChangedAt?: string | null;
};
type AdvisorPresenceResponse = {
  ok?: boolean;
  error?: string;
  advisor?: AdvisorPresence;
  assignedPendingCount?: number;
};
type TransferTarget = {
  userId: string;
  fullName: string;
  roleName: string;
};
type TransferTargetsResponse = {
  ok?: boolean;
  error?: string;
  targets?: TransferTarget[];
};
const advisorStatusLabel: Record<AdvisorStatus, string> = {
  available: "Disponible",
  busy: "Ocupado",
  away: "Ausente",
  offline: "Desconectado",
};

type InboxConversation = {
  company: { id: string; slug: string; name: string };
  session: ConversationSession;
  contact?: Contact | null;
  messages: InboxMessage[];
  historyRestricted?: boolean;
};

type ApiList = {
  ok: boolean;
  error?: string;
  company?: { id: string; slug: string; name: string };
  sessions?: InboxSession[];
  hasMore?: boolean;
  nextOffset?: number;
  pendingTotal?: number;
};

type ApiConversation = {
  ok: boolean;
  error?: string;
  company?: InboxConversation["company"];
  session?: ConversationSession;
  messages?: InboxMessage[];
  conversation?: InboxConversation;
  contact?: Contact | null;
  historyRestricted?: boolean;
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
  return (
    contact?.displayName?.trim() ||
    (phone ? `Cliente ${phone}` : "Cliente sin número")
  );
}

function customerInitials(phone: string, contact?: Contact | null) {
  const name = contact?.displayName?.trim();

  if (name) {
    const words = name
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);

    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }

    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
  }

  const phoneDigits = phone.replace(/\D/g, "");

  return phoneDigits.slice(-2) || "CP";
}

function compactTransferText(
  value: unknown,
  fallback: string,
  maxLength: number,
) {
  const text =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (!text) return fallback;
  if (text.length <= maxLength) return text;

  return `${text.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function templateObjectList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function whatsappTemplateVisibleText(template: WhatsappTemplate): string {
  const sections: string[] = [];

  for (const component of templateObjectList(template.components)) {
    const type =
      typeof component.type === "string"
        ? component.type.trim().toUpperCase()
        : "";
    const text =
      typeof component.text === "string" ? component.text.trim() : "";

    if (text && ["HEADER", "BODY", "FOOTER"].includes(type)) {
      sections.push(text);
    }

    if (type === "BUTTONS") {
      const buttons = templateObjectList(component.buttons)
        .map((button) =>
          typeof button.text === "string" ? button.text.trim() : "",
        )
        .filter(Boolean);

      if (buttons.length) {
        sections.push(buttons.map((button) => `[Botón: ${button}]`).join("\n"));
      }
    }
  }

  return (
    sections.join("\n\n") ||
    "Esta plantilla no contiene texto visible para previsualizar."
  );
}

function whatsappTemplateVariableKeys(template: WhatsappTemplate): string[] {
  const keys = new Set<string>();
  const sources = [whatsappTemplateVisibleText(template)];
  const expression = /\{\{\s*([^{}]+?)\s*\}\}/g;

  for (const component of templateObjectList(template.components)) {
    if (typeof component.text === "string" && component.text.trim()) {
      sources.push(component.text);
    }

    for (const button of templateObjectList(component.buttons)) {
      if (typeof button.url === "string" && button.url.trim()) {
        sources.push(button.url);
      }
    }
  }

  for (const source of sources) {
    for (const match of source.matchAll(expression)) {
      const key = match[1]?.trim();

      if (key) keys.add(key);
    }
  }

  return [...keys].sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return left.localeCompare(right, "es");
  });
}

function renderWhatsappTemplatePreview(
  template: WhatsappTemplate,
  variables: Record<string, string>,
): string {
  let preview = whatsappTemplateVisibleText(template);

  for (const key of whatsappTemplateVariableKeys(template)) {
    const replacement = variables[key]?.trim() || `[Variable ${key}]`;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    preview = preview.replace(
      new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "g"),
      replacement,
    );
  }

  return preview;
}

function whatsappTemplateUsageLabels(
  templateId: string,
  bindings: WhatsappTemplateBinding[],
  events: WhatsappTemplateEvent[],
): string[] {
  const eventNames = new Map(events.map((event) => [event.key, event.label]));

  return bindings
    .filter((binding) => binding.templateId === templateId)
    .map((binding) => {
      const label = eventNames.get(binding.eventKey) || binding.eventKey;

      return binding.enabled ? label : `${label} · pausada`;
    });
}

function getCart(context: Record<string, unknown>) {
  const value = context.cart;

  if (!Array.isArray(value)) return [] as Array<Record<string, unknown>>;

  return value.filter(
    (line): line is Record<string, unknown> =>
      Boolean(line) && typeof line === "object" && !Array.isArray(line),
  );
}

function ImageMessageViewer({ item }: { item: InboxMessage }) {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";

    async function loadImage() {
      if (!item.id) {
        setImageError("La imagen no tiene identificador.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setImageError("");

        const response = await fetch(
          `/api/inbox/media?sessionId=${encodeURIComponent(
            item.sessionId,
          )}&messageId=${encodeURIComponent(item.id)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          let detail = "No se pudo cargar la imagen.";

          if (contentType.includes("application/json")) {
            const data = (await response.json()) as {
              error?: string;
              message?: string;
            };
            detail = data.error || data.message || detail;
          } else {
            detail = (await response.text()) || detail;
          }

          throw new Error(detail);
        }

        const blob = await response.blob();

        if (!blob.size) {
          throw new Error("La imagen recibida está vacía.");
        }

        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch (error) {
        if (controller.signal.aborted) return;

        setImageError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar la imagen.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadImage();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.sessionId]);

  if (loading) {
    return <small className="wa-image-loading">Cargando imagen…</small>;
  }

  if (imageError || !source) {
    return (
      <small className="wa-image-error">
        {imageError || "Imagen no disponible."}
      </small>
    );
  }

  return (
    <a
      className="wa-image-link"
      href={source}
      target="_blank"
      rel="noreferrer"
      aria-label="Abrir imagen completa"
    >
      <img
        className="wa-image-message"
        src={source}
        alt={item.message || "Imagen enviada por el cliente"}
      />
    </a>
  );
}

function AudioMessagePlayer({ item }: { item: InboxMessage }) {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";

    async function loadAudio() {
      if (!item.id) {
        setPlaybackError("El audio no tiene identificador.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setPlaybackError("");

        const response = await fetch(
          `/api/inbox/media?sessionId=${encodeURIComponent(
            item.sessionId,
          )}&messageId=${encodeURIComponent(item.id)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          let detail = "No se pudo cargar el audio.";

          if (contentType.includes("application/json")) {
            const data = (await response.json()) as {
              error?: string;
              message?: string;
            };
            detail = data.error || data.message || detail;
          } else {
            detail = (await response.text()) || detail;
          }

          throw new Error(detail);
        }

        const blob = await response.blob();

        if (!blob.size) {
          throw new Error("El audio recibido está vacío.");
        }

        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch (error) {
        if (controller.signal.aborted) return;

        setPlaybackError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el audio.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadAudio();

    return () => {
      controller.abort();

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [item.id, item.sessionId]);

  return (
    <div className="wa-audio-message">
      {loading ? (
        <span className="wa-audio-loading">Cargando audio…</span>
      ) : playbackError ? (
        <span className="wa-audio-error">{playbackError}</span>
      ) : (
        <audio
          controls
          preload="metadata"
          src={source}
          onError={() =>
            setPlaybackError("El navegador no pudo reproducir este audio.")
          }
        >
          Tu navegador no permite reproducir este audio.
        </audio>
      )}
      <small>
        {item.authorType === "customer" ? "Audio del cliente" : "Audio enviado"}
      </small>
    </div>
  );
}

export default function Home() {
  const [canTestAgent, setCanTestAgent] = useState(false);
  const [canOpenStorefront, setCanOpenStorefront] = useState(false);
  const [canManageClients, setCanManageClients] = useState(false);
  const [canSendAudio, setCanSendAudio] = useState(false);
  const [filter, setFilter] = useState<"all" | AttentionStatus>("all");
  const [mobileSearch, setMobileSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [sessions, setSessions] = useState<InboxSession[]>([]);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [nextSessionsOffset, setNextSessionsOffset] = useState(0);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [selected, setSelected] = useState<InboxConversation | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [presence, setPresence] = useState<AdvisorPresence | null>(null);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSending, setTemplateSending] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [whatsappTemplates, setWhatsappTemplates] = useState<
    WhatsappTemplate[]
  >([]);
  const [whatsappTemplateBindings, setWhatsappTemplateBindings] = useState<
    WhatsappTemplateBinding[]
  >([]);
  const [whatsappTemplateEvents, setWhatsappTemplateEvents] = useState<
    WhatsappTemplateEvent[]
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateVariables, setTemplateVariables] = useState<
    Record<string, string>
  >({});
  const [preparedTemplate, setPreparedTemplate] =
    useState<PreparedWhatsappTemplate | null>(null);

  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferTargets, setTransferTargets] = useState<TransferTarget[]>([]);
  const [transferTargetUserId, setTransferTargetUserId] = useState("");
  const [internalTestLoading, setInternalTestLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTags, setContactTags] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [storefrontUrl, setStorefrontUrl] = useState("");
  const [storefrontLoading, setStorefrontLoading] = useState(false);
  const [storefrontError, setStorefrontError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState("");
  const [audioSending, setAudioSending] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imageSending, setImageSending] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const conversationRequestRef = useRef(0);
  const nextSessionsOffsetRef = useRef(0);
  const pendingSessionsTotalRef = useRef(0);

  useEffect(() => {
    setMobileActionsOpen(false);
  }, [selected?.session.id]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  async function loadIdentityAndPresence() {
    try {
      const meResponse = await fetch("/api/auth/session", {
        cache: "no-store",
      });
      const me = (await readJson(meResponse)) as {
        ok?: boolean;
        error?: string;
        session?: CurrentUser;
      };
      if (!meResponse.ok || !me.ok || !me.session?.userId)
        throw new Error(me.error || "No se pudo identificar al usuario.");
      setCurrentUser(me.session);
      const presenceResponse = await fetch("/api/advisor-presence", {
        cache: "no-store",
      });
      const data = (await readJson(
        presenceResponse,
      )) as AdvisorPresenceResponse;
      if (!presenceResponse.ok || !data.ok || !data.advisor)
        throw new Error(data.error || "No se pudo cargar la disponibilidad.");
      setPresence(data.advisor);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo cargar tu disponibilidad.",
      );
    }
  }

  async function changePresence(status: AdvisorStatus) {
    setPresenceLoading(true);

    try {
      const response = await fetch("/api/advisor-presence", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await readJson(response)) as AdvisorPresenceResponse;

      if (!response.ok || !data.ok || !data.advisor) {
        throw new Error(data.error || "No se pudo guardar la disponibilidad.");
      }

      setPresence(data.advisor);
      setError("");

      const assignedPendingCount = Math.max(
        0,
        Number(data.assignedPendingCount) || 0,
      );

      if (assignedPendingCount > 0) {
        setActionMessage(
          assignedPendingCount === 1
            ? "Se asignó 1 conversación pendiente."
            : `Se asignaron ${assignedPendingCount} conversaciones pendientes.`,
        );
        await loadList(false);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo guardar la disponibilidad.",
      );
    } finally {
      setPresenceLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser?.userId || presence?.status !== "available") {
      return;
    }

    let cancelled = false;

    const heartbeat = async () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch("/api/advisor-presence", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "available" }),
          cache: "no-store",
        });
        const data = (await readJson(response)) as AdvisorPresenceResponse;

        if (cancelled || !response.ok || !data.ok || !data.advisor) {
          return;
        }

        setPresence(data.advisor);

        const assignedPendingCount = Math.max(
          0,
          Number(data.assignedPendingCount) || 0,
        );

        if (assignedPendingCount > 0) {
          setActionMessage(
            assignedPendingCount === 1
              ? "Se asignó 1 conversación pendiente."
              : `Se asignaron ${assignedPendingCount} conversaciones pendientes.`,
          );
          await loadList(false);
        }
      } catch {
        // La bandeja sigue operando; el próximo heartbeat reintentará.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void heartbeat();
      }
    };

    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 60_000);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [currentUser?.userId, presence?.status]);

  async function readJson(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(text || "La respuesta de Chat Pro no fue válida.");
    }

    return response.json();
  }

  async function loadList(
    showSpinner = true,
    options: {
      append?: boolean;
      reset?: boolean;
    } = {},
  ) {
    const append = options.append === true;
    const reset = options.reset === true;

    if (append) {
      setLoadingMoreSessions(true);
    } else if (showSpinner) {
      setLoadingList(true);
    }

    try {
      const loadedOffset = nextSessionsOffsetRef.current;
      const loadedPending = pendingSessionsTotalRef.current;
      const requestedOffset = append ? loadedOffset : 0;
      const requestedLimit = append
        ? 20
        : reset
          ? 20
          : Math.max(loadedOffset + loadedPending, 20);

      const params = new URLSearchParams({
        status: filter,
        limit: String(requestedLimit),
        offset: String(requestedOffset),
      });

      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }

      const response = await fetch(`/api/inbox?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await readJson(response)) as ApiList;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo cargar la bandeja.");
      }

      const incoming = data.sessions ?? [];

      if (append) {
        setSessions((current) => {
          const merged = new Map(
            current.map((session) => [session.id, session]),
          );

          for (const session of incoming) {
            merged.set(session.id, session);
          }

          return Array.from(merged.values()).sort((a, b) => {
            const aPending = a.pendingCount > 0;
            const bPending = b.pendingCount > 0;

            if (aPending !== bPending) {
              return aPending ? -1 : 1;
            }

            if (aPending && bPending) {
              const aSince = new Date(
                a.pendingSince ?? a.lastMessageAt,
              ).getTime();
              const bSince = new Date(
                b.pendingSince ?? b.lastMessageAt,
              ).getTime();

              return aSince - bSince;
            }

            return (
              new Date(b.lastMessageAt).getTime() -
              new Date(a.lastMessageAt).getTime()
            );
          });
        });
      } else {
        setSessions(incoming);
      }

      setHasMoreSessions(data.hasMore === true);
      const resolvedNextOffset = Math.max(
        0,
        Number(data.nextOffset) || 0,
      );

      nextSessionsOffsetRef.current = resolvedNextOffset;
      pendingSessionsTotalRef.current = Math.max(
        0,
        Number(data.pendingTotal) || 0,
      );
      setNextSessionsOffset(resolvedNextOffset);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo cargar la bandeja.",
      );
    } finally {
      if (append) {
        setLoadingMoreSessions(false);
      } else if (showSpinner) {
        setLoadingList(false);
      }
    }
  }

  function blankTemplateVariables(
    template: WhatsappTemplate,
  ): Record<string, string> {
    return Object.fromEntries(
      whatsappTemplateVariableKeys(template).map((key) => [key, ""]),
    );
  }

  function selectWhatsappTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    setTemplateError("");

    const template =
      whatsappTemplates.find((item) => item.id === templateId) ?? null;

    setTemplateVariables(template ? blankTemplateVariables(template) : {});
  }

  async function openWhatsappTemplateDialog() {
    if (!selected || selected.historyRestricted) return;

    setTemplateOpen(true);
    setTemplateLoading(true);
    setTemplateError("");

    try {
      const response = await fetch("/api/whatsapp-templates", {
        cache: "no-store",
      });
      const data = (await readJson(response)) as WhatsappTemplatesResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudieron cargar las plantillas.");
      }

      const approved = (data.templates ?? []).filter(
        (template) => template.status.trim().toUpperCase() === "APPROVED",
      );
      const bindings = data.bindings ?? [];
      const events = data.eventDefinitions ?? [];

      setWhatsappTemplates(approved);
      setWhatsappTemplateBindings(bindings);
      setWhatsappTemplateEvents(events);

      const existing =
        preparedTemplate?.sessionId === selected.session.id
          ? (approved.find(
              (template) => template.id === preparedTemplate.templateId,
            ) ?? null)
          : null;
      const initial = existing ?? approved[0] ?? null;

      setSelectedTemplateId(initial?.id ?? "");
      setTemplateVariables(
        existing && preparedTemplate
          ? preparedTemplate.variables
          : initial
            ? blankTemplateVariables(initial)
            : {},
      );
    } catch (caught) {
      setWhatsappTemplates([]);
      setWhatsappTemplateBindings([]);
      setWhatsappTemplateEvents([]);
      setSelectedTemplateId("");
      setTemplateVariables({});
      setTemplateError(
        caught instanceof Error
          ? caught.message
          : "No se pudieron cargar las plantillas.",
      );
    } finally {
      setTemplateLoading(false);
    }
  }

  function prepareWhatsappTemplate() {
    if (!selected) return;

    const template =
      whatsappTemplates.find((item) => item.id === selectedTemplateId) ?? null;

    if (!template) {
      setTemplateError("Selecciona una plantilla aprobada.");
      return;
    }

    const variableKeys = whatsappTemplateVariableKeys(template);
    const missing = variableKeys.filter(
      (key) => !templateVariables[key]?.trim(),
    );

    if (missing.length) {
      setTemplateError(
        `Completa ${
          missing.length === 1
            ? `la variable ${missing[0]}`
            : `las variables ${missing.join(", ")}`
        }.`,
      );
      return;
    }

    const usageLabels = whatsappTemplateUsageLabels(
      template.id,
      whatsappTemplateBindings,
      whatsappTemplateEvents,
    );

    setPreparedTemplate({
      sessionId: selected.session.id,
      templateId: template.id,
      name: template.name,
      language: template.language,
      variables: { ...templateVariables },
      preview: renderWhatsappTemplatePreview(template, templateVariables),
      usageLabels,
    });
    setTemplateOpen(false);
    setTemplateError("");
    setActionMessage(
      `Plantilla ${template.name} preparada. Todavía no se ha enviado.`,
    );
  }

  function editPreparedWhatsappTemplate() {
    if (!preparedTemplate) return;

    setSelectedTemplateId(preparedTemplate.templateId);
    setTemplateVariables({ ...preparedTemplate.variables });
    setTemplateError("");
    setTemplateOpen(true);
  }

  async function sendPreparedWhatsappTemplate() {
    if (!selected || !preparedTemplate || templateSending) return;

    if (preparedTemplate.sessionId !== selected.session.id) {
      setError("La plantilla preparada no corresponde a esta conversación.");
      return;
    }

    setTemplateSending(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selected.session.id,
          action: "template",
          templateId: preparedTemplate.templateId,
          variables: preparedTemplate.variables,
        }),
      });
      const data = (await readJson(response)) as {
        ok?: boolean;
        error?: string;
        warning?: string | null;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo enviar la plantilla.");
      }

      const sessionId = selected.session.id;

      setPreparedTemplate(null);
      setTemplateOpen(false);
      setSelectedTemplateId("");
      setTemplateVariables({});
      await loadList(false);
      await openConversation(sessionId, true);
      setActionMessage(
        data.warning?.trim() ||
          "Plantilla enviada por WhatsApp. La conversación quedó abierta para continuar como asesor.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo enviar la plantilla.",
      );
    } finally {
      setTemplateSending(false);
    }
  }

  async function loadQuickReplies() {
    try {
      const response = await fetch("/api/quick-replies", { cache: "no-store" });
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

  async function openConversation(
    sessionId: string,
    silent = false,
    afterCreatedAt = "",
  ) {
    const requestId = ++conversationRequestRef.current;

    if (!silent) {
      setLoadingChat(true);
    }

    try {
      const params = new URLSearchParams({ sessionId });

      if (silent && afterCreatedAt) {
        params.set("after", afterCreatedAt);
      }

      const response = await fetch(`/api/inbox?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await readJson(response)) as ApiConversation;

      if (requestId !== conversationRequestRef.current) {
        return;
      }

      if (!response.ok || !data.ok || !data.session || !data.company) {
        throw new Error(data.error || "No se pudo abrir la conversación.");
      }

      const company = data.company;
      const session = data.session;

      if (silent) {
        setSelected((current) => {
          if (!current || current.session.id !== sessionId) {
            return current;
          }

          const combined = [...current.messages, ...(data.messages ?? [])];
          const uniqueMessages: InboxMessage[] = [];
          const seen = new Set<string>();

          for (const item of combined) {
            const key =
              item.id ??
              `${item.sessionId}-${item.createdAt ?? ""}-${item.authorType}-${item.message}`;

            if (seen.has(key)) {
              continue;
            }

            seen.add(key);
            uniqueMessages.push(item);
          }

          uniqueMessages.sort((first, second) => {
            const firstTime = first.createdAt
              ? new Date(first.createdAt).getTime()
              : 0;
            const secondTime = second.createdAt
              ? new Date(second.createdAt).getTime()
              : 0;

            return firstTime - secondTime;
          });

          return {
            ...current,
            company,
            session,
            contact: data.contact ?? current.contact,
            messages: uniqueMessages,
            historyRestricted: data.historyRestricted === true,
          };
        });
      } else {
        setSelected({
          company,
          session,
          contact: data.contact ?? null,
          messages: data.messages ?? [],
          historyRestricted: data.historyRestricted === true,
        });

        setMessage("");
        setQuickReplyOpen(false);
        setActionMessage("");
        setPreparedTemplate(null);
        setTemplateOpen(false);
        setSelectedTemplateId("");
        setTemplateVariables({});
        setTemplateError("");
      }

      setError("");
    } catch (caught) {
      if (requestId !== conversationRequestRef.current) {
        return;
      }

      if (!silent) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No se pudo abrir la conversación.",
        );
      }
    } finally {
      if (!silent && requestId === conversationRequestRef.current) {
        setLoadingChat(false);
      }
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
        throw new Error(
          data.error || data.message || "No se pudo completar la acción.",
        );
      }

      if (action === "message") {
        setMessage("");
        setQuickReplyOpen(false);
      }

      await loadList(false);
      await openConversation(selected.session.id);

      const actionLabels: Record<
        "take" | "close" | "resume_ai" | "message",
        string
      > = {
        take: "Conversación tomada. La IA queda pausada mientras respondes.",
        message: "Mensaje enviado por WhatsApp.",
        resume_ai: "Conversación devuelta a la IA.",
        close: "Conversación finalizada.",
      };

      setActionMessage(actionLabels[action]);
    } catch (caught) {
      setActionMessage("");
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo completar la acción.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function openTransferDialog() {
    if (!selected) return;

    setTransferLoading(true);
    setTransferOpen(true);
    setTransferTargets([]);
    setTransferTargetUserId("");
    setError("");

    try {
      const response = await fetch("/api/inbox?mode=transfer-targets", {
        cache: "no-store",
      });
      const data = (await readJson(response)) as TransferTargetsResponse;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "No se pudieron cargar los asesores disponibles.",
        );
      }

      const targets = (data.targets ?? []).filter(
        (target) => target.userId !== selected.session.assignedToUserId,
      );

      setTransferTargets(targets);
      setTransferTargetUserId(targets[0]?.userId ?? "");
    } catch (caught) {
      setTransferOpen(false);
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudieron cargar los asesores disponibles.",
      );
    } finally {
      setTransferLoading(false);
    }
  }

  async function confirmTransfer() {
    if (!selected || !transferTargetUserId) return;

    const target = transferTargets.find(
      (item) => item.userId === transferTargetUserId,
    );

    setTransferLoading(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selected.session.id,
          action: "transfer",
          targetUserId: transferTargetUserId,
        }),
      });
      const data = (await readJson(response)) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ||
            data.message ||
            "No se pudo transferir la conversación.",
        );
      }

      setTransferOpen(false);
      setTransferTargets([]);
      setTransferTargetUserId("");
      setSelected(null);
      await loadList(false);
      setActionMessage(
        `Conversación transferida a ${target?.fullName ?? "otro asesor"}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo transferir la conversación.",
      );
    } finally {
      setTransferLoading(false);
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
        throw new Error(
          data.error || "No se pudo iniciar la prueba del agente.",
        );
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

  async function sendInternalTestMessage(event: FormEvent<HTMLFormElement>) {
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
        throw new Error(
          data.error || "No se pudo enviar el mensaje de prueba.",
        );
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

  function stopAudioTracks() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function clearAudioDraft() {
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
    }

    setAudioBlob(null);
    setAudioPreviewUrl("");
    setRecordingSeconds(0);
    audioChunksRef.current = [];
  }

  async function startAudioRecording() {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError(
        "Este navegador no permite grabar audio. Usa Chrome, Safari o Edge actualizado.",
      );
      return;
    }

    try {
      clearAudioDraft();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      mediaStreamRef.current = stream;

      const candidates = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = candidates.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      setRecordingSeconds(0);
      setError("");

      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        clearRecordingTimer();
        stopAudioTracks();
        setRecording(false);

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        if (!blob.size) {
          setError("No se pudo guardar la grabación.");
          return;
        }

        const preview = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioPreviewUrl(preview);
      };

      recorder.start(250);
      setRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => {
          if (current >= 119) {
            mediaRecorderRef.current?.stop();
            return 120;
          }

          return current + 1;
        });
      }, 1000);
    } catch (caught) {
      stopAudioTracks();
      clearRecordingTimer();
      setRecording(false);
      setError(
        caught instanceof Error
          ? `No se pudo usar el micrófono: ${caught.message}`
          : "No se pudo usar el micrófono.",
      );
    }
  }

  function stopAudioRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  }

  function cancelAudioRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }

    stopAudioTracks();
    clearRecordingTimer();
    setRecording(false);
    clearAudioDraft();
  }

  async function sendAudioRecording() {
    if (!selected?.session.id || !audioBlob) return;

    setAudioSending(true);
    setError("");

    try {
      const extension = audioBlob.type.includes("mp4")
        ? "m4a"
        : audioBlob.type.includes("ogg")
          ? "ogg"
          : "webm";
      const form = new FormData();
      form.set("sessionId", selected.session.id);
      form.set(
        "audio",
        new File([audioBlob], `audio.${extension}`, {
          type: audioBlob.type || "audio/webm",
        }),
      );

      const response = await fetch("/api/inbox/audio", {
        method: "POST",
        body: form,
      });
      const data = (await readJson(response)) as ApiConversation & {
        message?: string;
      };

      if (!response.ok || !data.ok || !data.conversation) {
        throw new Error(
          data.error || data.message || "No se pudo enviar el audio.",
        );
      }

      setSelected(data.conversation);
      clearAudioDraft();
      setActionMessage("Audio enviado.");
      await loadList(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo enviar el audio.",
      );
    } finally {
      setAudioSending(false);
    }
  }

  function clearImageDraft() {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    setImageFile(null);
    setImagePreviewUrl("");

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  function selectImage(file?: File | null) {
    if (!file) return;

    const allowed = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ]);

    if (!allowed.has(file.type)) {
      setError("Formato no permitido. Usa JPG, PNG o WEBP.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("La imagen supera el límite de 8 MB.");
      return;
    }

    clearImageDraft();
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setQuickReplyOpen(false);
    setError("");
  }

  async function sendSelectedImage() {
    if (!selected?.session.id || !imageFile) return;

    setImageSending(true);
    setError("");
    setActionMessage("");

    try {
      const form = new FormData();
      form.set("sessionId", selected.session.id);
      form.set("image", imageFile, imageFile.name || "imagen.jpg");

      if (message.trim()) {
        form.set("caption", message.trim().slice(0, 1024));
      }

      const response = await fetch("/api/inbox/image", {
        method: "POST",
        body: form,
      });
      const data = (await readJson(response)) as ApiConversation & {
        message?: string;
      };

      if (!response.ok || !data.ok || !data.conversation) {
        throw new Error(
          data.error || data.message || "No se pudo enviar la imagen.",
        );
      }

      setSelected(data.conversation);
      clearImageDraft();
      setMessage("");
      setActionMessage("Imagen enviada.");
      await loadList(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo enviar la imagen.",
      );
    } finally {
      setImageSending(false);
    }
  }

  function formatRecordingTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;

    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (imageFile) {
      await sendSelectedImage();
      return;
    }

    if (!message.trim()) return;

    await runAction("message");
  }

  useEffect(() => {
    if (!audioBlob || recording || audioSending) {
      return;
    }

    const handleEnter = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void sendAudioRecording();
      }
    };

    window.addEventListener("keydown", handleEnter);

    return () => {
      window.removeEventListener("keydown", handleEnter);
    };
  }, [audioBlob, recording, audioSending, selected?.session.id]);

  useEffect(() => {
    let alive = true;

    async function loadCapabilities() {
      try {
        const response = await fetch("/api/auth/capabilities", {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          ok?: boolean;
          capabilities?: {
            testAgent?: boolean;
            storefront?: boolean;
            manageClients?: boolean;
            sendAudio?: boolean;
          };
        };

        if (alive) {
          const allowed =
            response.ok && data.ok === true && Boolean(data.capabilities);

          setCanTestAgent(allowed && data.capabilities?.testAgent === true);
          setCanOpenStorefront(
            allowed && data.capabilities?.storefront === true,
          );
          setCanManageClients(
            allowed && data.capabilities?.manageClients === true,
          );
          setCanSendAudio(allowed && data.capabilities?.sendAudio === true);
        }
      } catch {
        if (alive) {
          setCanTestAgent(false);
          setCanOpenStorefront(false);
          setCanManageClients(false);
          setCanSendAudio(false);
        }
      }
    }

    void loadCapabilities();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }

      stopAudioTracks();
      clearRecordingTimer();

      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    };
  }, [audioPreviewUrl]);

  useEffect(() => {
    void loadQuickReplies();
    void loadIdentityAndPresence();

    const targetSession = new URLSearchParams(window.location.search).get(
      "session",
    );

    if (targetSession) {
      void openConversation(targetSession);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(mobileSearch.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [mobileSearch]);

  useEffect(() => {
    void loadList(true, { reset: true });

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadList(false);
      }
    }, 12000);

    return () => window.clearInterval(timer);
  }, [filter, debouncedSearch]);

  const selectedLastMessageAt =
    selected?.messages[selected.messages.length - 1]?.createdAt ?? "";

  useEffect(() => {
    const sessionId = selected?.session.id;
    const isInternal = selected?.session.context?.internal_test === true;

    if (!sessionId || isInternal) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void openConversation(sessionId, true, selectedLastMessageAt);
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [
    selected?.session.id,
    selected?.session.context?.internal_test,
    selectedLastMessageAt,
  ]);

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

  useEffect(() => {
    const feed = messageFeedRef.current;

    if (!feed || !selected?.session.id) {
      return;
    }

    const keepHorizontalPosition = () => {
      if (feed.scrollLeft !== 0) {
        feed.scrollLeft = 0;
      }
    };

    feed.scrollLeft = 0;
    feed.addEventListener("scroll", keepHorizontalPosition, { passive: true });

    return () => {
      feed.removeEventListener("scroll", keepHorizontalPosition);
    };
  }, [selected?.session.id]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActionMessage("");
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, [actionMessage]);

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

  async function openStorefront() {
    if (storefrontUrl) {
      window.open(storefrontUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setStorefrontLoading(true);
    setStorefrontError("");

    try {
      const response = await fetch("/api/storefront", {
        cache: "no-store",
      });
      const data = (await readJson(response)) as StorefrontResponse;
      const url =
        typeof data.storefrontUrl === "string" ? data.storefrontUrl.trim() : "";

      if (!response.ok || !data.ok || !url) {
        throw new Error(data.error || "No se pudo abrir la tienda conectada.");
      }

      setStorefrontUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setStorefrontError(
        caught instanceof Error
          ? caught.message
          : "No se pudo abrir la tienda conectada.",
      );
    } finally {
      setStorefrontLoading(false);
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
        throw new Error(
          data.error || "No se pudo guardar la ficha del cliente.",
        );
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
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo guardar la ficha del cliente.",
      );
    } finally {
      setContactSaving(false);
    }
  }

  function chooseQuickReply(reply: QuickReply) {
    setMessage(reply.body);
    setQuickReplyOpen(false);
  }

  const visibleSessions = sessions;

  const selectedStatus = selected?.session.attentionStatus;
  const showTakeButton =
    !isInternalTest && selected?.session.takeAvailable === true;
  const showHumanActions = !isInternalTest && selectedStatus === "human";

  return (
    <main
      className={`chatpro-shell ${selected ? "mobile-conversation-shell" : ""}`}
    >
      <AppSidebar
        companyName={currentUser?.companyName ?? "Empresa"}
        hideMobileNavigation={Boolean(selected)}
      />

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
            <select
              value={presence?.status ?? "offline"}
              disabled={presenceLoading || !currentUser}
              onChange={(event) =>
                void changePresence(event.target.value as AdvisorStatus)
              }
            >
              {Object.entries(advisorStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="channel-tabs" aria-label="Canales">
          <button className="channel-tab active" type="button">
            <span className="whatsapp-icon">◔</span> WhatsApp
          </button>
          {canTestAgent ? (
            <button
              className="channel-tab"
              type="button"
              onClick={() => void startInternalTest()}
              disabled={internalTestLoading}
            >
              {internalTestLoading ? "Preparando prueba…" : "Probar agente"}
            </button>
          ) : null}
          <button className="channel-tab" type="button" disabled>
            Instagram <small>Próximamente</small>
          </button>
          <button className="channel-tab" type="button" disabled>
            Messenger <small>Próximamente</small>
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {actionMessage ? (
          <div className="success-banner">{actionMessage}</div>
        ) : null}

        {transferOpen ? (
          <div
            className="transfer-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !transferLoading) {
                setTransferOpen(false);
              }
            }}
          >
            <section
              className="transfer-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-dialog-title"
            >
              <div className="transfer-dialog-heading">
                <div>
                  <p className="eyebrow">Transferencia</p>
                  <h2 id="transfer-dialog-title">Transferir conversación</h2>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar"
                  disabled={transferLoading}
                  onClick={() => setTransferOpen(false)}
                >
                  ×
                </button>
              </div>

              <p className="transfer-dialog-copy">
                El nuevo asesor podrá ver inmediatamente todo el historial y
                responder. Tú dejarás de tener acceso a esta conversación.
              </p>

              {transferTargets.length ? (
                <label className="transfer-field">
                  <span>Nuevo asesor</span>
                  <select
                    value={transferTargetUserId}
                    disabled={transferLoading}
                    onChange={(event) =>
                      setTransferTargetUserId(event.target.value)
                    }
                  >
                    {transferTargets.map((target) => (
                      <option key={target.userId} value={target.userId}>
                        {target.fullName} · {target.roleName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="transfer-empty">
                  No hay otro asesor activo con permisos para recibir esta
                  conversación.
                </p>
              )}

              <div className="transfer-dialog-actions">
                <button
                  className="button quiet"
                  type="button"
                  disabled={transferLoading}
                  onClick={() => setTransferOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  className="button primary"
                  type="button"
                  disabled={transferLoading || !transferTargetUserId}
                  onClick={() => void confirmTransfer()}
                >
                  {transferLoading
                    ? "Transfiriendo…"
                    : "Confirmar transferencia"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {templateOpen ? (
          <div
            className="transfer-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !templateLoading) {
                setTemplateOpen(false);
              }
            }}
          >
            <section
              className="transfer-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="template-dialog-title"
              style={{ maxWidth: 680 }}
            >
              <div className="transfer-dialog-heading">
                <div>
                  <p className="eyebrow">WhatsApp</p>
                  <h2 id="template-dialog-title">
                    Preparar plantilla aprobada
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar"
                  disabled={templateLoading}
                  onClick={() => setTemplateOpen(false)}
                >
                  ×
                </button>
              </div>

              <p className="transfer-dialog-copy">
                Revisa el contenido y completa las variables. En este bloque la
                plantilla quedará preparada, pero no será enviada.
              </p>

              {templateLoading ? (
                <p className="transfer-empty">Cargando plantillas aprobadas…</p>
              ) : templateError && !whatsappTemplates.length ? (
                <p className="error-banner">{templateError}</p>
              ) : !whatsappTemplates.length ? (
                <p className="transfer-empty">
                  Esta empresa no tiene plantillas aprobadas disponibles.
                </p>
              ) : (
                (() => {
                  const currentTemplate =
                    whatsappTemplates.find(
                      (template) => template.id === selectedTemplateId,
                    ) ??
                    whatsappTemplates[0] ??
                    null;

                  if (!currentTemplate) return null;

                  const variableKeys =
                    whatsappTemplateVariableKeys(currentTemplate);
                  const usageLabels = whatsappTemplateUsageLabels(
                    currentTemplate.id,
                    whatsappTemplateBindings,
                    whatsappTemplateEvents,
                  );

                  return (
                    <>
                      <label className="transfer-field">
                        <span>Plantilla</span>
                        <select
                          value={currentTemplate.id}
                          disabled={templateLoading}
                          onChange={(event) =>
                            selectWhatsappTemplate(event.target.value)
                          }
                        >
                          {whatsappTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name} · {template.language}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                          padding: 14,
                          border: "1px solid rgba(148, 163, 184, 0.28)",
                          borderRadius: 14,
                          background: "rgba(15, 23, 42, 0.04)",
                        }}
                      >
                        <strong>Vista previa</strong>
                        <p
                          style={{
                            margin: 0,
                            whiteSpace: "pre-wrap",
                            lineHeight: 1.55,
                          }}
                        >
                          {renderWhatsappTemplatePreview(
                            currentTemplate,
                            templateVariables,
                          )}
                        </p>

                        <small>
                          Categoría:{" "}
                          {currentTemplate.category || "Sin categoría"}
                        </small>

                        {usageLabels.length ? (
                          <small>
                            Uso configurado: {usageLabels.join(" · ")}
                          </small>
                        ) : (
                          <small>
                            Sin automatización asignada. Puede prepararse
                            manualmente desde esta conversación.
                          </small>
                        )}
                      </div>

                      {variableKeys.length ? (
                        <div
                          style={{
                            display: "grid",
                            gap: 12,
                            marginTop: 14,
                          }}
                        >
                          {variableKeys.map((key) => (
                            <label className="transfer-field" key={key}>
                              <span>
                                Variable {"{{"}
                                {key}
                                {"}}"}
                              </span>
                              <input
                                value={templateVariables[key] ?? ""}
                                disabled={templateLoading}
                                placeholder={`Valor para la variable ${key}`}
                                onChange={(event) =>
                                  setTemplateVariables((current) => ({
                                    ...current,
                                    [key]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="transfer-empty">
                          Esta plantilla no requiere variables.
                        </p>
                      )}

                      {templateError ? (
                        <p className="error-banner">{templateError}</p>
                      ) : null}
                    </>
                  );
                })()
              )}

              <div className="transfer-dialog-actions">
                <button
                  className="button quiet"
                  type="button"
                  disabled={templateLoading}
                  onClick={() => setTemplateOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    templateLoading ||
                    !whatsappTemplates.length ||
                    !selectedTemplateId
                  }
                  onClick={prepareWhatsappTemplate}
                >
                  Dejar preparada
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <div
          className={`inbox-layout ${
            selected ? "mobile-chat-open" : "mobile-list-open"
          }`}
        >
          <section className="conversation-list-panel">
            <div className="list-panel-heading">
              <div>
                <p className="mobile-list-eyebrow">Bandeja</p>
                <h2>Chats</h2>
                <p>
                  {loadingList
                    ? "Actualizando…"
                    : `${visibleSessions.length} conversaciones`}
                </p>
              </div>
              <button
                className="refresh-button"
                type="button"
                onClick={() => void loadList(true, { reset: true })}
                aria-label="Actualizar conversaciones"
                title="Actualizar conversaciones"
              >
                ↻
              </button>
            </div>

            <label className="mobile-chat-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={mobileSearch}
                onChange={(event) => setMobileSearch(event.target.value)}
                placeholder="Buscar cliente o mensaje"
                aria-label="Buscar cliente o mensaje"
              />
            </label>

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
              {!loadingList && !visibleSessions.length ? (
                <div className="empty-list">
                  {mobileSearch.trim()
                    ? "No encontramos chats con esa búsqueda."
                    : "Aún no hay chats en este filtro."}
                </div>
              ) : null}
              {visibleSessions.map((session) => {
                const customerName = customerLabel(
                  session.customerPhone,
                  session.contact,
                );

                const assignmentLabel =
                  session.attentionStatus === "ai"
                    ? session.takeAvailable
                      ? "IA inactiva · disponible"
                      : "IA"
                    : session.attentionStatus === "human"
                      ? session.assignedToName || "Asesor"
                      : session.attentionStatus === "waiting"
                        ? "Sin asignar"
                        : "Finalizado";

                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`conversation-row status-${session.attentionStatus} ${
                      selected?.session.id === session.id ? "selected" : ""
                    } ${session.pendingCount > 0 ? "has-pending" : ""}`}
                    onClick={() => void openConversation(session.id)}
                  >
                    <span className="avatar" aria-hidden="true">
                      {customerInitials(
                        session.customerPhone,
                        session.contact,
                      )}
                    </span>

                    <span className="conversation-summary">
                      <span className="conversation-topline">
                        <strong title={customerName}>{customerName}</strong>
                        <time>{formatDate(session.lastMessageAt)}</time>
                      </span>

                      <span className="conversation-preview">
                        {session.lastMessage?.message || "Sin mensajes todavía"}
                      </span>

                      <span className="conversation-bottomline">
                        <span
                          className={`conversation-assignment ${session.attentionStatus}`}
                        >
                          <span
                            className="conversation-status-dot"
                            aria-hidden="true"
                          />
                          {assignmentLabel}
                        </span>

                        {session.pendingCount > 0 ? (
                          <span
                            className="conversation-pending-count"
                            aria-label={`${session.pendingCount} mensajes pendientes`}
                            title={`${session.pendingCount} mensajes pendientes`}
                          >
                            {session.pendingCount > 99 ? "99+" : session.pendingCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}

              {hasMoreSessions ? (
                <div className="conversation-load-more-wrap">
                  <button
                    className="conversation-load-more"
                    type="button"
                    disabled={loadingMoreSessions}
                    onClick={() =>
                      void loadList(false, {
                        append: true,
                      })
                    }
                  >
                    {loadingMoreSessions
                      ? "Cargando…"
                      : "Cargar 20 conversaciones más"}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="chat-panel">
            {!selected ? (
              <div className="chat-placeholder">
                <div className="placeholder-orb">◔</div>
                <h2>Abre una conversación</h2>
                <p>
                  Desde aquí podrás ver el historial, tomar el chat y responder
                  como asesor.
                </p>
              </div>
            ) : (
              <>
                <header className="chat-header">
                  <div className="chat-identity">
                    <button
                      className="mobile-back-button"
                      type="button"
                      onClick={() => setSelected(null)}
                      aria-label="Volver a la lista de chats"
                      title="Volver a chats"
                    >
                      ‹
                    </button>
                    <span className="mobile-chat-avatar" aria-hidden="true">
                      {selected.session.customerPhone.slice(-2) || "CP"}
                    </span>
                    <div className="chat-heading-copy">
                      <p className="eyebrow">
                        {isInternalTest
                          ? "Prueba interna · no envía WhatsApp"
                          : "WhatsApp"}
                      </p>
                      <h2>
                        {isInternalTest
                          ? `Probar a ${selected.company.name}`
                          : customerLabel(
                              selected.session.customerPhone,
                              selected.contact,
                            )}
                      </h2>
                      <p className="chat-subtitle">
                        {isInternalTest
                          ? "Conversación real con el agente y las integraciones de esta empresa."
                          : `${statusLabel[selected.session.attentionStatus]}${selected.session.assignedToName ? ` · ${selected.session.assignedToName}` : ""}`}
                      </p>
                    </div>

                    <div className="mobile-chat-menu-wrap">
                      <button
                        className="mobile-chat-menu-button"
                        type="button"
                        aria-label="Abrir acciones de la conversación"
                        aria-expanded={mobileActionsOpen}
                        onClick={() =>
                          setMobileActionsOpen((current) => !current)
                        }
                      >
                        <span aria-hidden="true">⋮</span>
                      </button>

                      {mobileActionsOpen ? (
                        <>
                          <button
                            className="mobile-chat-menu-backdrop"
                            type="button"
                            aria-label="Cerrar acciones"
                            onClick={() => setMobileActionsOpen(false)}
                          />
                          <div
                            className="mobile-chat-menu-popover"
                            role="menu"
                            aria-label="Acciones de la conversación"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMobileActionsOpen(false);
                                window.location.assign("/clientes");
                              }}
                            >
                              Ir a Clientes
                            </button>

                            {isInternalTest ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={internalTestLoading}
                                onClick={() => {
                                  setMobileActionsOpen(false);
                                  void startInternalTest();
                                }}
                              >
                                {internalTestLoading
                                  ? "Reiniciando…"
                                  : "Nueva prueba"}
                              </button>
                            ) : null}

                            {!isInternalTest &&
                            selected.historyRestricted !== true ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={templateLoading}
                                onClick={() => {
                                  setMobileActionsOpen(false);
                                  void openWhatsappTemplateDialog();
                                }}
                              >
                                {templateLoading
                                  ? "Cargando plantillas…"
                                  : "Usar plantilla"}
                              </button>
                            ) : null}

                            {showTakeButton ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={actionLoading}
                                onClick={() => {
                                  setMobileActionsOpen(false);
                                  void runAction("take");
                                }}
                              >
                                {actionLoading
                                  ? "Tomando…"
                                  : "Tomar conversación"}
                              </button>
                            ) : null}

                            {showHumanActions ? (
                              <>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={actionLoading}
                                  onClick={() => {
                                    setMobileActionsOpen(false);
                                    void runAction("resume_ai");
                                  }}
                                >
                                  Devolver a IA
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={actionLoading || transferLoading}
                                  onClick={() => {
                                    setMobileActionsOpen(false);
                                    void openTransferDialog();
                                  }}
                                >
                                  Transferir conversación
                                </button>
                                <button
                                  className="danger"
                                  type="button"
                                  role="menuitem"
                                  disabled={actionLoading}
                                  onClick={() => {
                                    setMobileActionsOpen(false);
                                    void runAction("close");
                                  }}
                                >
                                  Finalizar conversación
                                </button>
                              </>
                            ) : null}

                            {!isInternalTest &&
                            selected.session.attentionStatus === "closed" ? (
                              <span className="mobile-chat-menu-status">
                                Conversación en historial
                              </span>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
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

                    {!isInternalTest && selected.historyRestricted !== true ? (
                      <button
                        className="button quiet"
                        type="button"
                        disabled={templateLoading}
                        onClick={() => void openWhatsappTemplateDialog()}
                      >
                        {templateLoading ? "Cargando plantillas…" : "Plantilla"}
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
                          disabled={actionLoading || transferLoading}
                          onClick={() => void openTransferDialog()}
                        >
                          {transferLoading
                            ? "Cargando…"
                            : "Transferir conversación"}
                        </button>
                        <button
                          className="button quiet"
                          type="button"
                          disabled={actionLoading}
                          onClick={() => void runAction("close")}
                        >
                          {actionLoading
                            ? "Finalizando…"
                            : "Finalizar conversación"}
                        </button>
                      </>
                    ) : null}
                    {!isInternalTest &&
                    selected.session.attentionStatus === "closed" ? (
                      <span className="history-badge">En historial</span>
                    ) : null}
                  </div>
                </header>

                <div className="message-feed" ref={messageFeedRef}>
                  {loadingChat ? (
                    <p className="feed-loading">Abriendo historial…</p>
                  ) : null}
                  {!loadingChat && !selected.messages.length ? (
                    <p className="feed-loading">
                      {isInternalTest
                        ? "Escribe como cliente para probar el agente. Esta prueba no envía mensajes por WhatsApp."
                        : selected.historyRestricted
                          ? "Esta conversación está disponible para tomar. El historial se habilitará cuando la asignes a tu usuario."
                          : "No hay mensajes todavía."}
                    </p>
                  ) : null}
                  {selected.messages.map((item) => (
                    <div
                      key={
                        item.id ??
                        `${item.sessionId}-${item.createdAt}-${item.message}`
                      }
                      className={`message-row ${item.authorType}`}
                    >
                      <div className="message-bubble">
                        <span className="message-author">
                          {item.authorType === "customer"
                            ? "Cliente"
                            : item.authorType === "advisor"
                              ? "Asesor"
                              : "IA"}
                        </span>
                        {item.messageType === "audio" && item.id ? (
                          <AudioMessagePlayer item={item} />
                        ) : item.messageType === "image" && item.id ? (
                          <>
                            <ImageMessageViewer item={item} />
                            {item.message &&
                            item.message !== "📷 Imagen recibida." ? (
                              <p>{item.message}</p>
                            ) : null}
                          </>
                        ) : (
                          <p>{item.message}</p>
                        )}
                        <time>{formatDate(item.createdAt)}</time>
                      </div>
                    </div>
                  ))}
                </div>

                {preparedTemplate?.sessionId === selected.session.id ? (
                  <div
                    style={{
                      margin: "0 16px 12px",
                      padding: 14,
                      border: "1px solid rgba(16, 185, 129, 0.35)",
                      borderRadius: 14,
                      background: "rgba(16, 185, 129, 0.08)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      <div>
                        <strong>
                          Plantilla preparada: {preparedTemplate.name}
                        </strong>
                        <p
                          style={{
                            margin: "4px 0 0",
                            whiteSpace: "pre-wrap",
                            lineHeight: 1.45,
                          }}
                        >
                          {preparedTemplate.preview}
                        </p>
                        {preparedTemplate.usageLabels.length ? (
                          <small>
                            Uso: {preparedTemplate.usageLabels.join(" · ")}
                          </small>
                        ) : null}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexShrink: 0,
                        }}
                      >
                        <button
                          className="button primary"
                          type="button"
                          disabled={templateSending}
                          onClick={() => void sendPreparedWhatsappTemplate()}
                        >
                          {templateSending ? "Enviando…" : "Enviar plantilla"}
                        </button>
                        <button
                          className="button quiet"
                          type="button"
                          disabled={templateSending}
                          onClick={editPreparedWhatsappTemplate}
                        >
                          Editar
                        </button>
                        <button
                          className="button quiet"
                          type="button"
                          disabled={templateSending}
                          onClick={() => {
                            setPreparedTemplate(null);
                            setActionMessage("Plantilla preparada descartada.");
                          }}
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                    <small>
                      Al enviarla, ChatPro la registrará en el historial y
                      dejará la conversación tomada para continuar con texto o
                      audio como asesor.
                    </small>
                  </div>
                ) : null}

                {isInternalTest ? (
                  <form
                    className="reply-box"
                    onSubmit={sendInternalTestMessage}
                  >
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
                    {recording || (audioBlob && audioPreviewUrl) ? (
                      <div
                        className={`wa-audio-composer ${
                          recording ? "recording" : "preview"
                        }`}
                      >
                        <button
                          type="button"
                          className="wa-audio-icon danger"
                          onClick={cancelAudioRecording}
                          disabled={audioSending}
                          aria-label="Eliminar grabación"
                          title="Eliminar grabación"
                        >
                          <span aria-hidden="true">⌫</span>
                        </button>

                        {recording ? (
                          <div className="wa-recording-progress">
                            <strong>
                              {formatRecordingTime(recordingSeconds)}
                            </strong>
                            <span className="wa-wave-line" aria-hidden="true">
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                            </span>
                          </div>
                        ) : (
                          <audio
                            controls
                            preload="metadata"
                            src={audioPreviewUrl}
                          />
                        )}

                        {recording ? (
                          <button
                            type="button"
                            className="wa-audio-icon stop"
                            onClick={stopAudioRecording}
                            aria-label="Detener grabación"
                            title="Detener grabación"
                          >
                            <span aria-hidden="true">■</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="wa-audio-icon send"
                            onClick={() => void sendAudioRecording()}
                            disabled={audioSending}
                            aria-label="Enviar audio"
                            title="Enviar audio"
                          >
                            <span aria-hidden="true">
                              {audioSending ? "…" : "➤"}
                            </span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {imageFile && imagePreviewUrl ? (
                          <div className="wa-image-composer">
                            <button
                              type="button"
                              className="wa-image-remove"
                              onClick={clearImageDraft}
                              disabled={imageSending}
                              aria-label="Quitar imagen"
                              title="Quitar imagen"
                            >
                              ×
                            </button>
                            <img
                              src={imagePreviewUrl}
                              alt="Vista previa de la imagen"
                            />
                            <div>
                              <strong>{imageFile.name || "Imagen"}</strong>
                              <small>
                                {(imageFile.size / 1024 / 1024).toFixed(2)} MB
                              </small>
                            </div>
                          </div>
                        ) : null}

                        <div className="reply-compose">
                          <div className="quick-reply-wrap">
                            <textarea
                              value={message}
                              onChange={(event) => {
                                const next = event.target.value;
                                setMessage(next);
                                setQuickReplyOpen(
                                  next.trimStart().startsWith("/"),
                                );
                              }}
                              onFocus={() =>
                                setQuickReplyOpen(
                                  message.trimStart().startsWith("/"),
                                )
                              }
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" &&
                                  !event.shiftKey &&
                                  !event.nativeEvent.isComposing
                                ) {
                                  event.preventDefault();

                                  if (!actionLoading && message.trim()) {
                                    void runAction("message");
                                  }
                                }
                              }}
                              placeholder="Escribe un mensaje o usa / para atajos…"
                              rows={1}
                            />
                            {visibleQuickReplies.length ? (
                              <div className="quick-reply-menu">
                                {visibleQuickReplies.map((reply) => (
                                  <button
                                    key={reply.id}
                                    type="button"
                                    onMouseDown={(event) =>
                                      event.preventDefault()
                                    }
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

                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            hidden
                            onChange={(event) =>
                              selectImage(event.target.files?.[0])
                            }
                          />
                          <button
                            type="button"
                            className="wa-idle-icon"
                            onClick={() => imageInputRef.current?.click()}
                            disabled={
                              actionLoading ||
                              audioSending ||
                              imageSending ||
                              recording
                            }
                            aria-label="Adjuntar imagen"
                            title="Adjuntar imagen"
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M21.44 11.05 12 20.5a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                            </svg>
                          </button>

                          {canSendAudio ? (
                            <button
                              type="button"
                              className="wa-idle-icon"
                              onClick={() => void startAudioRecording()}
                              disabled={actionLoading || audioSending}
                              aria-label="Grabar audio"
                              title="Grabar audio"
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <rect
                                  x="9"
                                  y="2"
                                  width="6"
                                  height="12"
                                  rx="3"
                                />
                                <path d="M5 10a7 7 0 0 0 14 0" />
                                <path d="M12 17v5" />
                                <path d="M8 22h8" />
                              </svg>
                            </button>
                          ) : null}
                        </div>

                        <button
                          className="wa-text-send"
                          type="submit"
                          disabled={
                            actionLoading ||
                            imageSending ||
                            (!message.trim() && !imageFile)
                          }
                          aria-label="Enviar mensaje"
                          title="Enviar mensaje"
                        >
                          <span aria-hidden="true">
                            {actionLoading || imageSending ? "…" : "➤"}
                          </span>
                        </button>
                      </>
                    )}
                  </form>
                ) : (
                  <div className="reply-disabled">
                    {selected.session.attentionStatus === "closed"
                      ? "Esta conversación está finalizada. Si el cliente vuelve a escribir, la IA retomará automáticamente desde el historial."
                      : selected.session.attentionStatus === "waiting"
                        ? "Este chat está pendiente de asesor. Tómalo para responder como persona."
                        : selected.session.takeBlockedReason ||
                          "La IA está atendiendo. Cuando el chat quede inactivo podrá quedar disponible para seguimiento."}
                  </div>
                )}
              </>
            )}
          </section>

          <aside className="context-panel">
            <h2>Contexto del cliente</h2>
            {!selected ? (
              <p className="muted-copy">
                Selecciona un chat para ver el contexto comercial.
              </p>
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

                {!isInternalTest && canOpenStorefront ? (
                  <section className="storefront-card">
                    <div>
                      <h3>Tienda conectada</h3>
                      <p>
                        Abre la web pública de la empresa para copiar links y
                        enviarlos al cliente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openStorefront()}
                      disabled={storefrontLoading}
                    >
                      {storefrontLoading ? "Abriendo…" : "Abrir tienda ↗"}
                    </button>
                    {storefrontError ? <small>{storefrontError}</small> : null}
                  </section>
                ) : null}

                {!isInternalTest && canManageClients ? (
                  <form
                    className="contact-card-form"
                    onSubmit={saveContactFromInbox}
                  >
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
                        onChange={(event) =>
                          setContactNotes(event.target.value)
                        }
                        placeholder="Datos útiles para vender y atender mejor. No lo ve el cliente."
                        rows={4}
                      />
                    </label>

                    <p className="contact-card-helper">
                      Separa las etiquetas con comas. Las notas son solo para el
                      equipo.
                    </p>
                  </form>
                ) : null}

                {typeof (selected.session.context as Record<string, unknown>)
                  .handoff === "object" ? (
                  <section className="contact-notes-context">
                    <h3>Transferencia a asesor</h3>
                    <p>
                      {compactTransferText(
                        (selected.session.context as Record<string, any>)
                          .handoff?.summary,
                        "Revisa el último mensaje del cliente y continúa la atención.",
                        280,
                      )}
                    </p>
                    <small>
                      <strong>Motivo:</strong>{" "}
                      {compactTransferText(
                        (selected.session.context as Record<string, any>)
                          .handoff?.reason,
                        "Requiere atención de un asesor.",
                        160,
                      )}
                    </small>
                  </section>
                ) : null}

                <section className="cart-context">
                  <div className="cart-context-heading">
                    <h3>Carrito actual</h3>
                    <strong>
                      {cartLines.length ? formatMoney(cartTotal) : "Vacío"}
                    </strong>
                  </div>
                  {cartLines.length ? (
                    <ul>
                      {cartLines.map((line, index) => (
                        <li key={`${String(line.variantId ?? index)}-${index}`}>
                          <span>{String(line.productTitle ?? "Producto")}</span>
                          <small>
                            {String(line.variantTitle ?? "")}
                            {line.quantity
                              ? ` · ${String(line.quantity)} und.`
                              : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted-copy">
                      No hay productos guardados en el carrito de esta
                      conversación.
                    </p>
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
