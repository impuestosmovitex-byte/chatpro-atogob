"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../components/AppSidebar";
import styles from "./page.module.css";

type JsonObject = Record<string, unknown>;

type Template = {
  id: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  qualityScore: JsonObject;
  syncedAt: string | null;
};

type Binding = {
  id?: string;
  eventKey: string;
  templateId: string | null;
  enabled: boolean;
  variableMapping: Record<string, string>;
  buttonActions: Record<string, string>;
  config: Record<string, string>;
  updatedAt?: string | null;
};

type EventDefinition = {
  key: string;
  label: string;
  description: string;
  variables: string[];
};

type ActionDefinition = {
  key: string;
  label: string;
};

type Dashboard = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  templates?: Template[];
  bindings?: Binding[];
  eventDefinitions?: EventDefinition[];
  buttonActionDefinitions?: ActionDefinition[];
};

function componentRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function templateVariables(template?: Template): string[] {
  if (!template) return [];

  const variables = new Set<string>();

  for (const rawComponent of template.components) {
    const component = componentRecord(rawComponent);
    const text = typeof component.text === "string" ? component.text : "";

    for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const key = match[1]?.trim();

      if (key) variables.add(key);
    }

    const buttons = Array.isArray(component.buttons)
      ? component.buttons
      : [];

    for (const rawButton of buttons) {
      const button = componentRecord(rawButton);
      const url = typeof button.url === "string" ? button.url : "";

      for (const match of url.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        const key = match[1]?.trim();

        if (key) variables.add(`button.${key}`);
      }
    }
  }

  return Array.from(variables);
}

function templateQuickReplyButtons(template?: Template): string[] {
  if (!template) return [];

  const result: string[] = [];

  for (const rawComponent of template.components) {
    const component = componentRecord(rawComponent);
    const buttons = Array.isArray(component.buttons)
      ? component.buttons
      : [];

    for (const rawButton of buttons) {
      const button = componentRecord(rawButton);
      const type =
        typeof button.type === "string" ? button.type.toUpperCase() : "";
      const text = typeof button.text === "string" ? button.text.trim() : "";

      if (type === "QUICK_REPLY" && text) {
        result.push(text);
      }
    }
  }

  return result;
}

function formatDate(value: string | null) {
  if (!value) return "Sin sincronizar";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Sin sincronizar";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status: string) {
  if (status === "APPROVED") return "Aprobada";
  if (status === "PENDING") return "Pendiente";
  if (status === "REJECTED") return "Rechazada";
  if (status === "PAUSED") return "Pausada";
  if (status === "DISABLED") return "Deshabilitada";
  return status || "Sin estado";
}

