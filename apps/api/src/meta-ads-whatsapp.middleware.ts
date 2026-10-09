import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetaAdsLeadService } from './meta-ads-lead.service';

@Injectable()
export class MetaAdsWhatsappMiddleware implements NestMiddleware {
  constructor(
    private readonly metaAdsLeadService: MetaAdsLeadService,
  ) {}

  async use(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.metaAdsLeadService.processWhatsappWebhook(request.body);
    } catch (error) {
      console.error(
        '[ChatPro][MetaAds] No se pudo capturar el origen del anuncio de WhatsApp:',
        error,
      );
    }

    next();
  }
}
