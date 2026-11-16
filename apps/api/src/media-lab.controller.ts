import {
  Controller, Get, Headers, Param, Res, UnauthorizedException, NotFoundException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';

/**
 * Non-operational, static media QA only. No service providers, no network,
 * no database/storage client, no messaging endpoints, no customer content.
 */
@Controller()
export class MediaLabController {
  @Get('health')
  health() {
    return { ok: true, service: 'mw1-media-lab', syntheticOnly: true };
  }

  @Get('lab/media/:fixtureId')
  download(
    @Headers('authorization') authorization = '',
    @Headers('x-mw1-lab-tenant') tenant = '',
    @Param('fixtureId') fixtureId = '',
    @Res() response: Response,
  ) {
    const secret = process.env.MW1_MEDIA_LAB_AUTH_SECRET || '';
    const configuredTenant = process.env.MW1_MEDIA_LAB_DATASET_ID || '';
    // No data may be served unless separately authorized with one lab-only
    // token and exactly the single tenant this instance was configured for.
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7) : '';
    const secretBytes = Buffer.from(secret);
    const tokenBytes = Buffer.from(token);
    if (
      secretBytes.length < 32 ||
      tokenBytes.length !== secretBytes.length ||
      !timingSafeEqual(tokenBytes, secretBytes) ||
      !configuredTenant || tenant !== configuredTenant
    ) {
      throw new UnauthorizedException('Laboratorio no autorizado.');
    }

    // All responses are deterministic synthetic fixtures constructed in memory.
    // No dynamic storage paths, user-controlled URLs or remote fetch calls.
    const fixtures: Record<string, {type: string; content: Buffer}> = {
      'synthetic-image': {
        type: 'image/png',
        content: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
          'base64',
        ),
      },
      'synthetic-document': {
        type: 'text/plain; charset=utf-8',
        content: Buffer.from('MW1 synthetic lab fixture - no customer data\n', 'utf8'),
      },
    };
    const fixture = Object.prototype.hasOwnProperty.call(fixtures, fixtureId)
      ? fixtures[fixtureId] : undefined;
    if (!fixture) {
      throw new NotFoundException('Archivo de prueba inexistente.');
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', fixture.type);
    response.setHeader('Content-Length', String(fixture.content.length));
    return response.status(200).send(fixture.content);
  }
}