export default function WhatsappTemplatesPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [bindings, setBindings] = useState<Record<string, Binding>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");

    try {
      const response = await fetch("/api/whatsapp-templates", {
        cache: "no-store",
      });
      const result = (await response.json()) as Dashboard;

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || "No se pudieron cargar las plantillas.",
        );
      }

      const nextBindings: Record<string, Binding> = {};

      for (const definition of result.eventDefinitions ?? []) {
        const current = (result.bindings ?? []).find(
          (item) => item.eventKey === definition.key,
        );

        nextBindings[definition.key] = current ?? {
          eventKey: definition.key,
          templateId: null,
          enabled: false,
          variableMapping: {},
          buttonActions: {},
          config: {},
        };
      }

      setData(result);
      setBindings(nextBindings);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudieron cargar las plantillas.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const approvedTemplates = useMemo(
    () =>
      (data?.templates ?? []).filter(
        (template) => template.status === "APPROVED",
      ),
    [data],
  );

  async function syncTemplates() {
    setSyncing(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/whatsapp-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: { synced?: number; approved?: number };
      };

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || "No se pudieron sincronizar las plantillas.",
        );
      }

      setMessage(
        `Meta sincronizó ${result.result?.synced ?? 0} plantillas; ${
          result.result?.approved ?? 0
        } están aprobadas.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudieron sincronizar las plantillas.",
      );
    } finally {
      setSyncing(false);
    }
  }

  function updateBinding(
    eventKey: string,
    update: Partial<Binding>,
  ) {
    setBindings((current) => ({
      ...current,
      [eventKey]: {
        ...current[eventKey],
        ...update,
      },
    }));
  }

  function chooseTemplate(eventKey: string, templateId: string) {
    const template = approvedTemplates.find(
      (item) => item.id === templateId,
    );
    const current = bindings[eventKey];
    const variables = templateVariables(template);
    const buttons = templateQuickReplyButtons(template);
    const nextMapping: Record<string, string> = {};
    const nextActions: Record<string, string> = {};

    for (const variable of variables) {
      nextMapping[variable] =
        current?.variableMapping?.[variable] ?? "";
    }

    for (const button of buttons) {
      nextActions[button] =
        current?.buttonActions?.[button] ?? "none";
    }

    updateBinding(eventKey, {
      templateId: templateId || null,
      enabled: Boolean(templateId) && current?.enabled === true,
      variableMapping: nextMapping,
      buttonActions: nextActions,
    });
  }

  async function saveBinding(definition: EventDefinition) {
    const binding = bindings[definition.key];

    if (!binding) return;

    setSaving(definition.key);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/whatsapp-templates", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventKey: definition.key,
          templateId: binding.templateId,
          enabled: binding.enabled,
          variableMapping: binding.variableMapping,
          buttonActions: binding.buttonActions,
          config: binding.config,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        binding?: Binding;
      };

      if (!response.ok || !result.ok || !result.binding) {
        throw new Error(
          result.error || "No se pudo guardar la asignación.",
        );
      }

      updateBinding(definition.key, result.binding);
      setMessage(`Asignación guardada: ${definition.label}.`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo guardar la asignación.",
      );
    } finally {
      setSaving("");
    }
  }

  const templates = data?.templates ?? [];
  const approved = templates.filter(
    (template) => template.status === "APPROVED",
  ).length;
  const pending = templates.filter(
    (template) => template.status === "PENDING",
  ).length;
  const activeBindings = Object.values(bindings).filter(
    (binding) => binding.enabled,
  ).length;

  return (
    <main className="chatpro-shell">
      <AppSidebar companyName={data?.company?.name ?? "Empresa"} />

      <section className={`workspace ${styles.workspace}`}>
        <header className={styles.header}>
          <div>
            <p className="eyebrow">WHATSAPP MULTIEMPRESA</p>
            <h1>Plantillas de Meta</h1>
            <p>
              Sincroniza las plantillas de la empresa activa y asígnalas a
              eventos generales de ChatPro.
            </p>
          </div>

          <button
            className={styles.syncButton}
            type="button"
            onClick={() => void syncTemplates()}
            disabled={syncing}
          >
            {syncing ? "Sincronizando…" : "Sincronizar con Meta"}
          </button>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}
        {message ? <div className={styles.success}>{message}</div> : null}

        <section className={styles.metrics}>
          <article>
            <span>Sincronizadas</span>
            <strong>{templates.length}</strong>
          </article>
          <article>
            <span>Aprobadas</span>
            <strong>{approved}</strong>
          </article>
          <article>
            <span>Pendientes</span>
            <strong>{pending}</strong>
          </article>
          <article>
            <span>Asignaciones activas</span>
            <strong>{activeBindings}</strong>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div>
              <p className="eyebrow">CATÁLOGO</p>
              <h2>Plantillas de la empresa</h2>
            </div>
            <small>
              Última sincronización:{" "}
              {formatDate(
                templates
                  .map((template) => template.syncedAt)
                  .filter((value): value is string => Boolean(value))
                  .sort()
                  .at(-1) ?? null,
              )}
            </small>
          </div>

          {loading ? (
            <div className={styles.empty}>Cargando plantillas…</div>
          ) : templates.length ? (
            <div className={styles.templateTable}>
              <div className={styles.tableHeader}>
                <span>Plantilla</span>
                <span>Categoría</span>
                <span>Idioma</span>
                <span>Estado</span>
              </div>
              {templates.map((template) => (
                <div className={styles.tableRow} key={template.id}>
                  <strong>{template.name}</strong>
                  <span>{template.category || "Sin categoría"}</span>
                  <span>{template.language}</span>
                  <span
                    className={`${styles.status} ${
                      template.status === "APPROVED"
                        ? styles.approved
                        : template.status === "REJECTED"
                          ? styles.rejected
                          : styles.pending
                    }`}
                  >
                    {statusLabel(template.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              Pulsa “Sincronizar con Meta” para traer las plantillas
              pertenecientes a esta empresa.
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div>
              <p className="eyebrow">ASIGNACIÓN</p>
              <h2>Eventos de ChatPro</h2>
            </div>
            <small>
              El código solo conoce eventos; cada empresa elige sus plantillas.
            </small>
          </div>

          <div className={styles.bindingList}>
            {(data?.eventDefinitions ?? []).map((definition) => {
              const binding = bindings[definition.key];
              const selectedTemplate = approvedTemplates.find(
                (template) => template.id === binding?.templateId,
              );
              const variables = templateVariables(selectedTemplate);
              const buttons =
                templateQuickReplyButtons(selectedTemplate);

              return (
                <article className={styles.bindingCard} key={definition.key}>
                  <header>
                    <div>
                      <h3>{definition.label}</h3>
                      <p>{definition.description}</p>
                    </div>
                    <label className={styles.switchLabel}>
                      <input
                        type="checkbox"
                        checked={binding?.enabled ?? false}
                        disabled={!binding?.templateId}
                        onChange={(event) =>
                          updateBinding(definition.key, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      Activa
                    </label>
                  </header>

                  <label className={styles.field}>
                    <span>Plantilla aprobada</span>
                    <select
                      value={binding?.templateId ?? ""}
                      onChange={(event) =>
                        chooseTemplate(
                          definition.key,
                          event.target.value,
                        )
                      }
                    >
                      <option value="">Sin asignar</option>
                      {approvedTemplates.map((template) => (
                        <option value={template.id} key={template.id}>
                          {template.name} · {template.language}
                        </option>
                      ))}
                    </select>
                  </label>

                  {variables.length ? (
                    <div className={styles.mappingSection}>
                      <h4>Variables</h4>
                      {variables.map((variable) => (
                        <label className={styles.mappingRow} key={variable}>
                          <code>{`{{${variable}}}`}</code>
                          <select
                            value={
                              binding?.variableMapping?.[variable] ?? ""
                            }
                            onChange={(event) =>
                              updateBinding(definition.key, {
                                variableMapping: {
                                  ...binding.variableMapping,
                                  [variable]: event.target.value,
                                },
                              })
                            }
                          >
                            <option value="">Seleccionar dato</option>
                            {definition.variables.map((option) => (
                              <option value={option} key={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {buttons.length ? (
                    <div className={styles.mappingSection}>
                      <h4>Acciones de botones</h4>
                      {buttons.map((button) => (
                        <label className={styles.mappingRow} key={button}>
                          <strong>{button}</strong>
                          <select
                            value={
                              binding?.buttonActions?.[button] ?? "none"
                            }
                            onChange={(event) =>
                              updateBinding(definition.key, {
                                buttonActions: {
                                  ...binding.buttonActions,
                                  [button]: event.target.value,
                                },
                              })
                            }
                          >
                            {(data?.buttonActionDefinitions ?? []).map(
                              (action) => (
                                <option value={action.key} key={action.key}>
                                  {action.label}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  <button
                    className={styles.saveButton}
                    type="button"
                    onClick={() => void saveBinding(definition)}
                    disabled={saving === definition.key}
                  >
                    {saving === definition.key
                      ? "Guardando…"
                      : "Guardar asignación"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <p className={styles.note}>
          Este bloque guarda la configuración multiempresa. El siguiente
          bloque conectará estas asignaciones con el envío automático, la
          Bandeja y las respuestas de los botones.
        </p>
      </section>
    </main>
  );
}
