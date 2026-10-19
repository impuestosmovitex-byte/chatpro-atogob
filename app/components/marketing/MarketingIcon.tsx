import type { ReactNode } from "react";

export type MarketingIconName =
  | "whatsapp" | "instagram" | "messenger" | "telegram" | "web"
  | "catalog" | "payment" | "database" | "clock"
  | "sparkles" | "users" | "shopping" | "workflow";

export function MarketingIcon({ name }: { name: MarketingIconName }) {
  let drawing: ReactNode;

  switch (name) {
    case "whatsapp":
      drawing = <>
        <path d="M12 2.6a9.3 9.3 0 0 0-7.98 14.1L3 21l4.45-1.17A9.4 9.4 0 1 0 12 2.6Z" />
        <path d="M9 7.9c-.3-.7-.66-.7-.96-.7-.25 0-.54 0-.82.3-.28.3-1.07 1.04-1.07 2.52s1.1 2.91 1.24 3.11c.14.19 2.17 3.48 5.35 4.42.9.26 1.62.22 2.22.14.69-.1 1.6-.65 1.82-1.28.23-.62.23-1.16.16-1.27-.08-.12-.27-.2-.57-.35l-1.73-.82c-.29-.12-.5-.18-.7.12-.2.29-.78.95-.95 1.14-.17.2-.35.22-.65.07-.29-.15-1.23-.46-2.33-1.48-.86-.76-1.43-1.7-1.6-1.99-.16-.3-.02-.46.13-.61l.43-.52c.14-.18.19-.3.29-.49.1-.2.05-.38-.03-.53l-.73-1.75Z" fill="currentColor" stroke="none" />
      </>;
      break;
    case "instagram":
      drawing = <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.7" r="1" fill="currentColor" stroke="none" />
      </>;
      break;
    case "messenger":
      drawing = <>
        <path d="M12 2.7c5.2 0 9.3 3.6 9.3 8.3 0 4.9-4.1 8.3-9.3 8.3a11 11 0 0 1-2.8-.38L5 21l.45-4A7.8 7.8 0 0 1 2.7 11c0-4.7 4.1-8.3 9.3-8.3Z"/>
        <path d="m6.3 13.7 4-4.2 3.6 2.7 3.8-4.1-4 6.2-3.7-2.7-3.7 2.1Z" fill="currentColor" stroke="none"/>
      </>;
      break;
    case "telegram":
      drawing = <>
        <path d="M21 3 3 10.3l6.3 2.1L18.5 6 11 13.5v5.8l3.3-3.2 4.4 3.3L21 3Z" />
        <path d="m9.3 12.4 1.7 1.1" />
      </>;
      break;
    case "web":
      drawing = <><path d="M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-4a2 2 0 0 1-1-1.8V7.5a2 2 0 0 1 2-2Z" /><path d="M7.5 10h9M7.5 13.5h6" /></>;
      break;
    case "catalog":
      drawing = <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>;
      break;
    case "payment":
      drawing = <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h4" /></>;
      break;
    case "database":
      drawing = <><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.65 3.6 3 8 3s8-1.35 8-3v-13M4 12c0 1.65 3.6 3 8 3s8-1.35 8-3" /></>;
      break;
    case "clock":
      drawing = <><circle cx="12" cy="12" r="9" /><path d="M12 6.6V12l3.7 2.4" /></>;
      break;
    case "sparkles":
      drawing = <><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z" /><path d="m20 2 .4 1.6L22 4l-1.6.4L20 6l-.4-1.6L18 4l1.6-.4L20 2Z" /></>;
      break;
    case "users":
      drawing = <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2H3.5ZM16 5.3a3 3 0 0 1 0 5.4M18 14a5 5 0 0 1 2.5 4.5V20" /></>;
      break;
    case "shopping":
      drawing = <><path d="M3 7h18l-2 13H5L3 7ZM8 9V6a4 4 0 0 1 8 0v3" /></>;
      break;
    case "workflow":
      drawing = <><rect x="2.5" y="3" width="7" height="6" rx="1.5" /><rect x="14.5" y="15" width="7" height="6" rx="1.5" /><path d="M9.5 6h5a4 4 0 0 1 4 4v5M14.5 18h-5a4 4 0 0 1-4-4V9" /></>;
      break;
  }
  return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{drawing}</svg>;
}
