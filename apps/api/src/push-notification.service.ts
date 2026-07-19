import { Injectable } from "@nestjs/common";
import * as webpush from "web-push";
import { SupabaseService } from "./supabase.service";

type PushSubscriptionInput = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

type VapidCredentials = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

@Injectable()
export class PushNotificationService {
  constructor(private readonly supabaseService: SupabaseService) {}

  getPublicConfig() {
    const credentials = this.credentials();

    return {
      configured: Boolean(credentials),
      publicKey: credentials?.publicKey ?? "",
    };
  }

  async assertActiveMembership(
    companyId: string,
    userId: string,
  ): Promise<void> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from("company_memberships")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();

    if (error) {
      throw new Error(
        `No se pudo validar el acceso del usuario: ${error.message}`,
      );
    }

    if (!data) {
      throw new Error(
        "El usuario no tiene una membresía activa en esta empresa.",
      );
    }
  }

  async subscribe(input: {
    companyId: string;
    userId: string;
    subscription: PushSubscriptionInput;
    userAgent: string;
    platform: string;
  }) {
    this.requireCredentials();
    await this.assertActiveMembership(input.companyId, input.userId);

    const now = new Date().toISOString();
    const expirationTime =
      typeof input.subscription.expirationTime === "number" &&
      Number.isFinite(input.subscription.expirationTime)
        ? new Date(input.subscription.expirationTime).toISOString()
        : null;

    const { data, error } = await this.supabaseService
      .getClient()
      .from("push_subscriptions")
      .upsert(
        {
          company_id: input.companyId,
          user_id: input.userId,
          endpoint: input.subscription.endpoint,
          p256dh: input.subscription.keys.p256dh,
          auth: input.subscription.keys.auth,
          expiration_time: expirationTime,
          user_agent: input.userAgent,
          platform: input.platform,
          enabled: true,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: "endpoint" },
      )
      .select("id, enabled, updated_at")
      .single();

    if (error) {
      throw new Error(
        `No se pudo guardar la suscripción: ${error.message}`,
      );
    }

    return data;
  }

  async unsubscribe(input: {
    companyId: string;
    userId: string;
    endpoint: string;
  }) {
    await this.assertActiveMembership(input.companyId, input.userId);

    const { error } = await this.supabaseService
      .getClient()
      .from("push_subscriptions")
      .update({
        enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", input.companyId)
      .eq("user_id", input.userId)
      .eq("endpoint", input.endpoint);

    if (error) {
      throw new Error(
        `No se pudo desactivar la suscripción: ${error.message}`,
      );
    }
  }

  async sendTest(companyId: string, userId: string) {
    await this.assertActiveMembership(companyId, userId);

    return this.sendToUser(companyId, userId, {
      title: "ChatPro",
      body: "Las notificaciones están activadas correctamente.",
      url: "/",
      tag: "chatpro-test",
    });
  }

  async sendToUser(
    companyId: string,
    userId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number }> {
    const credentials = this.requireCredentials();

    const { data, error } = await this.supabaseService
      .getClient()
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("enabled", true);

    if (error) {
      throw new Error(
        `No se pudieron consultar las suscripciones: ${error.message}`,
      );
    }

    const subscriptions = (data ?? []) as SubscriptionRow[];
    let sent = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(payload),
          {
            vapidDetails: credentials,
            TTL: 120,
            urgency: "high",
            topic: this.topic(payload.tag),
          },
        );

        sent += 1;
      } catch (error) {
        failed += 1;

        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : null;

        if (statusCode === 404 || statusCode === 410) {
          await this.disableSubscription(subscription.id);
        }

        console.error(
          `No se pudo enviar una notificación push (${statusCode ?? "sin estado"}):`,
          error,
        );
      }
    }

    return { sent, failed };
  }

  private credentials(): VapidCredentials | null {
    const subject = process.env.VAPID_SUBJECT?.trim() ?? "";
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";

    if (!subject || !publicKey || !privateKey) {
      return null;
    }

    if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
      return null;
    }

    return { subject, publicKey, privateKey };
  }

  private requireCredentials(): VapidCredentials {
    const credentials = this.credentials();

    if (!credentials) {
      throw new Error(
        "Faltan VAPID_SUBJECT, VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY en Railway.",
      );
    }

    return credentials;
  }

  private async disableSubscription(id: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from("push_subscriptions")
      .update({
        enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error(
        `No se pudo desactivar la suscripción vencida ${id}:`,
        error,
      );
    }
  }

  private topic(value: string): string {
    const normalized = value
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .slice(0, 32);

    return normalized || "chatpro";
  }
}
