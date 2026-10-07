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
};

const EMOJIS = [
  "😊", "😍", "🥰", "😘", "😁", "😂", "🤣", "😉",
  "😎", "🤩", "🙌", "👏", "🙏", "👍", "👌", "💪",
  "❤️", "💖", "💕", "✨", "🔥", "🎉", "🎁", "🛍️",
  "👗", "👚", "👖", "👟", "📦", "🚚", "💳", "✅",
  "📍", "📲", "💬", "⭐", "🌸", "💜", "🖤", "🤍",
];

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

function writeTextareaValue(
  textarea: HTMLTextAreaElement,
  value: string,
  cursor: number,
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
  textarea.focus();

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

  // Cuando / es el primer contenido, dejamos funcionar el selector nativo de MW1.
  // Este enhancer se ocupa del caso que antes fallaba: texto existente + /atajo.
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
  const triggerRangeRef = useRef<{ start: number; end: number } | null>(null);
  const [rect, setRect] = useState<ComposerRect | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [query, setQuery] = useState("");

  function updateRect(textarea = textareaRef.current) {
    if (!textarea || !document.contains(textarea) || !isVisible(textarea)) {
      setRect(null);
      return;
    }

    const next = textarea.getBoundingClientRect();
    setRect({ left: next.left, top: next.top, width: next.width });
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

    textareaRef.current = candidate;
    updateRect(candidate);
  }

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      syncComposer(event.target);
    };

    const onInput = (event: Event) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;

      const textarea = event.target;
      if (!textarea.placeholder.toLowerCase().startsWith("escribe un mensaje")) {
        return;
      }

      textareaRef.current = textarea;
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

    const refresh = () => {
      const textarea = textareaRef.current ?? findComposerTextarea();
      if (textarea) {
        textareaRef.current = textarea;
        updateRect(textarea);
      } else {
        setRect(null);
      }
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("input", onInput, true);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);

    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    refresh();

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
      observer.disconnect();
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
      .slice(0, 12);
  }, [quickReplies, query]);

  function insertText(text: string, preferLineBreak: boolean) {
    const textarea = textareaRef.current ?? findComposerTextarea();
    if (!textarea) return;

    textareaRef.current = textarea;

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const separatorBefore =
      preferLineBreak && before && !/\s$/.test(before) ? "\n" : "";
    const separatorAfter =
      preferLineBreak && after && !/^\s/.test(after) ? "\n" : "";
    const inserted = `${separatorBefore}${text}${separatorAfter}`;
    const next = `${before}${inserted}${after}`;
    const cursor = before.length + separatorBefore.length + text.length;

    writeTextareaValue(textarea, next, cursor);
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

      writeTextareaValue(textarea, next, cursor);
    } else {
      insertText(reply.body, true);
    }

    triggerRangeRef.current = null;
    setQuickOpen(false);
    setQuery("");
  }

  function openQuickReplies() {
    const textarea = textareaRef.current ?? findComposerTextarea();
    if (!textarea) return;

    textareaRef.current = textarea;
    triggerRangeRef.current = null;
    updateRect(textarea);
    setEmojiOpen(false);
    setQuery("");
    setQuickOpen((current) => !current);
    void ensureQuickReplies();
  }

  function openEmojiPicker() {
    const textarea = textareaRef.current ?? findComposerTextarea();
    if (!textarea) return;

    textareaRef.current = textarea;
    updateRect(textarea);
    setQuickOpen(false);
    setEmojiOpen((current) => !current);
  }

  if (!rect) return null;

  const viewportWidth =
    typeof window === "undefined" ? 390 : window.visualViewport?.width ?? window.innerWidth;
  const panelWidth = Math.min(360, Math.max(280, viewportWidth - 16));
  const toolbarLeft = Math.min(
    Math.max(8, rect.left + 8),
    Math.max(8, viewportWidth - 104),
  );
  const panelLeft = Math.min(
    Math.max(8, rect.left),
    Math.max(8, viewportWidth - panelWidth - 8),
  );
  const toolbarTop = Math.max(8, rect.top - 42);
  const panelTop = Math.max(8, toolbarTop - 316);

  const smallButtonStyle = {
    width: 36,
    height: 36,
    borderRadius: 18,
    border: "1px solid #dfe4ec",
    background: "rgba(255,255,255,.98)",
    boxShadow: "0 4px 14px rgba(31,42,61,.14)",
    color: "#273247",
    fontSize: 18,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    touchAction: "manipulation" as const,
  };

  return (
    <>
      <div
        data-chatpro-composer-tools="true"
        style={{
          position: "fixed",
          zIndex: 2147482000,
          left: toolbarLeft,
          top: toolbarTop,
          display: "flex",
          gap: 6,
        }}
      >
        <button
          type="button"
          aria-label="Respuestas rápidas"
          title="Respuestas rápidas"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openQuickReplies}
          style={smallButtonStyle}
        >
          ⚡
        </button>
        <button
          type="button"
          aria-label="Emoticones"
          title="Emoticones"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openEmojiPicker}
          style={smallButtonStyle}
        >
          😊
        </button>
      </div>

      {quickOpen ? (
        <div
          data-chatpro-quick-replies="true"
          style={{
            position: "fixed",
            zIndex: 2147482100,
            left: panelLeft,
            top: panelTop,
            width: panelWidth,
            maxHeight: 300,
            overflow: "hidden",
            border: "1px solid #dfe4ec",
            borderRadius: 14,
            background: "#fff",
            boxShadow: "0 14px 40px rgba(23,34,53,.2)",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid #edf0f4" }}>
            <input
              autoFocus
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
          <div style={{ maxHeight: 238, overflowY: "auto", padding: 6 }}>
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
                    padding: "9px 10px",
                    textAlign: "left",
                    cursor: "pointer",
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
                      marginTop: 3,
                      color: "#7a8799",
                      fontSize: 11,
                      lineHeight: 1.35,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
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
          data-chatpro-emoji-picker="true"
          style={{
            position: "fixed",
            zIndex: 2147482100,
            left: panelLeft,
            top: Math.max(8, toolbarTop - 248),
            width: panelWidth,
            border: "1px solid #dfe4ec",
            borderRadius: 14,
            background: "#fff",
            boxShadow: "0 14px 40px rgba(23,34,53,.2)",
            padding: 10,
          }}
        >
          <div
            style={{
              marginBottom: 8,
              color: "#667388",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Emoticones
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
              gap: 4,
            }}
          >
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Insertar ${emoji}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  insertText(emoji, false);
                  setEmojiOpen(false);
                }}
                style={{
                  minWidth: 0,
                  height: 36,
                  border: 0,
                  borderRadius: 8,
                  background: "transparent",
                  fontSize: 22,
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
