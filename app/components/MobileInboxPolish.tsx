"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ChannelValue = "all" | "whatsapp" | "instagram" | "messenger";

type Option = {
  value: ChannelValue;
  label: string;
};

const CHANNEL_LABELS: Record<Exclude<ChannelValue, "all">, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

function currentNativeSelect() {
  return document.querySelector<HTMLSelectElement>(
    ".mw1-mobile-channel-select select",
  );
}

function currentHeading() {
  return document.querySelector<HTMLElement>(".list-panel-heading");
}

function channelFromBadge(badge: Element | null) {
  if (!badge) return null;
  if (badge.classList.contains("mw1-channel-whatsapp")) return "whatsapp";
  if (badge.classList.contains("mw1-channel-instagram")) return "instagram";
  if (badge.classList.contains("mw1-channel-messenger")) return "messenger";
  return null;
}

function syncChannelPills() {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>(".conversation-row"),
  );

  for (const row of rows) {
    row.querySelectorAll(".mw1-channel-readable-pill").forEach((node) => node.remove());

    const badge = row.querySelector(".mw1-channel-source-badge");
    const channel = channelFromBadge(badge);
    if (!channel) continue;

    const summary = row.querySelector<HTMLElement>(".conversation-summary");
    const preview = row.querySelector<HTMLElement>(".conversation-preview");
    if (!summary || !preview) continue;

    const pill = document.createElement("span");
    pill.className = `mw1-channel-readable-pill mw1-readable-${channel}`;
    pill.textContent = CHANNEL_LABELS[channel];
    pill.setAttribute("aria-label", `Canal ${CHANNEL_LABELS[channel]}`);
    pill.title = `Canal: ${CHANNEL_LABELS[channel]}`;
    preview.insertAdjacentElement("afterend", pill);
  }
}

export function MobileInboxPolish() {
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  const [nativeSelect, setNativeSelect] = useState<HTMLSelectElement | null>(null);
  const [value, setValue] = useState<ChannelValue>("all");
  const [options, setOptions] = useState<Option[]>([
    { value: "all", label: "Todos los canales" },
  ]);

  useEffect(() => {
    const sync = () => {
      const nextHeading = currentHeading();
      const nextSelect = currentNativeSelect();
      setHeading((current) => (current === nextHeading ? current : nextHeading));
      setNativeSelect((current) => (current === nextSelect ? current : nextSelect));

      if (nextSelect) {
        const nextOptions = Array.from(nextSelect.options)
          .map((option) => ({
            value: option.value as ChannelValue,
            label: option.textContent?.replace(/^[^A-Za-zÁÉÍÓÚÑ]+/, "").trim() || option.value,
          }))
          .filter((option) =>
            ["all", "whatsapp", "instagram", "messenger"].includes(option.value),
          );

        if (nextOptions.length) setOptions(nextOptions);
        if (["all", "whatsapp", "instagram", "messenger"].includes(nextSelect.value)) {
          setValue(nextSelect.value as ChannelValue);
        }
      }

      syncChannelPills();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    const onChange = (event: Event) => {
      if (event.target === currentNativeSelect()) sync();
    };

    document.addEventListener("change", onChange, true);
    window.addEventListener("resize", sync);

    return () => {
      observer.disconnect();
      document.removeEventListener("change", onChange, true);
      window.removeEventListener("resize", sync);
    };
  }, []);

  const dock = useMemo(() => {
    if (!heading || !nativeSelect) return null;

    return createPortal(
      <label className="mw1-mobile-channel-dock">
        <span className="mw1-mobile-channel-dock-label">Canal</span>
        <select
          value={value}
          onChange={(event) => {
            const next = event.target.value as ChannelValue;
            setValue(next);

            const select = currentNativeSelect();
            if (!select) return;

            const setter = Object.getOwnPropertyDescriptor(
              HTMLSelectElement.prototype,
              "value",
            )?.set;

            if (setter) setter.call(select, next);
            else select.value = next;

            select.dispatchEvent(new Event("change", { bubbles: true }));
          }}
          aria-label="Filtrar conversaciones por canal"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === "all"
                ? "Todos los canales"
                : option.value === "whatsapp"
                  ? "WhatsApp"
                  : option.value === "instagram"
                    ? "Instagram"
                    : "Messenger"}
            </option>
          ))}
        </select>
      </label>,
      heading,
    );
  }, [heading, nativeSelect, options, value]);

  return (
    <>
      <style>{`
        .mw1-channel-readable-pill {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          margin: -2px 0 7px;
          padding: 3px 8px;
          border-radius: 999px;
          color: #fff;
          font-size: 9px;
          font-weight: 900;
          line-height: 1.15;
          letter-spacing: .01em;
          box-shadow: 0 1px 2px rgba(23, 34, 53, .08);
        }

        .mw1-readable-whatsapp { background: #1fa855; }
        .mw1-readable-instagram {
          background: linear-gradient(120deg, #833ab4, #c13584, #e1306c, #f77737);
        }
        .mw1-readable-messenger { background: #168aff; }

        @media (min-width: 761px) {
          .mw1-mobile-channel-dock { display: none !important; }
          .mw1-channel-readable-pill { display: none !important; }
        }

        @media (max-width: 760px) {
          /* El selector anterior quedaba en la parte superior de la pantalla. */
          .channel-tabs {
            display: none !important;
            height: 0 !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            overflow: hidden !important;
          }

          .list-panel-heading {
            position: relative !important;
            padding-bottom: 76px !important;
          }

          .mw1-mobile-channel-dock {
            position: absolute;
            left: 18px;
            right: 18px;
            bottom: 10px;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            align-items: center;
            gap: 9px;
            min-width: 0;
          }

          .mw1-mobile-channel-dock-label {
            color: #7c8798;
            font-size: 10px;
            font-weight: 900;
            letter-spacing: .08em;
            text-transform: uppercase;
          }

          .mw1-mobile-channel-dock select {
            width: 100%;
            min-width: 0;
            height: 44px;
            border: 1px solid #d9e0e9;
            border-radius: 12px;
            padding: 0 40px 0 13px;
            color: #243047;
            background: #fff;
            font-size: 14px;
            font-weight: 850;
            outline: none;
            box-shadow: 0 1px 2px rgba(23, 34, 53, .03);
          }

          .mw1-channel-source-badge {
            right: -7px !important;
            bottom: -5px !important;
            min-width: 30px !important;
            height: 21px !important;
            padding: 0 6px !important;
            border-width: 2px !important;
            font-size: 9px !important;
            font-weight: 950 !important;
          }

          .mw1-channel-readable-pill {
            margin-top: -1px;
            margin-bottom: 6px;
            padding: 4px 9px;
            font-size: 10px;
          }

          .conversation-preview {
            margin-bottom: 4px !important;
          }
        }
      `}</style>
      {dock}
    </>
  );
}
