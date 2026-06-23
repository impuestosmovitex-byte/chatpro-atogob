import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ShopifyService } from './shopify.service';

@Injectable()
export class AiService {
  private client: OpenAI | null = null;

  constructor(private readonly shopifyService: ShopifyService) {}

  async answerSalesQuestion(message: string): Promise<string> {
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return 'Cuéntame qué prenda, color, talla o estilo estás buscando.';
    }

    const catalogQuery = await this.createCatalogQuery(cleanMessage);

    const products = await this.shopifyService.searchCatalog(
      catalogQuery,
      3,
    );

    if (!products.length) {
      return 'No encontré una opción exacta en este momento. Cuéntame qué prenda, color, talla o estilo buscas y la reviso contigo.';
    }

    const options = products.map((product, index) => {
      const firstVariant = product.variants.edges[0]?.node;

      const price = firstVariant
        ? `$${Number(firstVariant.price).toLocaleString('es-CO', {
            maximumFractionDigits: 0,
          })}`
        : 'Precio por confirmar';

      const variant = firstVariant?.title
        ? `\nReferencia: ${firstVariant.title}`
        : '';

      const url = product.onlineStoreUrl ?? '';

      return `${index + 1}. ${product.title}\n${price}${variant}\n${url}`;
    });

    return [
      'Encontré estas opciones para ti ✨',
      '',
      options.join('\n\n'),
      '',
      '¿Cuál te gustó más? También dime tu talla o color para orientarte mejor.',
    ].join('\n');
  }

  private async createCatalogQuery(message: string): Promise<string> {
    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions:
        'Convierte el mensaje de una cliente de moda en una búsqueda corta para catálogo. Devuelve únicamente palabras útiles de producto, color, estilo o categoría. No escribas explicaciones, saludos, listas ni signos.',
      input: message,
    });

    const query = response.output_text
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    return query || message.slice(0, 80) || 'ropa mujer';
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error('Falta la variable OPENAI_API_KEY en Railway.');
    }

    this.client = new OpenAI({ apiKey });

    return this.client;
  }

  private getModel(): string {
    return process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';
  }
}