'use client';

import {
  FormEvent,
  useEffect,
  useState,
} from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from './page.module.css';

type Day = {
  dayOfWeek: number;
  label: string;
  isOpen: boolean;
  startTime: string;
  endTime: string;
};

type Configuration = {
  humanAttentionEnabled: boolean;
  autoReturnToAiHours: number;
  outsideHoursMessage: string;
  advisorsCanTakeAi: boolean;
  aiTakeAfterMinutes: number;
  hours: Day[];
};

export default function Page() {
  const [configuration, setConfiguration] =
    useState<Configuration | null>(null);
  const [companyName, setCompanyName] =
    useState('Empresa');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/support-settings', {
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) {
          throw new Error(data.error);
        }

        setConfiguration(data.configuration);
        setCompanyName(data.company?.name || 'Empresa');
      })
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar.',
        ),
      );
  }, []);

  function updateDay(
    dayOfWeek: number,
    changes: Partial<Day>,
  ) {
    setConfiguration((current) =>
      current
        ? {
            ...current,
            hours: current.hours.map((day) =>
              day.dayOfWeek === dayOfWeek
                ? { ...day, ...changes }
                : day,
            ),
          }
        : current,
    );
  }

  async function save(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!configuration) return;

    setSaving(true);
    setMessage('');

    try {
      const response = await fetch(
        '/api/support-settings',
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(configuration),
        },
      );
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || 'No se pudo guardar.',
        );
      }

      setMessage(data.message || 'Guardado.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Error',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header>
          <div>
            <p>CONFIGURACIÓN</p>
            <h1>
              Horarios y atención · {companyName}
            </h1>
            <span>
              La IA atiende 24/7. Aquí controlas la
              atención de asesores y cuándo pueden
              tomar chats inactivos.
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              location.assign('/configuracion')
            }
          >
            ← Volver
          </button>
        </header>

        {!configuration ? (
          <div>
            <p>Cargando…</p>
            {message ? (
              <p className={styles.msg}>{message}</p>
            ) : null}
          </div>
        ) : (
          <form onSubmit={save}>
            <article>
              <div className={styles.head}>
                <div>
                  <h2>Atención humana</h2>
                  <small>
                    Fuera de horario, los casos que
                    requieren persona quedarán pendientes.
                  </small>
                </div>

                <label>
                  <input
                    type="checkbox"
                    checked={
                      configuration.humanAttentionEnabled
                    }
                    onChange={(event) =>
                      setConfiguration({
                        ...configuration,
                        humanAttentionEnabled:
                          event.target.checked,
                      })
                    }
                  />{' '}
                  {configuration.humanAttentionEnabled
                    ? 'Activa'
                    : 'Pausada'}
                </label>
              </div>

              <label>
                Devolver automáticamente a IA después de
                <input
                  type="number"
                  min="1"
                  max="168"
                  value={
                    configuration.autoReturnToAiHours
                  }
                  onChange={(event) =>
                    setConfiguration({
                      ...configuration,
                      autoReturnToAiHours:
                        Number(event.target.value) || 1,
                    })
                  }
                />
                horas sin actividad del asesor
              </label>

              <label>
                Mensaje para cuando se requiere asesor
                fuera de horario
                <textarea
                  rows={4}
                  value={
                    configuration.outsideHoursMessage
                  }
                  onChange={(event) =>
                    setConfiguration({
                      ...configuration,
                      outsideHoursMessage:
                        event.target.value,
                    })
                  }
                  placeholder="Nuestro equipo te atenderá dentro del horario de atención."
                />
              </label>
            </article>

            <article>
              <div className={styles.head}>
                <div>
                  <h2>Chats inactivos de la IA</h2>
                  <small>
                    Permite seguimiento humano sin
                    interrumpir conversaciones activas.
                  </small>
                </div>

                <label>
                  <input
                    type="checkbox"
                    checked={
                      configuration.advisorsCanTakeAi
                    }
                    onChange={(event) =>
                      setConfiguration({
                        ...configuration,
                        advisorsCanTakeAi:
                          event.target.checked,
                      })
                    }
                  />{' '}
                  {configuration.advisorsCanTakeAi
                    ? 'Permitido'
                    : 'Bloqueado'}
                </label>
              </div>

              <label>
                Una conversación de IA queda disponible
                después de
                <input
                  type="number"
                  min="1"
                  max="10080"
                  value={
                    configuration.aiTakeAfterMinutes
                  }
                  disabled={
                    !configuration.advisorsCanTakeAi
                  }
                  onChange={(event) =>
                    setConfiguration({
                      ...configuration,
                      aiTakeAfterMinutes:
                        Number(event.target.value) || 1,
                    })
                  }
                />
                minutos sin actividad
              </label>

              <small>
                Propietarios y administradores pueden
                intervenir inmediatamente. Los asesores
                solo podrán tomar chats cuando cumplan
                este tiempo.
              </small>
            </article>

            <article>
              <h2>Horario general</h2>

              {configuration.hours.map((day) => (
                <div
                  className={styles.day}
                  key={day.dayOfWeek}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={day.isOpen}
                      onChange={(event) =>
                        updateDay(day.dayOfWeek, {
                          isOpen: event.target.checked,
                        })
                      }
                    />{' '}
                    <b>{day.label}</b>
                  </label>

                  {day.isOpen ? (
                    <span>
                      <input
                        type="time"
                        value={day.startTime}
                        onChange={(event) =>
                          updateDay(day.dayOfWeek, {
                            startTime:
                              event.target.value,
                          })
                        }
                      />{' '}
                      a{' '}
                      <input
                        type="time"
                        value={day.endTime}
                        onChange={(event) =>
                          updateDay(day.dayOfWeek, {
                            endTime:
                              event.target.value,
                          })
                        }
                      />
                    </span>
                  ) : (
                    <em>Cerrado</em>
                  )}
                </div>
              ))}
            </article>

            {message ? (
              <p className={styles.msg}>{message}</p>
            ) : null}

            <button
              className={styles.save}
              disabled={saving}
            >
              {saving
                ? 'Guardando…'
                : 'Guardar horarios y atención'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
