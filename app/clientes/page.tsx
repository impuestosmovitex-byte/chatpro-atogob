"use client";


import { AppSidebar } from '../components/AppSidebar';
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import styles from "./page.module.css";

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

type ClientSummary = {
  customerPhone: string;
  firstMessageAt: string | null;
  lastMessageAt: string;
  attentionStatus: AttentionStatus;
  assignedToName: string | null;
  totalMessages: number;
  lastMessage: InboxMessage | null;
};

type ClientProfile = {
  company: { id: string; slug: string; name: string };
  client: ClientSummary;
  session: ConversationSession;
  messages: InboxMessage[];
};

type ClientsResponse = {
  ok: boolean;
  error?: string;
  company?: { id: string; slug: string; name: string };
  clients?: ClientSummary[];
};

type ClientProfileResponse = {
  ok: boolean;
  error?: string;
  company?: ClientProfile["company"];
  client?: ClientSummary;
  session?: ConversationSession;
  messages?: InboxMessage[];
};

const COMPANY = process.env.NEXT_PUBLIC_CHATPRO_COMPANY || "atogob";

const statusLabel: Record<AttentionStatus, string> = {
  ai: "IA atendiendo",
  waiting: "Pendiente de asesor",
  human: "Tomado por asesor",
  closed: "Finalizado",
};

