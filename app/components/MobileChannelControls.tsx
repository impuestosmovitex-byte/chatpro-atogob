"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ChannelValue = "all" | "whatsapp" | "instagram" | "messenger";

function channelFromButton(button: HTMLButtonElement): ChannelValue | null {
  if (button.classList.contains("mw1-all-tab")) return "all";

  const text = (button.textContent ?? "").toLowerCase();
  if (text.includes("whatsapp")) return "whatsapp";
  if (text.includes("instagram")) return "instagram";
  if (text.includes("messenger")) return "messenger";
  return null;
}

function findChannelButton(value: ChannelValue) {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".channel-tabs button.channel-tab"),
  );

  if (value === "all") {
    return buttons.find((button) => button.classList.contains("mw1-all-tab")) ?? null;
  }

  return (
    buttons.find((button) => channelFromButton(button) === value) ?? null
  );
}

function currentChannelValue(): ChannelValue {
  const allButton = document.querySelector<HTMLButtonElement>(
    ".channel-tabs button.mw1-all-tab",
  );

  if (allButton?.classList.contains("active")) return "all";

  const active = document.querySelector<HTMLButtonElement>(
    ".channel-tabs button.channel-tab.active:not(.mw1-all-tab)",
  );

  return active ? channelFromButton(active) ?? "all" : "all";
}

export function MobileChannelControls() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState<ChannelValue>("all");

  useEffect(() => {
    const sync = () => {
      const heading = document.querySelector<HTMLElement>(".list-panel-heading");
      setTarget((current) => (current === heading ? current : heading));
      const nextValue = currentChannelValue();
      setValue((current) => (current === nextValue ? current : nextValue));
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const button = element?.closest<HTMLButtonElement>(".channel-tabs button.channel-tab");
      if (!button) return;

      const next = channelFromButton(button);
      if (next) setValue(next);
    };

    document.addEventListener("click", onClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  function changeChannel(next: ChannelValue) {
    setValue(next);
    const button = findChannelButton(next);
    if (button) button.click();
  }

  const selector = target
    ? createPortal(
        <label className="mw1-mobile-channel-control">
          <span>Canal</span>
          <select
            value={value}
            onChange={(event) => changeChannel(event.target.value as ChannelValue)}
            aria-label="Filtrar conversaciones por canal"
          >
            <option value="all">Todos los canales</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
          </select>
        </label>,
        target,
      )
    : null;

  return (
    <>
      <style>{`
        @media (max-width: 760px) {
          /* El selector original queda fuera de la zona útil en iPhone. Ocultamos
             esa franja y mostramos el mismo control dentro del encabezado Chats. */
          .channel-tabs {
            display: none !important;
          }

          .list-panel-heading {
            flex-wrap: wrap !important;
            align-items: center !important;
            row-gap: 0 !important;
          }

          .mw1-mobile-channel-control {
            order: 3;
            flex: 0 0 100%;
            width: 100%;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            align-items: center;
            gap: 10px;
            margin-top: 14px;
          }

          .mw1-mobile-channel-control > span {
            color: #728097;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: .06em;
          }

          .mw1-mobile-channel-control select {
            width: 100%;
            height: 42px;
            min-width: 0;
            border: 1px solid #d5dce6;
            border-radius: 12px;
            padding: 0 38px 0 12px;
            color: #172235;
            background: #fff;
            font-size: 14px;
            font-weight: 850;
            outline: none;
          }

          /* La insignia ya existente se hace realmente visible. */
          html[data-mw1-unified-channels="all"] .mw1-channel-source-badge {
            right: -8px !important;
            bottom: -6px !important;
            min-width: 29px !important;
            height: 24px !important;
            padding: 0 6px !important;
            border-width: 2px !important;
            font-size: 10px !important;
            font-weight: 950 !important;
            box-shadow: 0 2px 7px rgba(23, 34, 53, .24) !important;
          }

          /* Además del distintivo sobre la foto, mostramos el nombre del canal
             dentro de la fila. Así no depende de reconocer un icono diminuto. */
          html[data-mw1-unified-channels="all"] .conversation-row:has(.mw1-channel-whatsapp) .conversation-summary::after,
          html[data-mw1-unified-channels="all"] .conversation-row:has(.mw1-channel-instagram) .conversation-summary::after,
          html[data-mw1-unified-channels="all"] .conversation-row:has(.mw1-channel-messenger) .conversation-summary::after {
            display: inline-flex;
            align-items: center;
            min-height: 20px;
            margin-top: 6px;
            padding: 2px 7px;
            border-radius: 999px;
            color: #fff;
            font-size: 9px;
            font-weight: 900;
            line-height: 1;
            letter-spacing: .01em;
          }

          html[data-mw1-unified-channels="all"] .conversation-row:has(.mw1-channel-whatsapp) .conversation-summary::after {
            content: "WhatsApp";
            background: #20ad63;
          }

          html[data-mw1-unified-channels="all"] .conversation-row:has(.mw1-channel-instagram) .conversation-summary::after {
            content: "Instagram";
            background: #c13584;
          }

          html[data-mw1-unified-channels="all"] .conversation-row:has(.mw1-channel-messenger) .conversation-summary::after {
            content: "Messenger";
            background: #168aff;
          }
        }
      `}</style>
      {selector}
    </>
  );
}
