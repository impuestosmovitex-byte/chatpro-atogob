import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Options,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConversationMemoryService } from './conversation-memory.service';

type LeadBody = {
  nombre?: unknown;
  fullName?: unknown;
  telefono_whatsapp?: unknown;
  whatsapp?: unknown;
  phone?: unknown;
  correo?: unknown;
  email?: unknown;
  objetivo?: unknown;
  objective?: unknown;
  respuesta_pregunta_1?: unknown;
  question1?: unknown;
  capacitacion_actual?: unknown;
  training?: unknown;
  respuesta_pregunta_3?: unknown;
  question3?: unknown;
  consentimiento_contacto?: unknown;
  consent?: unknown;
  website?: unknown;
};

const COMPANY_SLUG = 'emprende-con-maogo';
const EVENT_TAG = 'EFIX-2026';
const ALLOWED_ORIGINS = new Set([
  'https://emprendeconmaogo.com',
  'https://www.emprendeconmaogo.com',
]);

@Controller('public/leads')
export class PublicLeadsController {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
  ) {}

  @Options('efix')
  options(
    @Headers('origin') origin = '',
    @Res() response: Response,
  ) {
    this.applyCors(origin, response);
    return response.sendStatus(204);
  }

  @Post('efix')
  @HttpCode(200)
  async captureEfixLead(
    @Headers('origin') origin = '',
    @Res({ passthrough: true }) response: Response,
    @Body() body: LeadBody = {},
  ) {
    this.assertOrigin(origin);
    this.applyCors(origin, response);

    // Honeypot opcional para bots.
    if (this.clean(body.website, 200)) {
      return { ok: true };
    }

    const fullName = this.clean(body.nombre ?? body.fullName, 120);
    const phone = this.normalizePhone(
      body.telefono_whatsapp ?? body.whatsapp ?? body.phone,
    );
    const email = this.clean(body.correo ?? body.email, 180).toLowerCase();
    const objective = this.clean(body.objetivo ?? body.objective, 260);
    const question1 = this.clean(
      body.respuesta_pregunta_1 ?? body.question1,
      500,
    );
    const training = this.clean(
      body.capacitacion_actual ?? body.training,
      300,
    );
    const question3 = this.clean(
      body.respuesta_pregunta_3 ?? body.question3,
      500,
    );
    const consent = this.readBoolean(
      body.consentimiento_contacto ?? body.consent,
    );

    if (!fullName || !phone || !email || !objective) {
      throw new BadRequestException(
        'Completa nombre, WhatsApp, correo y objetivo.',
      );
    }

    if (!this.validEmail(email)) {
      throw new BadRequestException('Correo no válido.');
    }

    if (!consent) {
      throw new BadRequestException(
        'Debes aceptar la autorización de contacto.',
      );
    }

    const tags = [EVENT_TAG];
    const objectiveTag = this.objectiveTag(objective);
    const trainingTag = this.trainingTag(training);

    if (objectiveTag) tags.push(objectiveTag);
    if (trainingTag) tags.push(trainingTag);

    const registeredAt = new Date().toISOString();
    const notes = [
      'LEAD EFIX 2026',
      `Correo: ${email}`,
      `Objetivo: ${objective}`,
      `Pregunta 1: ${question1 || 'Sin respuesta'}`,
      `Capacitación actual: ${training || 'Sin respuesta'}`,
      `Pregunta 3: ${question3 || 'Sin respuesta'}`,
      'Fuente: Feria',
      'Origen: QR Stand',
      'Evento: EFIX 2026',
      'Estado lead: Lead nuevo',
      `Consentimiento contacto: Sí (${registeredAt})`,
    ].join('\n');

    const saved = await this.conversationMemoryService.createManualContact(
      COMPANY_SLUG,
      {
        phone,
        displayName: fullName,
        tags,
        notes,
      },
    );

    return {
      ok: true,
      message: 'Registro guardado correctamente.',
      lead: {
        nombre: fullName,
        telefono_whatsapp: phone,
        correo: email,
        objetivo: objective,
        etiquetas: tags,
        evento: 'EFIX 2026',
        estado_lead: 'Lead nuevo',
        contactId: saved.contact.id,
      },
    };
  }

  private assertOrigin(origin: string): void {
    const cleanOrigin = origin.trim();

    if (cleanOrigin && !ALLOWED_ORIGINS.has(cleanOrigin)) {
      throw new ForbiddenException('Origen no permitido.');
    }
  }

  private applyCors(origin: string, response: Response): void {
    const cleanOrigin = origin.trim();

    if (cleanOrigin && ALLOWED_ORIGINS.has(cleanOrigin)) {
      response.setHeader('Access-Control-Allow-Origin', cleanOrigin);
      response.setHeader('Vary', 'Origin');
    }

    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  private clean(value: unknown, max = 500): string {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().slice(0, max)
      : '';
  }

  private readBoolean(value: unknown): boolean {
    if (value === true) return true;
    if (typeof value !== 'string') return false;

    return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(
      value.trim().toLowerCase(),
    );
  }

  private normalizePhone(value: unknown): string {
    let digits = this.clean(value, 40).replace(/\D+/g, '');

    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }

    if (digits.length === 10 && digits.startsWith('3')) {
      digits = `57${digits}`;
    }

    if (digits.length < 8 || digits.length > 15) {
      return '';
    }

    return digits;
  }

  private validEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private objectiveTag(value: string): string | null {
    const normalized = value.toLowerCase();

    if (normalized.includes('oportunidades laborales')) {
      return 'QUIERE-TRABAJO';
    }
    if (normalized.includes('propio negocio')) {
      return 'QUIERE-EMPRENDER';
    }
    if (normalized.includes('negocio actual')) {
      return 'TIENE-NEGOCIO';
    }
    if (normalized.includes('nuevas habilidades')) {
      return 'QUIERE-APRENDER';
    }
    if (normalized.includes('no estoy seguro')) {
      return 'SIN-OBJETIVO-DEFINIDO';
    }

    return null;
  }

  private trainingTag(value: string): string | null {
    const normalized = value.toLowerCase();

    if (normalized.startsWith('sí') || normalized.startsWith('si')) {
      return 'CAPACITANDOSE';
    }
    if (normalized.includes('quiero empezar')) {
      return 'QUIERE-CAPACITARSE';
    }
    if (normalized === 'no') {
      return 'NO-SE-CAPACITA';
    }

    return null;
  }
}
