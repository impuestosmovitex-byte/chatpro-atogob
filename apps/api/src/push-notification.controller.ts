import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
} from "@nestjs/common";
import { PushNotificationService } from "./push-notification.service";

type PushBody = {
  subscription?: unknown;
  endpoint?: unknown;
  userAgent?: unknown;
  platform?: unknown;
};

type Identity = {
  companyId: string;
  userId: string;
};

@Controller("push-notifications")
export class PushNotificationController {
  constructor(
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  @Get("config")
  async config(
    @Headers("x-chatpro-inbox-key") key = "",
    @Headers("x-chatpro-company-id") companyId = "",
    @Headers("x-chatpro-user-id") userId = "",
  ) {
    this.authorize(key);
    const identity = this.identity(companyId, userId);

    await this.pushNotificationService.assertActiveMembership(
      identity.companyId,
      identity.userId,
    );

    return {
      ok: true,
      ...this.pushNotificationService.getPublicConfig(),
    };
  }

  @Post("subscribe")
  @HttpCode(200)
  async subscribe(
    @Headers("x-chatpro-inbox-key") key = "",
    @Headers("x-chatpro-company-id") companyId = "",
    @Headers("x-chatpro-user-id") userId = "",
    @Body() body: PushBody = {},
  ) {
    this.authorize(key);
    const identity = this.identity(companyId, userId);
    const subscription = this.subscription(body.subscription);

    const saved = await this.pushNotificationService.subscribe({
      ...identity,
      subscription,
      userAgent: this.text(body.userAgent).slice(0, 900),
      platform: this.text(body.platform).slice(0, 200),
    });

    return { ok: true, subscription: saved };
  }

  @Post("unsubscribe")
  @HttpCode(200)
  async unsubscribe(
    @Headers("x-chatpro-inbox-key") key = "",
    @Headers("x-chatpro-company-id") companyId = "",
    @Headers("x-chatpro-user-id") userId = "",
    @Body() body: PushBody = {},
  ) {
    this.authorize(key);
    const identity = this.identity(companyId, userId);
    const endpoint = this.text(body.endpoint);

    if (!endpoint) {
      throw new BadRequestException(
        "Falta el endpoint de la suscripción.",
      );
    }

    await this.pushNotificationService.unsubscribe({
      ...identity,
      endpoint,
    });

    return { ok: true };
  }

  @Post("test")
  @HttpCode(200)
  async test(
    @Headers("x-chatpro-inbox-key") key = "",
    @Headers("x-chatpro-company-id") companyId = "",
    @Headers("x-chatpro-user-id") userId = "",
  ) {
    this.authorize(key);
    const identity = this.identity(companyId, userId);
    const result = await this.pushNotificationService.sendTest(
      identity.companyId,
      identity.userId,
    );

    if (result.sent === 0) {
      throw new BadRequestException(
        "No hay un dispositivo activo para enviar la prueba.",
      );
    }

    return { ok: true, ...result };
  }

  private authorize(key: string): void {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || key !== expected) {
      throw new ForbiddenException("Acceso no autorizado.");
    }
  }

  private identity(companyId: string, userId: string): Identity {
    const normalizedCompanyId = companyId.trim();
    const normalizedUserId = userId.trim();

    if (!normalizedCompanyId || !normalizedUserId) {
      throw new ForbiddenException(
        "Las notificaciones requieren un usuario individual y una empresa activa.",
      );
    }

    return {
      companyId: normalizedCompanyId,
      userId: normalizedUserId,
    };
  }

  private subscription(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(
        "La suscripción del dispositivo no es válida.",
      );
    }

    const row = value as Record<string, unknown>;
    const endpoint = this.text(row.endpoint);
    const expirationTime =
      typeof row.expirationTime === "number" &&
      Number.isFinite(row.expirationTime)
        ? row.expirationTime
        : null;
    const keys =
      row.keys && typeof row.keys === "object" && !Array.isArray(row.keys)
        ? (row.keys as Record<string, unknown>)
        : {};
    const p256dh = this.text(keys.p256dh);
    const auth = this.text(keys.auth);

    if (!endpoint.startsWith("https://") || !p256dh || !auth) {
      throw new BadRequestException(
        "La suscripción push está incompleta.",
      );
    }

    return {
      endpoint,
      expirationTime,
      keys: { p256dh, auth },
    };
  }

  private text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
