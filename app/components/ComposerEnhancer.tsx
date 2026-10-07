"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type QuickReply = {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  category: string;
  isActive: boolean;
};

type ComposerRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SelectionRange = {
  start: number;
  end: number;
};

const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣",
  "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰",
  "😘", "😋", "😎", "🤩", "🥳", "😏", "😢", "😭",
  "😡", "🤔", "🤗", "🤭", "🙄", "😴", "🙏", "👍",
  "👎", "👌", "👏", "🙌", "💪", "🤝", "👋", "☝️",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
  "💕", "💖", "💝", "✨", "⭐", "🔥", "🎉", "🎁",
  "🛍️", "👗", "👚", "👖", "👟", "📦", "🚚", "💳",
  "✅", "❌", "⚠️", "📍", "📲", "💬", "📸", "🎥",
];

const EMOJI_CATEGORIES = ["😀", "❤️", "🙌", "🎉", "🛍️", "📦", "💬"];

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isCompactViewport() {
  if (typeof window === "undefined") return false;

  return (
    (window.visualViewport?.width ?? window.innerWidth) <= 760 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function findComposerTextarea() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLTextAreaElement>("textarea"),
  );

  return (
    candidates.find((textarea) => {
      const placeholder = textarea.placeholder.toLowerCase();

      return (
        !textarea.disabled &&
        isVisible(textarea) &&
        placeholder.startsWith("escribe un mensaje")
      );
    }) ?? null
  );
}

function ensureComposerSpace(textarea: HTMLTextAreaElement) {
  if (!textarea.dataset.chatproOriginalPaddingLeft) {
    textarea.dataset.chatproOriginalPaddingLeft =
      window.getComputedStyle(textarea).paddingLeft || "0px";
  }

  textarea.style.paddingLeft = "84px";
}

function restoreComposerSpace(textarea: HTMLTextAreaElement | null) {
  if (!textarea?.dataset.chatproOriginalPaddingLeft) return;

  textarea.style.paddingLeft = textarea.dataset.chatproOriginalPaddingLeft;
  delete textarea.dataset.chatproOriginalPaddingLeft;
}

function writeTextareaValue(
  textarea: HTMLTextAreaElement,
  value: string,
  cursor: number,
  focus = true,
) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;

  if (setter) {
    setter.call(textarea, value);
  } else {
    textarea.value = value;
  }

  textarea.dispatchEvent(new Event("input", { bubbles: true }));

  if (focus) {
    textarea.focus();
  }

  window.requestAnimationFrame(() => {
    try {
      textarea.setSelectionRange(cursor, cursor);
    } catch {
      // Algunos navegadores pueden ignorar la selección durante un repaint.
    }
  });
}

function inlineQuickReplyTrigger(textarea: HTMLTextAreaElement) {
  const cursor = textarea.selectionStart ?? textarea.value.length;
  const beforeCursor = textarea.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)\/([^\s/]*)$/);

  if (!match || match.index === undefined) {
    return null;
  }

  const leadingWhitespace = match[1] ?? "";
  const slashStart = match.index + leadingWhitespace.length;
  const contentBeforeSlash = textarea.value.slice(0, slashStart).trim();

  // Si / es el primer contenido, dejamos activo el selector nativo de MW1.
  // Este enhancer resuelve texto existente + /atajo.
  if (!contentBeforeSlash) {
    return null;
  }

  return {
    start: slashStart,
    end: cursor,
    query: (match[2] ?? "").toLowerCase(),
  };
}

