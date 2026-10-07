"use client";

import { useEffect } from "react";

const MESSAGE_SELECTOR = ".message-bubble p";
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?\)\]\}]+$/;

function splitTrailingPunctuation(value: string) {
  const trailing = value.match(TRAILING_PUNCTUATION)?.[0] ?? "";

  return {
    url: trailing ? value.slice(0, -trailing.length) : value,
    trailing,
  };
}

function buildHref(value: string) {
  return /^www\./i.test(value) ? `https://${value}` : value;
}

function linkifyParagraph(element: HTMLParagraphElement) {
  if (element.querySelector("a[data-chatpro-message-link]")) {
    return;
  }

  const text = element.textContent ?? "";
  const matches = [...text.matchAll(new RegExp(URL_PATTERN.source, "gi"))];

  if (!matches.length) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of matches) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    const { url, trailing } = splitTrailingPunctuation(raw);

    if (!url) {
      continue;
    }

    if (start > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, start)));
    }

    const anchor = document.createElement("a");
    anchor.dataset.chatproMessageLink = "true";
    anchor.href = buildHref(url);
    anchor.textContent = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.title = "Abrir enlace";
    anchor.style.color = "#1f62d1";
    anchor.style.textDecoration = "underline";
    anchor.style.textUnderlineOffset = "2px";
    anchor.style.overflowWrap = "anywhere";
    anchor.style.wordBreak = "break-word";
    anchor.style.cursor = "pointer";
    anchor.style.touchAction = "manipulation";
    anchor.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    fragment.append(anchor);

    if (trailing) {
      fragment.append(document.createTextNode(trailing));
    }

    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  element.replaceChildren(fragment);
}

function scan(root: ParentNode) {
  if (
    root instanceof HTMLParagraphElement &&
    root.matches(MESSAGE_SELECTOR)
  ) {
    linkifyParagraph(root);
  }

  root.querySelectorAll<HTMLParagraphElement>(MESSAGE_SELECTOR).forEach(
    linkifyParagraph,
  );
}

export function MessageLinkifier() {
  useEffect(() => {
    scan(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            scan(node);
          }
        }

        if (mutation.target instanceof HTMLParagraphElement) {
          scan(mutation.target);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
