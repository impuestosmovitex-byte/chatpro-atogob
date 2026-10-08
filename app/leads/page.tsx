'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type Contact = {
  id: string;
  companyId: string;
  phone: string;
  displayName: string | null;
  primaryChannel: 'whatsapp' | 'instagram' | 'messenger' | 'manual';
  tags: string[];
  notes: string;
  firstSeenAt: string | null;
  lastActivityAt: string | null;
};

type ClientSummary = {
  customerPhone: string;
  contact: Contact | null;
  lastMessageAt: string;
};

type ClientsResponse = {
  ok: boolean;
  error?: string;
  company?: { id: string; slug: string; name: string };
  clients?: ClientSummary[];
};

type StartConversationResponse = {
  ok: boolean;
  error?: string;
  session?: { id: string };
};

type Lead = {
  phone: string;
  name: string;
  email: string;
  objective: string;
  question1: string;
  training: string;
  question3: string;
  source: string;
  origin: string;
  event: string;
  status: string;
  consent: string;
  tags: string[];
  registeredAt: string | null;
};

function noteValue(notes: string, label: string): string {
  const line = notes
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`));

  if (!line) return '';
  return line.slice(line.indexOf(':') + 1).trim();
}

function isEffixLead(client: ClientSummary): boolean {
  const contact = client.contact;
  if (!contact) return false;

  const hasTag = (contact.tags ?? []).some(
    (tag) => tag.trim().toUpperCase() === 'EFFIX-2026',
  );

  return hasTag || contact.notes.toUpperCase().includes('LEAD EFFIX 2026');
}

function toLead(client: ClientSummary): Lead {
  const contact = client.contact;
  const notes = contact?.notes ?? '';

  return {
    phone: contact?.phone || client.customerPhone,
    name: contact?.displayName || 'Lead sin nombre',
    email: noteValue(notes, 'Correo'),
    objective: noteValue(notes, 'Objetivo'),
    question1: noteValue(notes, 'Pregunta 1'),
    training: noteValue(notes, 'Capacitación actual'),
    question3: noteValue(notes, 'Pregunta 3'),
    source: noteValue(notes, 'Fuente') || 'Feria',
    origin: noteValue(notes, 'Origen') || 'QR Stand',
    event: noteValue(notes, 'Evento') || 'EFFIX 2026',
    status: noteValue(notes, 'Estado lead') || 'Lead nuevo',
    consent: noteValue(notes, 'Consentimiento contacto'),
    tags: contact?.tags ?? [],
    registeredAt: contact?.firstSeenAt || client.lastMessageAt || null,
  };
}

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function LeadsPage() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [companyName, setCompanyName] = useState('Emprende con Maogo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [objective, setObjective] = useState('');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [startingPhone, setStartingPhone] = useState('');

  async function loadLeads() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/clients?limit=200', {
        cache: 'no-store',
      });
      const data = (await response.json()) as ClientsResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudieron cargar los leads.');
      }

      setClients(data.clients ?? []);
      setCompanyName(data.company?.name || 'Empresa');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudieron cargar los leads.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function startConversation(lead: Lead) {
    if (startingPhone) return;

    setStartingPhone(lead.phone);
    setError('');

    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start-conversation',
          phone: lead.phone,
        }),
      });
      const data = (await response.json()) as StartConversationResponse;

      if (!response.ok || !data.ok || !data.session?.id) {
        throw new Error(
          data.error || 'No se pudo iniciar la conversación con este lead.',
        );
      }

      window.location.assign(
        `/?session=${encodeURIComponent(data.session.id)}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudo iniciar la conversación con este lead.',
      );
    } finally {
      setStartingPhone('');
    }
  }

  useEffect(() => {
    void loadLeads();
  }, []);

  const leads = useMemo(
    () => clients.filter(isEffixLead).map(toLead),
    [clients],
  );

  const objectives = useMemo(() => {
    return Array.from(
      new Set(leads.map((lead) => lead.objective).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'es'));
  }, [leads]);

  const visibleLeads = useMemo(() => {
    const term = search.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesObjective = !objective || lead.objective === objective;
      const matchesSearch =
        !term ||
        [lead.name, lead.phone, lead.email, lead.objective, ...lead.tags]
          .join(' ')
          .toLowerCase()
          .includes(term);

      return matchesObjective && matchesSearch;
    });
  }, [leads, objective, search]);

  const wantsTraining = leads.filter((lead) =>
    lead.tags.includes('QUIERE-CAPACITARSE'),
  ).length;

  const entrepreneurs = leads.filter((lead) =>
    lead.tags.includes('QUIERE-EMPRENDER'),
  ).length;

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CRM DE SERVICIOS</p>
            <h1>Leads</h1>
            <p className={styles.subheading}>
              Registros capturados desde el QR de Feria EFFIX 2026.
            </p>
          </div>

          <button
            type="button"
            className={styles.refresh}
            onClick={() => void loadLeads()}
            disabled={loading}
          >
            {loading ? 'Actualizando…' : '↻ Actualizar'}
          </button>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.stats}>
          <article>
            <span>Total leads</span>
            <strong>{leads.length}</strong>
          </article>
          <article>
            <span>Quieren emprender</span>
            <strong>{entrepreneurs}</strong>
          </article>
          <article>
            <span>Quieren capacitarse</span>
            <strong>{wantsTraining}</strong>
          </article>
        </div>

        <div className={styles.filters}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, WhatsApp, correo o etiqueta"
            aria-label="Buscar leads"
          />

          <select
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            aria-label="Filtrar por objetivo"
          >
            <option value="">Todos los objetivos</option>
            {objectives.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.tableCard}>
          {loading ? (
            <div className={styles.empty}>Cargando leads…</div>
          ) : visibleLeads.length === 0 ? (
            <div className={styles.empty}>
              <strong>Aún no hay leads EFFIX.</strong>
              <span>
                Cuando alguien termine el formulario del QR aparecerá aquí automáticamente.
              </span>
            </div>
          ) : (
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>WhatsApp</th>
                    <th>Correo</th>
                    <th>Objetivo</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.map((lead) => (
                    <tr key={`${lead.phone}-${lead.registeredAt ?? ''}`}>
                      <td>
                        <strong>{lead.name}</strong>
                        <small>{lead.event}</small>
                      </td>
                      <td>{lead.phone}</td>
                      <td>{lead.email || '—'}</td>
                      <td>{lead.objective || '—'}</td>
                      <td>
                        <span className={styles.status}>{lead.status}</span>
                      </td>
                      <td>{formatDate(lead.registeredAt)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.detailButton}
                          onClick={() => setSelected(lead)}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selected ? (
          <div className={styles.overlay} onClick={() => setSelected(null)}>
            <aside
              className={styles.drawer}
              onClick={(event) => event.stopPropagation()}
              aria-label="Detalle del lead"
            >
              <div className={styles.drawerHeader}>
                <div>
                  <p className={styles.eyebrow}>DETALLE DEL LEAD</p>
                  <h2>{selected.name}</h2>
                </div>
                <button type="button" onClick={() => setSelected(null)}>
                  ×
                </button>
              </div>

              <div className={styles.leadActions}>
                <button
                  type="button"
                  className={styles.startConversationButton}
                  onClick={() => void startConversation(selected)}
                  disabled={Boolean(startingPhone)}
                >
                  {startingPhone === selected.phone
                    ? 'Abriendo conversación…'
                    : '💬 Iniciar conversación en MW1'}
                </button>
                <a
                  className={styles.callLink}
                  href={`tel:+${selected.phone.replace(/\D+/g, '')}`}
                >
                  📞 Llamar
                </a>
              </div>

              <p className={styles.actionNote}>
                Si el lead aún no te ha escrito por WhatsApp, el primer mensaje desde MW1 debe enviarse con una plantilla aprobada.
              </p>

              <div className={styles.detailGrid}>
                <div><span>WhatsApp</span><strong>{selected.phone}</strong></div>
                <div><span>Correo</span><strong>{selected.email || '—'}</strong></div>
                <div><span>Objetivo</span><strong>{selected.objective || '—'}</strong></div>
                <div><span>Capacitación actual</span><strong>{selected.training || '—'}</strong></div>
                <div><span>Pregunta 1</span><strong>{selected.question1 || '—'}</strong></div>
                <div><span>Pregunta 3</span><strong>{selected.question3 || '—'}</strong></div>
                <div><span>Fuente</span><strong>{selected.source}</strong></div>
                <div><span>Origen</span><strong>{selected.origin}</strong></div>
                <div><span>Evento</span><strong>{selected.event}</strong></div>
                <div><span>Estado</span><strong>{selected.status}</strong></div>
                <div><span>Consentimiento</span><strong>{selected.consent || 'Sí'}</strong></div>
                <div><span>Fecha de registro</span><strong>{formatDate(selected.registeredAt)}</strong></div>
              </div>

              <div className={styles.tagList}>
                {selected.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
