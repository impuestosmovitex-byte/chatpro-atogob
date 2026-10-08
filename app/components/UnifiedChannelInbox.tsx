"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Channel = "whatsapp" | "instagram" | "messenger";

type ChannelOption = {
  channel: Channel;
  label: string;
};

const CHANNELS: Record<Channel, { label: string; icon: string; short: string }> = {
  whatsapp: { label: "WhatsApp", icon: "◉", short: "WA" },
  instagram: { label: "Instagram", icon: "◎", short: "IG" },
  messenger: { label: "Messenger", icon: "◍", short: "MS" },
};

const CHANNEL_MARKERS: Record<Channel, string> = {
  whatsapp: "\u2063\u200B\u2063",
  instagram: "\u2063\u200C\u2063",
  messenger: "\u2063\u200D\u2063",
};

function channelFromValue(value: unknown): Channel | null {
  if (value === "whatsapp" || value === "instagram" || value === "messenger") {
    return value;
  }

  return null;
}

function channelFromTab(button: HTMLButtonElement): Channel | null {
  const text = button.textContent?.toLowerCase() ?? "";

  if (text.includes("whatsapp")) return "whatsapp";
  if (text.includes("instagram")) return "instagram";
  if (text.includes("messenger")) return "messenger";

  return null;
}

function findRefreshButton() {
  return document.querySelector<HTMLButtonElement>(
    'button[aria-label="Actualizar conversaciones"]',
  );
}

function nativeChannelButtons(host?: HTMLElement | null) {
  const root = host ?? document.querySelector<HTMLElement>(".channel-tabs");
  if (!root) return [];

  return Array.from(
    root.querySelectorAll<HTMLButtonElement>("button.channel-tab"),
  ).filter((button) => !button.classList.contains("mw1-all-tab"));
}

function availableFromHost(host: HTMLElement | null): ChannelOption[] {
  const seen = new Set<Channel>();
  const result: ChannelOption[] = [];

  for (const button of nativeChannelButtons(host)) {
    const channel = channelFromTab(button);
    if (!channel || seen.has(channel)) continue;

    seen.add(channel);
    result.push({ channel, label: CHANNELS[channel].label });
  }

  return result;
}

function inferSessionChannel(session: any): Channel {
  const contextChannel = channelFromValue(session?.context?.channel);
  if (contextChannel) return contextChannel;

  const contactChannel = channelFromValue(session?.contact?.primaryChannel);
  if (contactChannel) return contactChannel;

  return "whatsapp";
}

function addMarker(message: unknown, channel: Channel) {
  const value = typeof message === "string" ? message : "";
  const marker = CHANNEL_MARKERS[channel];

  if (
    value.startsWith(CHANNEL_MARKERS.whatsapp) ||
    value.startsWith(CHANNEL_MARKERS.instagram) ||
    value.startsWith(CHANNEL_MARKERS.messenger)
  ) {
    return value;
  }

  return `${marker}${value}`;
}

function readMarker(value: string): Channel | null {
  if (value.startsWith(CHANNEL_MARKERS.whatsapp)) return "whatsapp";
  if (value.startsWith(CHANNEL_MARKERS.instagram)) return "instagram";
  if (value.startsWith(CHANNEL_MARKERS.messenger)) return "messenger";
  return null;
}

