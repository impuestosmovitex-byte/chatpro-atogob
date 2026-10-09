'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

const LEAD_STATUSES = [
  'Lead nuevo',
  'Respondió',
  'Calificado',
  'Interesado',
  'Asesor/Cita',
  'Venta',
  'No interesado',
] as const;

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

type StatusResponse = {
  ok?: boolean;
  error?: string;
  status?: string;
};

type LeadSourceKind = 'effix' | 'meta_ads' | 'both';

type Lead = {
  contactId: string;
  phone: string;
  channel: Contact['primaryChannel'];
  name: string;
  email: string;
  ageRange: string;
  objective: string;
  question1: string;
  training: string;
  question3: string;
  source: string;
  sourceKind: LeadSourceKind;
  origin: string;
  event: string;
  status: string;
  consent: string;
  tags: string[];
  registeredAt: string | null;
  conversationSessionId: string;
  adId: string;
  adTitle: string;
  postId: string;
};

function noteValue(notes: string, label: string): string {
  const line = notes
    .split(/\r?\n/)
    .find((item) =>
      item.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`),
    );

  if (!line) return '';
  return line.slice(line.indexOf(':') + 1).trim();
}

function normalizedTags(contact: Contact | null): string[] {
  return (contact?.tags ?? []).map((tag) => tag.trim().toUpperCase());
}

function isTrackedLead(client: ClientSummary): boolean {
  const contact = client.contact;
  if (!contact) return false;

  const tags = normalizedTags(contact);
  const notes = contact.notes.toUpperCase();

  return (
    tags.includes('EFFIX-2026') ||
    tags.includes('META-ADS') ||
    notes.includes('LEAD EFFIX 2026') ||
    notes.includes('LEAD META ADS')
  );
}

function sourceKind(contact: Contact | null): LeadSourceKind {
  const tags = normalizedTags(contact);
  const notes = contact?.notes.toUpperCase() ?? '';
  const effix =
    tags.includes('EFFIX-2026') || notes.includes('LEAD EFFIX 2026');
  const meta =
    tags.includes('META-ADS') || notes.includes('LEAD META ADS');

  if (effix && meta) return 'both';
  return meta ? 'meta_ads' : 'effix';
}

function toLead(client: ClientSummary): Lead {
  const contact = client.contact;
  const notes = contact?.notes ?? '';
  const kind = sourceKind(contact);
  const channel = contact?.primaryChannel ?? 'whatsapp';
  const meta = kind === 'meta_ads' || kind === 'both';
  const effix = kind === 'effix' || kind === 'both';

  return {
    contactId: contact?.id ?? '',
    phone: contact?.phone || client.customerPhone,
    channel,
    name: contact?.displayName || 'Lead sin nombre',
    email: noteValue(notes, 'Correo'),
    ageRange: noteValue(notes, 'Rango de edad'),
    objective: noteValue(notes, 'Objetivo'),
    question1: noteValue(notes, 'Pregunta 1'),
    training: noteValue(notes, 'Capacitación actual'),
    question3: noteValue(notes, 'Pregunta 3'),
    source:
      kind === 'both'
        ? 'EFFIX + Meta Ads'
        : meta
          ? 'Meta Ads'
          : 'EFFIX 2026',
    sourceKind: kind,
    origin:
      noteValue(notes, 'Origen') ||
      (meta
        ? channel === 'instagram'
          ? 'Instagram Ads'
          : channel === 'messenger'
            ? 'Messenger Ads'
            : 'WhatsApp Ads'
        : 'QR Stand'),
    event: noteValue(notes, 'Evento') || (effix ? 'EFFIX 2026' : 'Meta Ads'),
    status:
      noteValue(notes, 'Estado lead') || (meta ? 'Respondió' : 'Lead nuevo'),
    consent: noteValue(notes, 'Consentimiento contacto'),
    tags: contact?.tags ?? [],
    registeredAt: contact?.firstSeenAt || client.lastMessageAt || null,
    conversationSessionId: noteValue(notes, 'Sesión social'),
    adId: noteValue(notes, 'ID anuncio'),
    adTitle: noteValue(notes, 'Título anuncio'),
    postId: noteValue(notes, 'ID publicación'),
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

function channelLabel(channel: Contact['primaryChannel']): string {
  if (channel === 'instagram') return 'Instagram';
  if (channel === 'messenger') return 'Messenger';
  if (channel === 'manual') return 'Contacto';
  return 'WhatsApp';
}

function displayContact(lead: Lead): string {
  if (lead.channel === 'whatsapp') return lead.phone;
  return channelLabel(lead.channel);
}

function matchesSource(lead: Lead, filter: string): boolean {
  if (!filter) return true;
  if (filter === 'effix') {
    return lead.sourceKind === 'effix' || lead.sourceKind === 'both';
  }
  if (filter === 'meta_ads') {
    return lead.sourceKind === 'meta_ads' || lead.sourceKind === 'both';
  }
  return true;
}

export default function LeadsPage() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [companyName, setCompanyName] = useState('Emprende con Maogo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [objective, setObjective] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [startingPhone, setStartingPhone] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  async function loadLeads() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/leads?limit=5000', {
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
      if (lead.conversationSessionId) {
        window.location.assign(
          `/?session=${encodeURIComponent(lead.conversationSessionId)}`,
        );
        return;
      }

      if (lead.channel !== 'whatsapp') {
        throw new Error(
          'La conversación social todavía no tiene una sesión disponible.',
        );
      }

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

  async function updateLeadStatus(lead: Lead, status: string) {
    if (savingStatus || status === lead.status) return;

    setSavingStatus(true);
    setError('');

    try {
      const response = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactId: lead.contactId,
          phone: lead.phone,
          status,
          source:
            lead.sourceKind === 'meta_ads' || lead.sourceKind === 'both'
              ? 'meta_ads'
              : 'effix',
        }),
      });
      const data = (await response.json()) as StatusResponse;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || 'No se pudo actualizar el estado del lead.',
        );
      }

      const nextLead = { ...lead, status };
      setSelected(nextLead);
      await loadLeads();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudo actualizar el estado del lead.',
      );
    } finally {
      setSavingStatus(false);
    }
  }

  useEffect(() => {
    void loadLeads();
  }, []);

  const leads = useMemo(
    () => clients.filter(isTrackedLead).map(toLead),
    [clients],
  );

  const objectives = useMemo(() => {
    return Array.from(
      new Set(leads.map((lead) => lead.objective).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'es'));
  }, [leads]);

  const ageRanges = useMemo(() => {
    return Array.from(
      new Set(leads.map((lead) => lead.ageRange).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'es'));
  }, [leads]);

  const visibleLeads = useMemo(() => {
    const term = search.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesLeadSource = matchesSource(lead, sourceFilter);
      const matchesObjective = !objective || lead.objective === objective;
      const matchesAgeRange = !ageRange || lead.ageRange === ageRange;
      const matchesStatus = !statusFilter || lead.status === statusFilter;
      const matchesSearch =
        !term ||
        [
          lead.name,
          lead.phone,
          lead.email,
          lead.ageRange,
          lead.objective,
          lead.status,
          lead.source,
          lead.origin,
          lead.adId,
          lead.adTitle,
          ...lead.tags,
        ]
          .join(' ')
          .toLowerCase()
          .includes(term);

      return (
        matchesLeadSource &&
        matchesObjective &&
        matchesAgeRange &&
        matchesStatus &&
        matchesSearch
      );
    });
  }, [leads, sourceFilter, objective, ageRange, statusFilter, search]);

  const effixLeads = leads.filter(
    (lead) => lead.sourceKind === 'effix' || lead.sourceKind === 'both',
  ).length;

  const metaAdsLeads = leads.filter(
    (lead) => lead.sourceKind === 'meta_ads' || lead.sourceKind === 'both',
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
              Leads de EFFIX y conversaciones originadas en campañas de Meta Ads.
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
            <span>EFFIX</span>
            <strong>{effixLeads}</strong>
          </article>
          <article>
            <span>Meta Ads</span>
            <strong>{metaAdsLeads}</strong>
          </article>
        </div>

        <div className={styles.filters}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, contacto, anuncio, objetivo, estado o etiqueta"
            aria-label="Buscar leads"
          />

          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            aria-label="Filtrar por origen"
          >
            <option value="">Todos los orígenes</option>
            <option value="effix">EFFIX 2026</option>
            <option value="meta_ads">Meta Ads</option>
          </select>

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

          <select
            value={ageRange}
            onChange={(event) => setAgeRange(event.target.value)}
            aria-label="Filtrar por rango de edad"
          >
            <option value="">Todas las edades</option>
            {ageRanges.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filtrar por estado del lead"
          >
            <option value="">Todos los estados</option>
            {LEAD_STATUSES.map((item) => (
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
              <strong>Aún no hay leads con estos filtros.</strong>
              <span>
                Los registros del QR y los clientes que escriban desde anuncios de Meta aparecerán aquí automáticamente.
              </span>
            </div>
          ) : (
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Origen</th>
                    <th>Canal</th>
                    <th>Contacto</th>
                    <th>Objetivo / anuncio</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.map((lead) => (
                    <tr key={`${lead.contactId || lead.phone}-${lead.registeredAt ?? ''}`}>
                      <td>
                        <strong>{lead.name}</strong>
                        <small>{lead.event}</small>
                      </td>
                      <td>{lead.source}</td>
                      <td>{channelLabel(lead.channel)}</td>
                      <td>{displayContact(lead)}</td>
                      <td>{lead.objective || lead.adTitle || lead.adId || '—'}</td>
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
                    : '💬 Abrir conversación en MW1'}
                </button>

                {selected.channel === 'whatsapp' &&
                /^\d{8,15}$/.test(selected.phone.replace(/\D+/g, '')) ? (
                  <a
                    className={styles.callLink}
                    href={`tel:+${selected.phone.replace(/\D+/g, '')}`}
                  >
                    📞 Llamar
                  </a>
                ) : null}
              </div>

              <p className={styles.actionNote}>
                {selected.sourceKind === 'meta_ads' ||
                selected.sourceKind === 'both'
                  ? 'Este lead llegó desde una campaña de Meta. Si ya existe conversación, MW1 abre el mismo chat de Instagram, Messenger o WhatsApp.'
                  : 'Si el lead aún no te ha escrito por WhatsApp, el primer mensaje desde MW1 debe enviarse con una plantilla aprobada.'}
              </p>

              <div className={styles.detailGrid}>
                <div>
                  <span>Estado del lead</span>
                  <select
                    value={selected.status}
                    disabled={savingStatus}
                    onChange={(event) =>
                      void updateLeadStatus(selected, event.target.value)
                    }
                  >
                    {LEAD_STATUSES.map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div><span>Fuente</span><strong>{selected.source}</strong></div>
                <div><span>Origen</span><strong>{selected.origin}</strong></div>
                <div><span>Canal</span><strong>{channelLabel(selected.channel)}</strong></div>
                {selected.channel === 'whatsapp' ? (
                  <div><span>WhatsApp</span><strong>{selected.phone}</strong></div>
                ) : null}
                <div><span>Correo</span><strong>{selected.email || '—'}</strong></div>
                <div><span>Rango de edad</span><strong>{selected.ageRange || '—'}</strong></div>
                <div><span>Objetivo</span><strong>{selected.objective || '—'}</strong></div>
                <div><span>Capacitación actual</span><strong>{selected.training || '—'}</strong></div>
                {selected.question1 ? (
                  <div><span>Pregunta 1</span><strong>{selected.question1}</strong></div>
                ) : null}
                {selected.question3 ? (
                  <div><span>Pregunta 3</span><strong>{selected.question3}</strong></div>
                ) : null}
                {selected.adId ? (
                  <div><span>ID anuncio Meta</span><strong>{selected.adId}</strong></div>
                ) : null}
                {selected.adTitle ? (
                  <div><span>Anuncio</span><strong>{selected.adTitle}</strong></div>
                ) : null}
                {selected.postId ? (
                  <div><span>ID publicación</span><strong>{selected.postId}</strong></div>
                ) : null}
                <div><span>Evento</span><strong>{selected.event}</strong></div>
                {selected.consent ? (
                  <div><span>Consentimiento</span><strong>{selected.consent}</strong></div>
                ) : null}
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
