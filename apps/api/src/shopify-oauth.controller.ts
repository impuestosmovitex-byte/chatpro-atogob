import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { SupabaseService } from './supabase.service';

type TokenResponse = { access_token?: string };

@Controller('integrations/shopify')
export class ShopifyOauthController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly credentials: IntegrationCredentialsService,
  ) {}

  @Get('connect')
  async connect(
    @Headers('x-chatpro-inbox-key') key: string | undefined,
    @Query('company') slugInput: string | undefined,
    @Query('shop') shopInput: string | undefined,
  ) {
    this.authorize(key);
    const company = await this.company(slugInput);
    const shop = this.shop(shopInput);
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await this.supabase.getClient()
      .from('integration_oauth_states')
      .insert({
        company_id: company.id,
        provider: 'shopify',
        integration_type: 'store',
        state_hash: this.hash(state),
        expires_at: expiresAt,
      });

    if (error) {
      throw new BadRequestException(`No se pudo iniciar Shopify: ${error.message}`);
    }

    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', this.env('SHOPIFY_PLATFORM_CLIENT_ID'));
    url.searchParams.set('scope', 'read_products,read_orders');
    url.searchParams.set('redirect_uri', this.callbackUrl());
    url.searchParams.set('state', state);

    return { ok: true, authorizationUrl: url.toString(), expiresAt };
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, string | string[] | undefined>,
    @Res() response: Response,
  ) {
    try {
      const values = this.queryValues(query);

      if (this.text(values.error)) {
        return this.page(response, false, 'Shopify canceló o rechazó la autorización. Regresa a Chat Pro e inténtalo nuevamente.');
      }

      const shop = this.shop(values.shop);
      const code = this.text(values.code);
      const state = this.text(values.state);
      const hmac = this.text(values.hmac);

      if (!code || !state || !hmac) {
        throw new BadRequestException('Shopify no devolvió los datos necesarios.');
      }

      this.validHmac(values, hmac);

      const client = this.supabase.getClient();
      const { data: stateRow, error: stateError } = await client
        .from('integration_oauth_states')
        .select('id,company_id,expires_at,used_at')
        .eq('provider', 'shopify')
        .eq('integration_type', 'store')
        .eq('state_hash', this.hash(state))
        .maybeSingle();

      if (stateError || !stateRow) {
        throw new BadRequestException('La autorización expiró o no corresponde a Chat Pro.');
      }

      if (stateRow.used_at || Date.parse(stateRow.expires_at) <= Date.now()) {
        throw new BadRequestException('La autorización expiró. Inicia la conexión nuevamente.');
      }

      const { data: existingIntegration, error: existingIntegrationError } =
        await client
          .from('company_integrations')
          .select('id, company_id')
          .eq('provider', 'shopify')
          .eq('integration_type', 'store')
          .eq('external_id', shop)
          .maybeSingle();

      if (existingIntegrationError) {
        throw new BadRequestException(
          `No se pudo validar si esta tienda ya está conectada: ${existingIntegrationError.message}`,
        );
      }

      if (
        existingIntegration &&
        existingIntegration.company_id !== stateRow.company_id
      ) {
        throw new BadRequestException(
          'Esta tienda Shopify ya está conectada a otra empresa en Chat Pro.',
        );
      }

      const token = await this.exchange(shop, code);
      const now = new Date().toISOString();

      const { error: saveError } = await client
        .from('company_integrations')
        .upsert(
          {
            company_id: stateRow.company_id,
            provider: 'shopify',
            integration_type: 'store',
            external_id: shop,
            status: 'active',
            config: {
              api_version: process.env.SHOPIFY_PLATFORM_API_VERSION?.trim() || '2026-04',
              shop_domain: shop,
              store_url: `https://${shop}`,
            },
            credential_mode: 'encrypted',
            credential_reference: {
              token_format: 'shopify_offline_access_token',
              shop_domain: shop,
            },
            credentials_encrypted: this.credentials.encrypt({
              access_token: token.access_token,
            }),
            updated_at: now,
          },
          { onConflict: 'provider,integration_type,external_id' },
        );

      if (saveError) {
        throw new BadRequestException(`No se pudo guardar Shopify: ${saveError.message}`);
      }

      const { error: disconnectError } = await client
        .from('company_integrations')
        .update({ status: 'disconnected', updated_at: now })
        .eq('company_id', stateRow.company_id)
        .eq('provider', 'shopify')
        .eq('integration_type', 'store')
        .neq('external_id', shop)
        .eq('status', 'active');

      if (disconnectError) {
        throw new BadRequestException(
          `Shopify quedó guardada, pero no se pudo cerrar la conexión anterior: ${disconnectError.message}`,
        );
      }

      await client
        .from('integration_oauth_states')
        .update({ used_at: now })
        .eq('id', stateRow.id);

      return this.page(response, true, 'Shopify quedó conectada. Regresa a Chat Pro y actualiza Canales e integraciones.');
    } catch (error) {
      return this.page(
        response,
        false,
        error instanceof Error
          ? error.message
          : 'No se pudo completar la conexión con Shopify.',
      );
    }
  }

  private async exchange(shop: string, code: string): Promise<{ access_token: string }> {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.env('SHOPIFY_PLATFORM_CLIENT_ID'),
        client_secret: this.env('SHOPIFY_PLATFORM_CLIENT_SECRET'),
        code,
      }),
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Shopify no aceptó la autorización: ${await response.text()}`,
      );
    }

    const token = (await response.json()) as TokenResponse;
    const accessToken = this.text(token.access_token);

    if (!accessToken) {
      throw new BadRequestException('Shopify no devolvió un token válido.');
    }

    return { access_token: accessToken };
  }

  private validHmac(values: Record<string, string>, received: string) {
    const message = Object.entries(values)
      .filter(([key]) => key !== 'hmac' && key !== 'signature')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    const expected = createHmac(
      'sha256',
      this.env('SHOPIFY_PLATFORM_CLIENT_SECRET'),
    )
      .update(message)
      .digest('hex');

    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(received, 'utf8');

    if (
      left.length !== right.length ||
      !timingSafeEqual(left, right)
    ) {
      throw new BadRequestException('No se pudo validar la respuesta segura de Shopify.');
    }
  }

  private async company(slugInput: string | undefined) {
    const slug = this.text(slugInput).toLowerCase();

    if (!slug) {
      throw new BadRequestException('Falta la empresa.');
    }

    const { data, error } = await this.supabase.getClient()
      .from('companies')
      .select('id,slug,name')
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new BadRequestException(error?.message || 'Empresa no encontrada.');
    }

    return data as { id: string; slug: string; name: string };
  }

  private shop(value: string | undefined) {
    const shop = this.text(value)
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();

    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw new BadRequestException(
        'Escribe un dominio válido, por ejemplo mitienda.myshopify.com.',
      );
    }

    return shop;
  }

  private callbackUrl() {
    return `${this.env('CHATPRO_PUBLIC_API_URL').replace(/\/$/, '')}/integrations/shopify/callback`;
  }

  private queryValues(query: Record<string, string | string[] | undefined>) {
    const output: Record<string, string> = {};

    for (const [key, value] of Object.entries(query)) {
      output[key] = Array.isArray(value)
        ? value[0] || ''
        : typeof value === 'string'
          ? value
          : '';
    }

    return output;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private env(name: string) {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new BadRequestException(`Falta la variable ${name} en Railway.`);
    }

    return value;
  }

  private authorize(value: string | undefined) {
    const expected = process.env.CHATPRO_INBOX_KEY?.trim();

    if (!expected || value?.trim() !== expected) {
      throw new UnauthorizedException('No autorizado.');
    }
  }

  private page(response: Response, success: boolean, message: string) {
    const safe = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return response
      .status(success ? 200 : 400)
      .type('html')
      .send(`<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopify · Chat Pro</title></head>
<body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#202126">
<main style="max-width:620px;margin:72px auto;padding:32px;background:#fff;border:1px solid #e1e3e8;border-radius:18px">
<p style="margin:0 0 10px;color:${success ? '#24723a' : '#a63838'};font-weight:800;text-transform:uppercase">Shopify</p>
<h1 style="margin:0 0 14px">${success ? 'Conexión completada' : 'No se pudo conectar'}</h1>
<p style="margin:0;line-height:1.55">${safe}</p>
</main></body></html>`);
  }
}