function buildPatchedResponse(response: Response, payload: unknown) {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function UnifiedChannelInbox() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [available, setAvailable] = useState<ChannelOption[]>([]);
  const [allMode, setAllMode] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel>("whatsapp");

  const allModeRef = useRef(false);
  const targetChannelRef = useRef<Channel>("whatsapp");
  const suppressNativeClickRef = useRef(false);
  const autoActivatedRef = useRef(false);
  const originalFetchRef = useRef<typeof window.fetch | null>(null);

  useEffect(() => {
    allModeRef.current = allMode;
    document.documentElement.dataset.mw1UnifiedChannels = allMode ? "all" : "single";
  }, [allMode]);

  useEffect(() => {
    const syncHost = () => {
      const nextHost = document.querySelector<HTMLElement>(".channel-tabs");
      setHost((current) => (current === nextHost ? current : nextHost));

      if (nextHost) {
        const nextAvailable = availableFromHost(nextHost);
        setAvailable(nextAvailable);

        const active = nativeChannelButtons(nextHost).find((button) =>
          button.classList.contains("active"),
        );
        const activeChannel = active ? channelFromTab(active) : null;

        if (activeChannel && !allModeRef.current) {
          setSelectedChannel(activeChannel);
          targetChannelRef.current = activeChannel;
        }
      }
    };

    syncHost();
    const observer = new MutationObserver(syncHost);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (originalFetchRef.current) return;

    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    window.fetch = (async (...args: Parameters<typeof window.fetch>) => {
      const response = await originalFetch(...args);

      if (!allModeRef.current || !response.ok) {
        return response;
      }

      try {
        const input = args[0];
        const init = args[1];
        const request = input instanceof Request ? input : null;
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : request?.url ?? "";
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
        const url = new URL(rawUrl, window.location.origin);

        if (
          method !== "GET" ||
          url.pathname !== "/api/inbox" ||
          url.searchParams.has("sessionId") ||
          url.searchParams.get("mode") === "transfer-targets"
        ) {
          return response;
        }

        const payload = (await response.clone().json().catch(() => null)) as any;

        if (!payload || !Array.isArray(payload.sessions)) {
          return response;
        }

        const targetChannel = targetChannelRef.current;

        payload.sessions = payload.sessions.map((session: any) => {
          const originalChannel = inferSessionChannel(session);
          const context = {
            ...(session?.context && typeof session.context === "object"
              ? session.context
              : {}),
            __mw1OriginalChannel: originalChannel,
            channel: targetChannel,
          };

          const lastMessage = session?.lastMessage
            ? {
                ...session.lastMessage,
                message: addMarker(session.lastMessage.message, originalChannel),
              }
            : session?.lastMessage;

          return {
            ...session,
            context,
            lastMessage,
          };
        });

        return buildPatchedResponse(response, payload);
      } catch {
        return response;
      }
    }) as typeof window.fetch;

    return () => {
      if (originalFetchRef.current) {
        window.fetch = originalFetchRef.current;
        originalFetchRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const decorateRows = () => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".conversation-row"),
      );

      for (const row of rows) {
        row.querySelectorAll(".mw1-channel-source-badge").forEach((node) => node.remove());

        if (!allModeRef.current) continue;

        const preview = row.querySelector<HTMLElement>(".conversation-preview");
        const avatar = row.querySelector<HTMLElement>(".avatar");
        if (!preview || !avatar) continue;

        const channel = readMarker(preview.textContent ?? "");
        if (!channel) continue;

        avatar.style.position = "relative";
        const badge = document.createElement("span");
        badge.className = `mw1-channel-source-badge mw1-channel-${channel}`;
        badge.textContent = CHANNELS[channel].short;
        badge.title = `Conversación de ${CHANNELS[channel].label}`;
        badge.setAttribute("aria-label", `Canal ${CHANNELS[channel].label}`);
        avatar.appendChild(badge);
      }
    };

    decorateRows();
    const observer = new MutationObserver(decorateRows);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onNativeChannelClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest<HTMLButtonElement>("button.channel-tab");
      if (!button || button.classList.contains("mw1-all-tab")) return;

      const channel = channelFromTab(button);
      if (!channel) return;

      if (suppressNativeClickRef.current) {
        suppressNativeClickRef.current = false;
        return;
      }

      if (allModeRef.current) {
        allModeRef.current = false;
        setAllMode(false);
        targetChannelRef.current = channel;
        setSelectedChannel(channel);
        window.setTimeout(() => findRefreshButton()?.click(), 80);
      } else {
        targetChannelRef.current = channel;
        setSelectedChannel(channel);
      }
    };

    document.addEventListener("click", onNativeChannelClick, true);
    return () => document.removeEventListener("click", onNativeChannelClick, true);
  }, []);

  function refreshList() {
    window.setTimeout(() => findRefreshButton()?.click(), 80);
  }

  function chooseNativeChannel(channel: Channel) {
    const button = nativeChannelButtons(host).find(
      (item) => channelFromTab(item) === channel,
    );

    if (!button) return false;

    suppressNativeClickRef.current = true;
    button.click();
    return true;
  }

  function enableAllChannels() {
    const currentActive = nativeChannelButtons(host).find((button) =>
      button.classList.contains("active"),
    );
    const currentChannel = currentActive ? channelFromTab(currentActive) : null;
    const target =
      (available.some((item) => item.channel === "whatsapp") && "whatsapp") ||
      currentChannel ||
      available[0]?.channel ||
      "whatsapp";

    targetChannelRef.current = target;
    setSelectedChannel(target);
    allModeRef.current = true;
    setAllMode(true);

    if (currentChannel !== target) {
      chooseNativeChannel(target);
    }

    refreshList();
  }

  function selectSingleChannel(channel: Channel) {
    allModeRef.current = false;
    setAllMode(false);
    targetChannelRef.current = channel;
    setSelectedChannel(channel);
    chooseNativeChannel(channel);
    refreshList();
  }

  useEffect(() => {
    if (!host || !available.length || autoActivatedRef.current) return;

    autoActivatedRef.current = true;
    window.setTimeout(() => enableAllChannels(), 120);
  }, [host, available.length]);

  const mobileValue = allMode ? "all" : selectedChannel;
  const portal = useMemo(() => {
    if (!host) return null;

    return createPortal(
      <>
        <button
          type="button"
          className={`channel-tab mw1-all-tab ${allMode ? "active" : ""}`}
          onClick={enableAllChannels}
          aria-pressed={allMode}
          title="Ver conversaciones de todos los canales"
        >
          <span aria-hidden="true">◈</span> Todos
        </button>

        <label className="mw1-mobile-channel-select">
          <span className="mw1-mobile-channel-label">Canal</span>
          <select
            value={mobileValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "all") {
                enableAllChannels();
                return;
              }

              const channel = channelFromValue(value);
              if (channel) selectSingleChannel(channel);
            }}
            aria-label="Filtrar conversaciones por canal"
          >
            <option value="all">◈ Todos los canales</option>
            {available.map((item) => (
              <option key={item.channel} value={item.channel}>
                {CHANNELS[item.channel].icon} {item.label}
              </option>
            ))}
          </select>
        </label>
      </>,
      host,
    );
  }, [host, available, allMode, mobileValue]);

  return (
    <>
      <style>{`
        .mw1-all-tab { order: -1; }

        html[data-mw1-unified-channels="all"] .channel-tab.active:not(.mw1-all-tab) {
          color: var(--muted) !important;
          border-color: transparent !important;
        }

        .mw1-mobile-channel-select {
          display: none;
        }

        .mw1-channel-source-badge {
          position: absolute;
          right: -4px;
          bottom: -4px;
          min-width: 20px;
          height: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
          border: 2px solid #fff;
          border-radius: 999px;
          color: #fff;
          font-size: 8px;
          font-weight: 900;
          line-height: 1;
          letter-spacing: -.02em;
          box-shadow: 0 1px 4px rgba(23, 34, 53, .18);
          pointer-events: none;
        }

        .mw1-channel-whatsapp { background: #25d366; }
        .mw1-channel-instagram {
          background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045);
        }
        .mw1-channel-messenger { background: #168aff; }

        @media (max-width: 760px) {
          .channel-tabs {
            position: relative;
            display: block !important;
            margin-bottom: 10px !important;
            padding: 0 10px 10px;
            border-bottom: 1px solid var(--line);
          }

          .channel-tabs > button.channel-tab {
            display: none !important;
          }

          .mw1-mobile-channel-select {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            align-items: center;
            gap: 8px;
            width: 100%;
          }

          .mw1-mobile-channel-label {
            color: var(--muted);
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: .04em;
          }

          .mw1-mobile-channel-select select {
            width: 100%;
            min-width: 0;
            height: 42px;
            border: 1px solid #dfe4ec;
            border-radius: 11px;
            padding: 0 38px 0 12px;
            color: #243047;
            background: #fff;
            font-size: 14px;
            font-weight: 800;
            outline: none;
          }
        }
      `}</style>
      {portal}
    </>
  );
}
