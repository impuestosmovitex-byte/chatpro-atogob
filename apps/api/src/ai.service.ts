import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ShopifyService } from './shopify.service';

type SalesSearchCriteria = {
  catalogQuery: string;
  size: string | null;
  color: string | null;
};

type CatalogProduct = Awaited<
  ReturnType<ShopifyService['searchCatalog']>
>[number];

type CatalogVariant =
  CatalogProduct['variants']['edges'][number]['node'];

type ProductCandidate = {
  product: CatalogProduct;
  variant: CatalogVariant;
};

@Injectable()
export class AiService {
  private client: OpenAI | null = null;

  constructor(private readonly shopifyService: ShopifyService) {}

  async answerSalesQuestion(message: string): Promise<string> {
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return 'Cuéntame qué prenda, color, talla o estilo estás buscando.';
    }

    const criteria = await this.extractSearchCriteria(cleanMessage);

    const products = await this.shopifyService.searchCatalog(
      criteria.catalogQuery,
      10,
    );

    const matches = this.findAvailableMatches(products, criteria);

    return this.createSalesReply(cleanMessage, criteria, matches);
  }

  private async extractSearchCriteria(
    message: string,
  ): Promise<SalesSearchCriteria> {
    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: [
        'Eres un extractor de criterios para una tienda de moda.',
        'Entiende errores de escritura, abreviaturas y palabras pegadas.',
        'No inventes equivalencias de talla ni conviertas números a letras.',
        'Devuelve exactamente tres líneas, sin explicaciones:',
        'QUERY: palabras útiles para buscar el producto',
        'SIZE: valor de talla solicitado o NONE',
        'COLOR: color solicitado o NONE',
      ].join('\n'),
      input: message,
    });

    return this.parseCriteria(response.output_text, message);
  }

  private findAvailableMatches(
    products: CatalogProduct[],
    criteria: SalesSearchCriteria,
  ): ProductCandidate[] {
    const matches: ProductCandidate[] = [];

    for (const product of products) {
      const matchingVariant = product.variants.edges
        .map(({ node }) => node)
        .find(
          (variant) =>
            variant.availableForSale &&
            variant.sellableOnlineQuantity > 0 &&
            this.variantMatchesCriteria(variant, criteria),
        );

      if (matchingVariant) {
        matches.push({
          product,
          variant: matchingVariant,
        });
      }
    }

    return matches.slice(0, 3);
  }

  private variantMatchesCriteria(
    variant: CatalogVariant,
    criteria: SalesSearchCriteria,
  ): boolean {
    const requestedSize = criteria.size;

    if (
      requestedSize &&
      !this.hasMatchingOption(variant, 'size', requestedSize)
    ) {
      return false;
    }

    const requestedColor = criteria.color;

    if (
      requestedColor &&
      !this.hasMatchingOption(variant, 'color', requestedColor)
    ) {
      return false;
    }

    return true;
  }

  private hasMatchingOption(
    variant: CatalogVariant,
    type: 'size' | 'color',
    requestedValue: string,
  ): boolean {
    const acceptedOptionNames =
      type === 'size'
        ? ['talla', 'tamano', 'size']
        : ['color', 'colour'];

    return variant.selectedOptions.some((option) => {
      const optionName = this.normalizeText(option.name);

      const correctOptionType = acceptedOptionNames.some((name) =>
        optionName.includes(name),
      );

      return (
        correctOptionType &&
        this.sameOptionValue(option.value, requestedValue)
      );
    });
  }

  private async createSalesReply(
    originalMessage: string,
    criteria: SalesSearchCriteria,
    matches: ProductCandidate[],
  ): Promise<string> {
    const verifiedOptions = matches.map(({ product, variant }) => ({
      product_name: product.title,
      price_cop: Number(variant.price),
      product_url: product.onlineStoreUrl ?? '',
      variant_options: variant.selectedOptions.map((option) => ({
        name: option.name,
        value: option.value,
      })),
    }));

    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: [
        'Eres Daniela, asesora virtual de ventas de ATOGOB.',
        'Responde en español colombiano, con tono cercano, breve y útil.',
        'Solo puedes mencionar productos, precios, tallas, colores y enlaces presentes en DATOS_VERIFICADOS.',
        'No inventes descuentos, promociones, cuotas, envíos, existencias, tiempos, políticas ni referencias.',
        'Los productos recibidos ya fueron validados por el sistema como disponibles.',
        'No menciones cantidades de inventario.',
        'Si DATOS_VERIFICADOS está vacío, indica que no encontraste una opción disponible con los criterios solicitados y pregunta si desea ver otra talla, color o estilo.',
        'Recomienda máximo tres opciones.',
        'No hables de Shopify, OpenAI, código, herramientas ni procesos internos.',
      ].join('\n'),
      input: JSON.stringify({
        mensaje_cliente: originalMessage,
        criterios_entendidos: criteria,
        DATOS_VERIFICADOS: verifiedOptions,
      }),
    });

    const reply = response.output_text.trim();

    if (reply) {
      return reply;
    }

    return this.getFallbackReply(criteria, verifiedOptions.length);
  }

  private parseCriteria(
    outputText: string,
    originalMessage: string,
  ): SalesSearchCriteria {
    const readLine = (label: string): string | null => {
      const match = outputText.match(
        new RegExp(`^${label}:\\s*(.+)$`, 'im'),
      );

      return match?.[1]?.trim() ?? null;
    };

    const query =
      this.cleanExtractedValue(readLine('QUERY')) ??
      originalMessage.slice(0, 80);

    return {
      catalogQuery: query,
      size: this.cleanExtractedValue(readLine('SIZE')),
      color: this.cleanExtractedValue(readLine('COLOR')),
    };
  }

  private cleanExtractedValue(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const cleanValue = value.trim();

    if (
      ['NONE', 'NINGUNO', 'NINGUNA', 'N/A', 'NULL', 'NO'].includes(
        cleanValue.toUpperCase(),
      )
    ) {
      return null;
    }

    return cleanValue;
  }

  private sameOptionValue(firstValue: string, secondValue: string): boolean {
    return this.normalizeText(firstValue) === this.normalizeText(secondValue);
  }

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase('es-CO')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private getFallbackReply(
    criteria: SalesSearchCriteria,
    resultCount: number,
  ): string {
    if (resultCount > 0) {
      return 'Encontré opciones disponibles para ti. ¿Quieres que te ayude con otro color, talla o estilo?';
    }

    const details = [
      criteria.size ? `talla ${criteria.size}` : '',
      criteria.color ? `color ${criteria.color}` : '',
    ]
      .filter(Boolean)
      .join(' y ');

    if (details) {
      return `No encontré una opción disponible con ${details}. ¿Quieres que revise otras alternativas?`;
    }

    return 'No encontré una opción disponible en este momento. Cuéntame qué prenda, color, talla o estilo buscas.';
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