function formatDate(value: string | null) {
  if (!value) return "Sin registro";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Sin registro";

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function customerLabel(phone: string) {
  return phone ? `Cliente ${phone}` : "Cliente sin número";
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selected, setSelected] = useState<ClientProfile | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState("");

  async function readJson(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      const body = await response.text();
      throw new Error(body || "La respuesta de Chat Pro no fue válida.");
    }

    return response.json();
  }

  async function loadClients(nextSearch = search) {
    setLoadingList(true);

    try {
      const params = new URLSearchParams({
        company: COMPANY,
        limit: "120",
      });

      if (nextSearch.trim()) {
        params.set("search", nextSearch.trim());
      }

      const response = await fetch(`/api/clients?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await readJson(response)) as ClientsResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudieron cargar los clientes.");
      }

      setClients(data.clients ?? []);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudieron cargar los clientes.",
      );
    } finally {
      setLoadingList(false);
    }
  }

  async function openClient(phone: string) {
    setLoadingProfile(true);

    try {
      const params = new URLSearchParams({
        company: COMPANY,
        phone,
      });

      const response = await fetch(`/api/clients?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await readJson(response)) as ClientProfileResponse;

      if (
        !response.ok ||
        !data.ok ||
        !data.company ||
        !data.client ||
        !data.session
      ) {
        throw new Error(data.error || "No se pudo abrir el cliente.");
      }

      setSelected({
        company: data.company,
        client: data.client,
        session: data.session,
        messages: data.messages ?? [],
      });
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo abrir el cliente.",
      );
    } finally {
      setLoadingProfile(false);
    }
  }

  function searchClients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadClients(search);
  }

  useEffect(() => {
    void loadClients("");
  }, []);

  const totalMessages = useMemo(
    () => selected?.client.totalMessages ?? 0,
    [selected],
  );

  return (
    <main className={styles.shell}>
      <AppSidebar companyName="ATOGOB" />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CRM básico</p>
            <h1>Clientes</h1>
            <p className={styles.subheading}>
              Consulta cada cliente de WhatsApp y su historial de atención.
            </p>
          </div>
          <button
            className={styles.refreshButton}
            type="button"
            onClick={() => void loadClients(search)}
            disabled={loadingList}
          >
            {loadingList ? "Actualizando…" : "↻ Actualizar"}
          </button>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.layout}>
          <section className={styles.listPanel}>
            <form className={styles.searchForm} onSubmit={searchClients}>
              <label htmlFor="client-search">Buscar por teléfono</label>
              <div className={styles.searchRow}>
                <input
                  id="client-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ej. 3001234567"
                />
                <button type="submit">Buscar</button>
              </div>
            </form>

            <div className={styles.listHeader}>
              <div>
                <h2>Base de clientes</h2>
                <p>
                  {loadingList
                    ? "Cargando…"
                    : `${clients.length} clientes encontrados`}
                </p>
              </div>
            </div>

            <div className={styles.clientList}>
              {!loadingList && !clients.length ? (
                <div className={styles.empty}>
                  No encontramos clientes con esa búsqueda.
                </div>
              ) : null}

              {clients.map((client) => (
                <button
                  className={`${styles.clientRow} ${
                    selected?.client.customerPhone === client.customerPhone
                      ? styles.selectedRow
                      : ""
                  }`}
                  key={client.customerPhone}
                  type="button"
                  onClick={() => void openClient(client.customerPhone)}
                >
                  <span className={styles.avatar}>
                    {client.customerPhone.slice(-2) || "CP"}
                  </span>
                  <span className={styles.clientSummary}>
                    <span className={styles.clientTopLine}>
                      <strong>{customerLabel(client.customerPhone)}</strong>
                      <time>{formatDate(client.lastMessageAt)}</time>
                    </span>
                    <span className={styles.preview}>
                      {client.lastMessage?.message || "Sin mensajes todavía"}
                    </span>
                    <span
                      className={`${styles.status} ${
                        styles[`status_${client.attentionStatus}`]
                      }`}
                    >
                      {statusLabel[client.attentionStatus]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.profilePanel}>
            {!selected ? (
              <div className={styles.placeholder}>
                <div className={styles.placeholderOrb}>◌</div>
                <h2>Selecciona un cliente</h2>
                <p>
                  Aquí verás su actividad, estado de atención e historial de
                  mensajes.
                </p>
              </div>
            ) : (
              <>
                <header className={styles.profileHeader}>
                  <div>
                    <p className={styles.eyebrow}>Perfil de cliente</p>
                    <h2>{customerLabel(selected.client.customerPhone)}</h2>
                    <p>{selected.company.name} · WhatsApp</p>
                  </div>
                  <button
                    className={styles.inboxButton}
                    type="button"
                    onClick={() => window.location.assign("/")}
                  >
                    Abrir Bandeja
                  </button>
                </header>

                <div className={styles.profileData}>
                  <article>
                    <span>Teléfono</span>
                    <strong>{selected.client.customerPhone}</strong>
                  </article>
                  <article>
                    <span>Estado</span>
                    <strong>{statusLabel[selected.client.attentionStatus]}</strong>
                  </article>
                  <article>
                    <span>Mensajes</span>
                    <strong>{totalMessages}</strong>
                  </article>
                  <article>
                    <span>Primera interacción</span>
                    <strong>{formatDate(selected.client.firstMessageAt)}</strong>
                  </article>
                  <article>
                    <span>Última actividad</span>
                    <strong>{formatDate(selected.client.lastMessageAt)}</strong>
                  </article>
                  <article>
                    <span>Asignado a</span>
                    <strong>{selected.client.assignedToName || "Sin asignar"}</strong>
                  </article>
                </div>

                <section className={styles.history}>
                  <div className={styles.historyHeader}>
                    <div>
                      <p className={styles.eyebrow}>Historial</p>
                      <h3>Mensajes de la conversación</h3>
                    </div>
                    {loadingProfile ? <span>Cargando…</span> : null}
                  </div>

                  <div className={styles.messageFeed}>
                    {!loadingProfile && !selected.messages.length ? (
                      <p className={styles.empty}>No hay mensajes todavía.</p>
                    ) : null}

                    {selected.messages.map((message) => (
                      <article
                        className={`${styles.message} ${
                          styles[`message_${message.authorType}`]
                        }`}
                        key={
                          message.id ??
                          `${message.sessionId}-${message.createdAt}-${message.message}`
                        }
                      >
                        <span>
                          {message.authorType === "customer"
                            ? "Cliente"
                            : message.authorType === "advisor"
                              ? "Asesor"
                              : "IA"}
                        </span>
                        <p>{message.message}</p>
                        <time>{formatDate(message.createdAt)}</time>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
