"use client";

import { AppSidebar } from '../components/AppSidebar';
import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type AttentionStatus = "ai" | "waiting" | "human" | "closed";
type Channel = "whatsapp" | "instagram" | "messenger" | "manual";

type Contact = {
  id: string;
  companyId: string;
  phone: string;
  displayName: string | null;
  primaryChannel: Channel;
  tags: string[];
  notes: string;
  firstSeenAt: string | null;
  lastActivityAt: string | null;
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
  assignedToName: string | null;
  takenAt: string | null;
  closedAt: string | null;
};

type ClientSummary = {
  customerPhone: string;
  contact: Contact | null;
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

type SaveResponse = {
  ok: boolean;
  error?: string;
  contact?: Contact;
  session?: ConversationSession;
};

const statusLabel: Record<AttentionStatus, string> = {
  ai: "IA atendiendo",
  waiting: "Pendiente de asesor",
  human: "Tomado por asesor",
  closed: "Finalizado",
};

const channelLabel: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  manual: "Manual",
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

function customerLabel(client: ClientSummary) {
  return client.contact?.displayName || `Cliente ${client.customerPhone}`;
}

function initials(value: string) {
  const clean = value.trim();
  if (!clean) return "CP";
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

function tagInput(tags: string[]) {
  return tags.join(", ");
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selected, setSelected] = useState<ClientProfile | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [companyName, setCompanyName] = useState("Empresa");

  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newNotes, setNewNotes] = useState("");

  async function readJson(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await response.text();
      throw new Error(body || "La respuesta de Chat Pro no fue válida.");
    }
    return response.json();
  }

  function syncEditor(profile: ClientProfile) {
    setEditName(profile.client.contact?.displayName ?? "");
    setEditTags(tagInput(profile.client.contact?.tags ?? []));
    setEditNotes(profile.client.contact?.notes ?? "");
  }

  async function loadClients(nextSearch = search) {
    setLoadingList(true);
    try {
      const params = new URLSearchParams({ limit: "120" });
      if (nextSearch.trim()) params.set("search", nextSearch.trim());

      const response = await fetch(`/api/clients?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await readJson(response)) as ClientsResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudieron cargar los clientes.");
      }
      setClients(data.clients ?? []);
      setCompanyName(data.company?.name || "Empresa");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los clientes.");
    } finally {
      setLoadingList(false);
    }
  }

  async function openClient(phone: string) {
    setLoadingProfile(true);
    try {
      const params = new URLSearchParams({ phone });
      const response = await fetch(`/api/clients?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await readJson(response)) as ClientProfileResponse;
      if (!response.ok || !data.ok || !data.company || !data.client || !data.session) {
        throw new Error(data.error || "No se pudo abrir el cliente.");
      }
      const profile = {
        company: data.company,
        client: data.client,
        session: data.session,
        messages: data.messages ?? [],
      };
      setSelected(profile);
      setCompanyName(profile.company.name || "Empresa");
      syncEditor(profile);
      setMessage("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir el cliente.");
    } finally {
      setLoadingProfile(false);
    }
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          phone: selected.client.customerPhone,
          displayName: editName,
          tags: editTags,
          notes: editNotes,
        }),
      });
      const data = (await readJson(response)) as SaveResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo guardar el contacto.");
      }
      await loadClients(search);
      await openClient(selected.client.customerPhone);
      setMessage("Contacto actualizado.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar el contacto.");
    } finally {
      setSaving(false);
    }
  }

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          phone: newPhone,
          displayName: newName,
          tags: newTags,
          notes: newNotes,
        }),
      });
      const data = (await readJson(response)) as SaveResponse;
      if (!response.ok || !data.ok || !data.session) {
        throw new Error(data.error || "No se pudo crear el contacto.");
      }
      setShowCreate(false);
      setNewName("");
      setNewPhone("");
      setNewTags("");
      setNewNotes("");
      await loadClients("");
      await openClient(data.session.customerPhone);
      setMessage("Contacto creado. Ya puedes abrir su conversación.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo crear el contacto.");
    } finally {
      setSaving(false);
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
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CRM</p>
            <h1>Clientes y contactos</h1>
            <p className={styles.subheading}>
              Organiza clientes, historial, etiquetas y notas de cada conversación.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => setShowCreate((current) => !current)}
            >
              {showCreate ? "Cancelar" : "+ Nuevo contacto"}
            </button>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void loadClients(search)}
              disabled={loadingList}
            >
              {loadingList ? "Actualizando…" : "↻ Actualizar"}
            </button>
          </div>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}
        {message ? <div className={styles.success}>{message}</div> : null}

        {showCreate ? (
          <form className={styles.createCard} onSubmit={createContact}>
            <div>
              <p className={styles.eyebrow}>NUEVO CONTACTO</p>
              <h2>Crear contacto manual</h2>
              <p>Se creará su ficha y una conversación lista para abrir. El primer mensaje saliente requiere una plantilla aprobada si esa persona no te ha escrito en las últimas 24 horas.</p>
            </div>
            <label>
              <span>Nombre</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ej. Laura Gómez" />
            </label>
            <label>
              <span>WhatsApp con indicativo</span>
              <input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="Ej. 573001234567" required />
            </label>
            <label>
              <span>Etiquetas</span>
              <input value={newTags} onChange={(event) => setNewTags(event.target.value)} placeholder="Ej. mayorista, cliente frecuente" />
            </label>
            <label className={styles.fullField}>
              <span>Notas</span>
              <textarea value={newNotes} onChange={(event) => setNewNotes(event.target.value)} placeholder="Información útil para el equipo." rows={3} />
            </label>
            <button className={styles.saveButton} type="submit" disabled={saving}>
              {saving ? "Creando…" : "Crear contacto"}
            </button>
          </form>
        ) : null}

        <div className={styles.layout}>
          <section className={styles.listPanel}>
            <form className={styles.searchForm} onSubmit={searchClients}>
              <label htmlFor="client-search">Buscar por nombre o teléfono</label>
              <div className={styles.searchRow}>
                <input
                  id="client-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ej. Laura o 3001234567"
                />
                <button type="submit">Buscar</button>
              </div>
            </form>

            <div className={styles.listHeader}>
              <div>
                <h2>Base de contactos</h2>
                <p>{loadingList ? "Cargando…" : `${clients.length} contactos encontrados`}</p>
              </div>
            </div>

            <div className={styles.clientList}>
              {!loadingList && !clients.length ? <div className={styles.empty}>No encontramos contactos con esa búsqueda.</div> : null}
              {clients.map((client) => (
                <button
                  className={`${styles.clientRow} ${selected?.client.customerPhone === client.customerPhone ? styles.selectedRow : ""}`}
                  key={client.customerPhone}
                  type="button"
                  onClick={() => void openClient(client.customerPhone)}
                >
                  <span className={styles.avatar}>{initials(customerLabel(client))}</span>
                  <span className={styles.clientSummary}>
                    <span className={styles.clientTopLine}>
                      <strong>{customerLabel(client)}</strong>
                      <time>{formatDate(client.lastMessageAt)}</time>
                    </span>
                    <span className={styles.phone}>{client.customerPhone}</span>
                    <span className={styles.preview}>{client.lastMessage?.message || "Sin mensajes todavía"}</span>
                    <span className={`${styles.status} ${styles[`status_${client.attentionStatus}`]}`}>
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
                <h2>Selecciona un contacto</h2>
                <p>Aquí podrás editar su información, ver el historial y abrir la conversación.</p>
              </div>
            ) : (
              <>
                <header className={styles.profileHeader}>
                  <div>
                    <p className={styles.eyebrow}>Perfil de contacto</p>
                    <h2>{customerLabel(selected.client)}</h2>
                    <p>{channelLabel[selected.client.contact?.primaryChannel ?? "whatsapp"]} · {selected.client.customerPhone}</p>
                  </div>
                  <button className={styles.inboxButton} type="button" onClick={() => window.location.assign(`/?session=${encodeURIComponent(selected.session.id)}`)}>
                    Abrir conversación
                  </button>
                </header>

                <div className={styles.profileData}>
                  <article><span>Canal</span><strong>{channelLabel[selected.client.contact?.primaryChannel ?? "whatsapp"]}</strong></article>
                  <article><span>Estado</span><strong>{statusLabel[selected.client.attentionStatus]}</strong></article>
                  <article><span>Mensajes</span><strong>{totalMessages}</strong></article>
                  <article><span>Primera interacción</span><strong>{formatDate(selected.client.firstMessageAt)}</strong></article>
                  <article><span>Última actividad</span><strong>{formatDate(selected.client.lastMessageAt)}</strong></article>
                  <article><span>Asignado a</span><strong>{selected.client.assignedToName || "Sin asignar"}</strong></article>
                </div>

                <form className={styles.contactForm} onSubmit={saveContact}>
                  <div className={styles.contactFormHeader}>
                    <div>
                      <p className={styles.eyebrow}>Datos internos</p>
                      <h3>Información del contacto</h3>
                    </div>
                    <button className={styles.saveButton} type="submit" disabled={saving}>
                      {saving ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                  <div className={styles.formGrid}>
                    <label>
                      <span>Nombre</span>
                      <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Nombre del cliente" />
                    </label>
                    <label>
                      <span>Etiquetas</span>
                      <input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="Ej. mayorista, seguimiento" />
                    </label>
                    <label className={styles.fullField}>
                      <span>Notas del equipo</span>
                      <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="Escribe datos útiles para la atención." rows={3} />
                    </label>
                  </div>
                  <p className={styles.helper}>Separa las etiquetas con comas. Estas notas no las ve el cliente.</p>
                </form>

                <section className={styles.history}>
                  <div className={styles.historyHeader}>
                    <div>
                      <p className={styles.eyebrow}>Historial</p>
                      <h3>Mensajes de la conversación</h3>
                    </div>
                    {loadingProfile ? <span>Cargando…</span> : null}
                  </div>

                  <div className={styles.messageFeed}>
                    {!loadingProfile && !selected.messages.length ? <p className={styles.empty}>No hay mensajes todavía.</p> : null}
                    {selected.messages.map((item) => (
                      <article className={`${styles.message} ${styles[`message_${item.authorType}`]}`} key={item.id ?? `${item.sessionId}-${item.createdAt}-${item.message}`}>
                        <span>{item.authorType === "customer" ? "Cliente" : item.authorType === "advisor" ? "Asesor" : "IA"}</span>
                        <p>{item.message}</p>
                        <time>{formatDate(item.createdAt)}</time>
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
