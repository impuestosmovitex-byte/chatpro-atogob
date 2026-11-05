import { Controller, ForbiddenException, Get, Headers, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { StagingWhatsappCoexistenceOAuthHandshakeService } from './staging-whatsapp-coexistence-oauth-handshake.service';

/**
 * STAGING ONLY. A real server-to-server entry point for the isolated pilot
 * OAuth nonce. Registered only in staging-app.module.ts, NEVER AppModule.
 * This does NOT launch Meta, exchange codes, connect a number or subscribe
 * webhooks. Disabled by default and requires a dedicated staging signing key.
 */
@Controller('integrations/whatsapp/coexistence/pilot')
export class StagingWhatsappCoexistencePilotController {
  constructor(private readonly handshake: StagingWhatsappCoexistenceOAuthHandshakeService) {}

  private authorize(key: string, userId: string, companyId: string, slug: string) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim() || '';
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (process.env.MW1_STAGING_MODE !== 'true' ||
        process.env.SUPABASE_URL?.trim().replace(/\/$/,'') !==
          'https://zqfbxqszfnrbwpfukwak.supabase.co' ||
        !expected || !key || !timingSafeEqual(hash(key), hash(expected)) ||
        slug !== 'piloto-mw1-prueba' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
      throw new ForbiddenException('El piloto de WhatsApp no está autorizado.');
    }
    return {internalKey:key,companySlug:slug,companyId,userId};
  }

  /** Readiness only. Exposes no secrets or credentials. */
  @Get('readiness')
  readiness(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    this.authorize(key,userId,companyId,slug);
    const prepared = process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED === 'true' &&
      (process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET?.length || 0) >= 32 &&
      process.env.META_WHATSAPP_APP_ID?.trim() === '1079916404666757' &&
      process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID?.trim() === '1431168516739052';
    return {
      ok:true,beginReady:prepared,metaLaunchEnabled:false,
      codeExchangeEnabled:false,connectionEnabled:false,
      message:prepared
        ? 'Inicio seguro del piloto preparado. La autorización real de Meta sigue deshabilitada.'
        : 'Falta habilitar y validar exclusivamente el inicio OAuth de staging.',
    };
  }

  @Post('begin')
  async begin(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
  ) {
    const actor=this.authorize(key,userId,companyId,slug);
    if (process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED !== 'true' ||
        (process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET?.length || 0) < 32 ||
        process.env.META_WHATSAPP_APP_ID?.trim() !== '1079916404666757' ||
        process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID?.trim() !== '1431168516739052') {
      throw new ServiceUnavailableException('El inicio seguro del piloto todavía no está habilitado.');
    }
    // The handshake independently validates active company membership and
    // owner/admin role before inserting only the SHA-256 state hash.
    try {
      const issued=await this.handshake.issue(actor);
      return {
        ok:true,signedState:issued.signedState,onboardingId:issued.onboardingId,
        metaLaunchEnabled:false,codeExchangeEnabled:false,connectionEnabled:false,
      };
    } catch {
      throw new ForbiddenException('No se pudo autorizar el inicio OAuth del piloto.');
    }
  }
}
