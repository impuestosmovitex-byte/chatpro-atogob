"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./PushNotificationManager.module.css";

type NotificationState =
  | "hidden"
  | "loading"
  | "ready"
  | "activating"
  | "active"
  | "denied"
  | "missing_config"
  | "error";

type PushConfigResponse = {
  ok?: boolean;
  error?: string;
  configured?: boolean;
  publicKey?: string;
};

type PushActionResponse = {
  ok?: boolean;
  error?: string;
  sent?: number;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output.buffer as ArrayBuffer;
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T;

  if (!response.ok) {
    const error =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "No se pudo completar la solicitud.";

    throw new Error(error);
  }

  return payload;
}

async function pushAction(
  action: "subscribe" | "unsubscribe" | "test",
  body: Record<string, unknown> = {},
): Promise<PushActionResponse> {
  return readJson<PushActionResponse>(
    await fetch("/api/push-notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
      cache: "no-store",
    }),
  );
}

export function PushNotificationManager() {
  const pathname = usePathname();
  const [state, setState] = useState<NotificationState>("hidden");
  const [detail, setDetail] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (pathname === "/login") {
      setState("hidden");
      return;
    }

    let cancelled = false;

    async function prepare() {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("hidden");
        return;
      }

      if (isIosDevice() && !isStandalone()) {
        setState("hidden");
        return;
      }

      setState("loading");

      try {
        const configResponse = await fetch("/api/push-notifications", {
          cache: "no-store",
        });

        if (configResponse.status === 401 || configResponse.status === 403) {
          setState("hidden");
          return;
        }

        const config = await readJson<PushConfigResponse>(configResponse);

        if (!config.configured || !config.publicKey) {
          setDetail(
            "Falta terminar la configuración de notificaciones en el servidor.",
          );
          setState("missing_config");
          return;
        }

        if (cancelled) return;

        setPublicKey(config.publicKey);

        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        await navigator.serviceWorker.ready;

        const currentSubscription =
          await registration.pushManager.getSubscription();

        if (currentSubscription) {
          await pushAction("subscribe", {
            subscription: currentSubscription.toJSON(),
            userAgent: navigator.userAgent,
            platform: navigator.platform || "",
          });

          localStorage.setItem(
            "chatpro_push_endpoint",
            currentSubscription.endpoint,
          );
          setState("hidden");
          return;
        }

        if (Notification.permission === "denied") {
          setDetail(
            "Las notificaciones están bloqueadas. Actívalas desde los ajustes del dispositivo.",
          );
          setState("denied");
          return;
        }

        setDetail(
          "Recibe avisos cuando llegue un mensaje nuevo y ChatPro esté cerrado.",
        );
        setState("ready");
      } catch (error) {
        if (cancelled) return;

        setDetail(
          error instanceof Error
            ? error.message
            : "No se pudieron preparar las notificaciones.",
        );
        setState("error");
      }
    }

    void prepare();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function activate() {
    if (!publicKey) {
      setDetail("Falta la clave pública de notificaciones.");
      setState("error");
      return;
    }

    setState("activating");
    setDetail("Preparando las notificaciones…");

    try {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setDetail(
          permission === "denied"
            ? "Las notificaciones quedaron bloqueadas en el dispositivo."
            : "No se concedió permiso para enviar notificaciones.",
        );
        setState(permission === "denied" ? "denied" : "ready");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(publicKey),
        }));

      await pushAction("subscribe", {
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
        platform: navigator.platform || "",
      });

      const test = await pushAction("test");

      localStorage.setItem("chatpro_push_endpoint", subscription.endpoint);

      if (!mounted.current) return;

      setDetail(
        (test.sent ?? 0) > 0
          ? "Notificaciones activadas. Enviamos una prueba."
          : "Notificaciones activadas correctamente.",
      );
      setState("active");

      window.setTimeout(() => {
        if (mounted.current) {
          setState("hidden");
        }
      }, 5000);
    } catch (error) {
      if (!mounted.current) return;

      setDetail(
        error instanceof Error
          ? error.message
          : "No se pudieron activar las notificaciones.",
      );
      setState("error");
    }
  }

  if (state === "hidden" || state === "loading") {
    return null;
  }

  const showActivateButton =
    state === "ready" || state === "error" || state === "activating";

  return (
    <aside
      className={`${styles.card} ${
        state === "active" ? styles.success : ""
      }`}
      aria-live="polite"
    >
      <div className={styles.icon} aria-hidden="true">
        {state === "active" ? "✓" : "🔔"}
      </div>

      <div className={styles.content}>
        <strong>
          {state === "active"
            ? "Notificaciones activadas"
            : "Notificaciones de ChatPro"}
        </strong>
        <p>{detail}</p>
      </div>

      {showActivateButton ? (
        <button
          className={styles.button}
          type="button"
          onClick={() => void activate()}
          disabled={state === "activating"}
        >
          {state === "activating" ? "Activando…" : "Activar"}
        </button>
      ) : null}
    </aside>
  );
}