export function ComposerEnhancer() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const triggerRangeRef = useRef<SelectionRange | null>(null);
  const savedSelectionRef = useRef<SelectionRange | null>(null);
  const quickPanelRef = useRef<HTMLDivElement | null>(null);
  const emojiPanelRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);

  const [rect, setRect] = useState<ComposerRect | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [query, setQuery] = useState("");

  function rememberSelection(textarea = textareaRef.current) {
    if (!textarea) return;

    savedSelectionRef.current = {
      start: textarea.selectionStart ?? textarea.value.length,
      end: textarea.selectionEnd ?? textarea.selectionStart ?? textarea.value.length,
    };
  }

  function updateRect(textarea = textareaRef.current) {
    if (!textarea || !document.contains(textarea) || !isVisible(textarea)) {
      setRect(null);
      return;
    }

    ensureComposerSpace(textarea);
    const next = textarea.getBoundingClientRect();
    setRect({
      left: next.left,
      top: next.top,
      width: next.width,
      height: next.height,
    });
  }

  async function ensureQuickReplies() {
    if (quickReplies.length || quickLoading) return;

    setQuickLoading(true);
    setQuickError("");

    try {
      const response = await fetch("/api/quick-replies", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        quickReplies?: QuickReply[];
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "No se pudieron cargar las respuestas rápidas.");
      }

      setQuickReplies(
        (payload.quickReplies ?? []).filter((reply) => reply.isActive),
      );
    } catch (error) {
      setQuickError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar las respuestas rápidas.",
      );
    } finally {
      setQuickLoading(false);
    }
  }

  function syncComposer(target?: EventTarget | null) {
    const candidate =
      target instanceof HTMLTextAreaElement &&
      target.placeholder.toLowerCase().startsWith("escribe un mensaje")
        ? target
        : findComposerTextarea();

    if (!candidate) return;

    if (textareaRef.current && textareaRef.current !== candidate) {
      restoreComposerSpace(textareaRef.current);
    }

    textareaRef.current = candidate;
    ensureComposerSpace(candidate);
    rememberSelection(candidate);
    updateRect(candidate);
  }

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      syncComposer(event.target);
    };

    const onSelection = () => {
      const textarea = textareaRef.current;
      if (textarea && document.activeElement === textarea) {
        rememberSelection(textarea);
      }
    };

    const onInput = (event: Event) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;

      const textarea = event.target;
      if (!textarea.placeholder.toLowerCase().startsWith("escribe un mensaje")) {
        return;
      }

      textareaRef.current = textarea;
      ensureComposerSpace(textarea);
      rememberSelection(textarea);
      updateRect(textarea);

      const trigger = inlineQuickReplyTrigger(textarea);

      if (trigger) {
        triggerRangeRef.current = {
          start: trigger.start,
          end: trigger.end,
        };
        setQuery(trigger.query);
        setEmojiOpen(false);
        setQuickOpen(true);
        void ensureQuickReplies();
      } else if (triggerRangeRef.current) {
        triggerRangeRef.current = null;
        setQuickOpen(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (
        quickPanelRef.current?.contains(target) ||
        emojiPanelRef.current?.contains(target) ||
        toolsRef.current?.contains(target) ||
        textareaRef.current?.contains(target)
      ) {
        return;
      }

      setQuickOpen(false);
      setEmojiOpen(false);
    };

    const refresh = () => {
      const textarea = textareaRef.current ?? findComposerTextarea();
      if (textarea) {
        textareaRef.current = textarea;
        ensureComposerSpace(textarea);
        updateRect(textarea);
      } else {
        setRect(null);
      }
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("input", onInput, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);

    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    refresh();

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
      observer.disconnect();
      restoreComposerSpace(textareaRef.current);
    };
  }, []);

  const filteredReplies = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return quickReplies
      .filter((reply) => {
        if (!normalized) return true;

        return (
          reply.shortcut.toLowerCase().includes(normalized) ||
          reply.title.toLowerCase().includes(normalized) ||
          reply.category.toLowerCase().includes(normalized) ||
          reply.body.toLowerCase().includes(normalized)
        );
      })
      .slice(0, 20);
  }, [quickReplies, query]);

  function insertText(
    text: string,
    preferLineBreak: boolean,
    focusAfter = true,
  ) {
    const textarea = textareaRef.current ?? findComposerTextarea();
    if (!textarea) return;

    textareaRef.current = textarea;

    const saved = savedSelectionRef.current;
    const start = saved?.start ?? textarea.selectionStart ?? textarea.value.length;
    const end = saved?.end ?? textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const separatorBefore =
      preferLineBreak && before && !/\s$/.test(before) ? "\n" : "";
    const separatorAfter =
      preferLineBreak && after && !/^\s/.test(after) ? "\n" : "";
    const inserted = `${separatorBefore}${text}${separatorAfter}`;
    const next = `${before}${inserted}${after}`;
    const cursor = before.length + separatorBefore.length + text.length;

    savedSelectionRef.current = { start: cursor, end: cursor };
    writeTextareaValue(textarea, next, cursor, focusAfter);
    updateRect(textarea);
  }

  function chooseQuickReply(reply: QuickReply) {
    const textarea = textareaRef.current ?? findComposerTextarea();
    if (!textarea) return;

    textareaRef.current = textarea;
    const trigger = triggerRangeRef.current;

    if (
      trigger &&
      trigger.start >= 0 &&
      trigger.end >= trigger.start &&
      textarea.value.slice(trigger.start, trigger.end).startsWith("/")
    ) {
      const before = textarea.value.slice(0, trigger.start);
      const after = textarea.value.slice(trigger.end);
      const separatorBefore = before && !/\s$/.test(before) ? "\n" : "";
      const separatorAfter = after && !/^\s/.test(after) ? "\n" : "";
      const next = `${before}${separatorBefore}${reply.body}${separatorAfter}${after}`;
      const cursor = before.length + separatorBefore.length + reply.body.length;

      savedSelectionRef.current = { start: cursor, end: cursor };
      writeTextareaValue(textarea, next, cursor, true);
    } else {
      insertText(reply.body, true, true);
    }

    triggerRangeRef.current = null;
    setQuickOpen(false);
    setQuery("");
  }

  function preparePanelOpen() {
    const textarea = textareaRef.current ?? findComposerTextarea();
    if (!textarea) return null;

    textareaRef.current = textarea;
    ensureComposerSpace(textarea);
    rememberSelection(textarea);
    updateRect(textarea);

    // En móvil cerramos el teclado para que el panel no tape la conversación.
    if (isCompactViewport()) {
      textarea.blur();
    }

    return textarea;
  }

  function openQuickReplies() {
    if (!preparePanelOpen()) return;

    triggerRangeRef.current = null;
    setEmojiOpen(false);
    setQuery("");
    setQuickOpen((current) => !current);
    void ensureQuickReplies();
  }

  function openEmojiPicker() {
    if (!preparePanelOpen()) return;

    setQuickOpen(false);
    setEmojiOpen((current) => !current);
  }

  function closePanels() {
    setQuickOpen(false);
    setEmojiOpen(false);
    setQuery("");
    triggerRangeRef.current = null;
  }

  if (!rect) return null;

  const viewport = typeof window === "undefined" ? null : window.visualViewport;
  const viewportWidth = viewport?.width ?? (typeof window === "undefined" ? 390 : window.innerWidth);
  const viewportHeight = viewport?.height ?? (typeof window === "undefined" ? 700 : window.innerHeight);
  const viewportTop = viewport?.offsetTop ?? 0;
  const compact = isCompactViewport();

  const toolsWidth = 72;
  const toolbarLeft = Math.min(
    Math.max(rect.left + 8, 8),
    Math.max(8, viewportWidth - toolsWidth - 8),
  );
  const toolbarTop = rect.top + Math.max(4, (rect.height - 34) / 2);

  const panelWidth = compact
    ? Math.min(viewportWidth - 16, Math.max(280, rect.width + 24))
    : Math.min(420, Math.max(320, rect.width));
  const panelLeft = Math.min(
    Math.max(8, compact ? rect.left - 12 : rect.left),
    Math.max(8, viewportWidth - panelWidth - 8),
  );

  const maxPanelHeight = compact ? 290 : 360;
  const availableAbove = Math.max(170, rect.top - viewportTop - 12);
  const panelHeight = Math.min(maxPanelHeight, availableAbove);
  const panelTop = Math.max(viewportTop + 8, rect.top - panelHeight - 8);

  const toolButtonStyle = {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: 0,
    background: "transparent",
    color: "#42516a",
    fontSize: 20,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    touchAction: "manipulation" as const,
    padding: 0,
  };

  const closeButtonStyle = {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: 0,
    background: "transparent",
    color: "#627086",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    touchAction: "manipulation" as const,
  };

  const panelShellStyle = {
    position: "fixed" as const,
    zIndex: 2147482100,
    left: panelLeft,
    top: panelTop,
    width: panelWidth,
    height: panelHeight,
    overflow: "hidden",
    border: "1px solid #dde3ea",
    borderRadius: compact ? 16 : 12,
    background: "#fff",
    boxShadow: "0 12px 38px rgba(23,34,53,.2)",
  };

  return (
    <>
      <div
        ref={toolsRef}
        data-chatpro-composer-tools="true"
        style={{
          position: "fixed",
          zIndex: 2147482000,
          left: toolbarLeft,
          top: toolbarTop,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <button
          type="button"
          aria-label="Respuestas rápidas"
          title="Respuestas rápidas"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openQuickReplies}
          style={{
            ...toolButtonStyle,
            background: quickOpen ? "#eef2f6" : "transparent",
          }}
        >
          ⚡
        </button>
        <button
          type="button"
          aria-label="Emoticones"
          title="Emoticones"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openEmojiPicker}
          style={{
            ...toolButtonStyle,
            background: emojiOpen ? "#eef2f6" : "transparent",
          }}
        >
          😊
        </button>
      </div>

      {quickOpen ? (
        <div
          ref={quickPanelRef}
          data-chatpro-quick-replies="true"
          style={panelShellStyle}
        >
          <div
            style={{
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px 0 14px",
              borderBottom: "1px solid #edf0f4",
            }}
          >
            <strong style={{ color: "#253149", fontSize: 14 }}>
              Respuestas rápidas
            </strong>
            <button
              type="button"
              aria-label="Cerrar respuestas rápidas"
              onClick={closePanels}
              style={closeButtonStyle}
            >
              ×
            </button>
          </div>

          <div style={{ padding: "9px 10px", borderBottom: "1px solid #edf0f4" }}>
            <input
              autoFocus={!compact}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar respuesta rápida…"
              style={{
                width: "100%",
                height: 38,
                border: "1px solid #dfe4ec",
                borderRadius: 9,
                padding: "0 11px",
                outline: "none",
                fontSize: 14,
              }}
            />
          </div>

          <div
            style={{
              height: `calc(100% - 105px)`,
              overflowY: "auto",
              padding: 6,
              WebkitOverflowScrolling: "touch",
            }}
          >
            {quickLoading ? (
              <div style={{ padding: 14, color: "#728097", fontSize: 13 }}>
                Cargando respuestas rápidas…
              </div>
            ) : quickError ? (
              <div style={{ padding: 14, color: "#a3333a", fontSize: 13 }}>
                {quickError}
              </div>
            ) : filteredReplies.length ? (
              filteredReplies.map((reply) => (
                <button
                  key={reply.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseQuickReply(reply)}
                  style={{
                    width: "100%",
                    border: 0,
                    borderRadius: 9,
                    background: "transparent",
                    padding: "10px",
                    textAlign: "left",
                    cursor: "pointer",
                    touchAction: "manipulation",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <strong style={{ color: "#243047", fontSize: 13 }}>
                      /{reply.shortcut}
                    </strong>
                    <span style={{ color: "#687589", fontSize: 12 }}>
                      {reply.title}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      color: "#6f7d90",
                      fontSize: 12,
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {reply.body}
                  </div>
                </button>
              ))
            ) : (
              <div style={{ padding: 14, color: "#728097", fontSize: 13 }}>
                No hay respuestas que coincidan.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {emojiOpen ? (
        <div
          ref={emojiPanelRef}
          data-chatpro-emoji-picker="true"
          style={panelShellStyle}
        >
          <div
            style={{
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px 0 14px",
              borderBottom: "1px solid #edf0f4",
            }}
          >
            <strong style={{ color: "#253149", fontSize: 14 }}>
              Emoticones
            </strong>
            <button
              type="button"
              aria-label="Cerrar emoticones"
              onClick={closePanels}
              style={closeButtonStyle}
            >
              ×
            </button>
          </div>

          <div
            style={{
              height: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-around",
              padding: "0 8px",
              borderBottom: "1px solid #edf0f4",
              color: "#687589",
            }}
          >
            {EMOJI_CATEGORIES.map((emoji) => (
              <span key={emoji} aria-hidden="true" style={{ fontSize: 18 }}>
                {emoji}
              </span>
            ))}
          </div>

          <div
            style={{
              height: `calc(100% - 90px)`,
              overflowY: "auto",
              padding: 10,
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${compact ? 7 : 8}, minmax(0, 1fr))`,
                gap: 4,
              }}
            >
              {EMOJIS.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  aria-label={`Insertar ${emoji}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    insertText(emoji, false, !compact);
                  }}
                  style={{
                    minWidth: 0,
                    height: compact ? 40 : 38,
                    border: 0,
                    borderRadius: 8,
                    background: "transparent",
                    fontSize: compact ? 24 : 22,
                    cursor: "pointer",
                    touchAction: "manipulation",
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
