import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ShopifyService } from './shopify.service';

type RequestedAttribute = {
  name: string;
  value: string;
};

type SalesSearchCriteria = {
  catalogQuery: string;
  attributes: RequestedAttribute[];
};

type CatalogProduct = Awaited<
  ReturnType<ShopifyService['searchCatalog']>
>[number];

type CatalogVariant =
  CatalogProduct['variants']['edges'][number]['node'];

type StoreCollection = Awaited<
  ReturnType<ShopifyService['getCollections']>
>[number];

type ProductCandidate = {
  product: CatalogProduct;
  variant: CatalogVariant;
};

type SalesCatalogItem = {
  productId: string;
  productTitle: string;
  productUrl: string;
  imageUrl: string | null;
  price: string;
  matchingVariant: {
    id: string;
    title: string;
    options: Array<{
      name: string;
      value: string;
    }>;
  };
};

type SalesCatalogResult = {
  criteria: SalesSearchCriteria;
  products: SalesCatalogItem[];
};

type CatalogRoute = {
  kind: 'collection' | 'products';
  collection: StoreCollection | null;
};

type CollectionSelection = {
  mode: 'collection' | 'products';
  collectionId: string | null;
};

@Injectable()
export class AiService {
  private client: OpenAI | null = null;

  constructor(private readonly shopifyService: ShopifyService) {}

  async answerSalesQuestion(message: string): Promise<string> {
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return 'Cuéntame qué producto estás buscando.';
    }

    const route = await this.resolveCatalogRequest(cleanMessage);

    if (route.kind === 'collection' && route.collection) {
      return [
        `Te comparto el catálogo de ${route.collection.title}.`,
        'Revísalo y dime cuál producto te gustó para mostrarte sus opciones disponibles.',
        route.collection.onlineStoreUrl,
      ].join('\n\n');
    }

    const catalog = await this.getSalesCatalog(cleanMessage);

    if (!catalog.products.length) {
      return 'No encontré opciones que coincidan exactamente. Cuéntame otra característica del producto que buscas.';
    }

    const options = catalog.products.map((item, index) => {
      const variantDetails = item.matchingVariant.options
        .map((option) => `${option.name}: ${option.value}`)
        .join(' · ');

      return [
        `${index + 1}. ${item.productTitle}`,
        this.formatPrice(item.price),
        variantDetails,
        item.productUrl,
      ].join('\n');
    });

    return [
      'Encontré estas opciones para ti:',
      '',
      options.join('\n\n'),
      '',
      'Dime cuál te gustó y te muestro sus opciones disponibles.',
    ].join('\n');
  }

  async resolveCatalogRequest(message: string): Promise<CatalogRoute> {
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return {
        kind: 'products',
        collection: null,
      };
    }

    const collections = await this.shopifyService.getCollections();

    if (!collections.length) {
      return {
        kind: 'products',
        collection: null,
      };
    }

    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: [
        'Clasifica el mensaje de una persona que escribe a cualquier comercio.',
        'Debes decidir si quiere explorar una categoría amplia o si busca un producto específico.',
        'Usa mode "collection" cuando pida ver, mirar, conocer o explorar una categoría o catálogo completo.',
        'Usa mode "products" cuando mencione un producto específico, una referencia, características concretas o quiera validar una opción.',
        'Solo puedes elegir una colección incluida en COLECCIONES_REALES.',
        'No inventes colecciones, enlaces, productos, promociones ni equivalencias.',
        'Devuelve únicamente JSON válido con esta estructura:',
        '{"mode":"collection"|"products","collectionId":"id real o null"}',
      ].join('\n'),
      input: JSON.stringify({
        mensaje_cliente: cleanMessage,
        COLECCIONES_REALES: collections.map((collection) => ({
          id: collection.id,
          title: collection.title,
          url: collection.onlineStoreUrl,
        })),
      }),
    });

    const selection = this.parseCollectionSelection(response.output_text);

    const selectedCollectionId = selection.collectionId;

    if (selection.mode !== 'collection' || !selectedCollectionId) {
      return {
        kind: 'products',
        collection: null,
      };
    }

    const collection =
      collections.find((item) => item.id === selectedCollectionId) ?? null;

    if (!collection) {
      return {
        kind: 'products',
        collection: null,
      };
    }

    return {
      kind: 'collection',
      collection,
    };
  }

  async getSalesCatalog(message: string): Promise<SalesCatalogResult> {
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return {
        criteria: {
          catalogQuery: '',
          attributes: [],
        },
        products: [],
      };
    }

    const criteria = await this.extractSearchCriteria(cleanMessage);

    const products = await this.shopifyService.searchCatalog(
      criteria.catalogQuery,
      10,
    );

    const candidates = this.findCatalogCandidates(products, criteria);

    return {
      criteria,
      products: candidates.map(({ product, variant }) => ({
        productId: product.id,
        productTitle: product.title,
        productUrl: product.onlineStoreUrl ?? '',
        imageUrl: product.featuredImage?.url ?? null,
        price: variant.price,
        matchingVariant: {
          id: variant.id,
          title: variant.title,
          options: variant.selectedOptions.map((option) => ({
            name: option.name,
            value: option.value,
          })),
        },
      })),
    };
  }

  private async extractSearchCriteria(
    message: string,
  ): Promise<SalesSearchCriteria> {
    const response = await this.getClient().responses.create({
      model: this.getModel(),
      instructions: [
        'Analiza el mensaje de una persona que busca productos en cualquier comercio.',
        'Comprende errores de escritura, abreviaturas y palabras pegadas.',
        'No respondas a la persona.',
        'No inventes productos, equivalencias, promociones ni atributos.',
        'Devuelve únicamente JSON válido con esta estructura:',
        '{"catalogQuery":"palabras para buscar","attributes":[{"name":"atributo","value":"valor"}]}',
        'attributes solo debe incluir condiciones que la persona escribió explícitamente.',
      ].join('\n'),
      input: message,
    });

    return this.parseCriteria(response.output_text, message);
  }

  private findCatalogCandidates(
    products: CatalogProduct[],
    criteria: SalesSearchCriteria,
  ): ProductCandidate[] {
    const candidates: ProductCandidate[] = [];

    for (const product of products) {
      const matchingVariant = product.variants.edges
        .map(({ node }) => node)
        .find(
          (variant) =>
            variant.availableForSale &&
            this.variantMatchesCriteria(variant, criteria),
        );

      if (matchingVariant) {
        candidates.push({
          product,
          variant: matchingVariant,
        });
      }
    }

    return candidates.slice(0, 8);
  }

  private variantMatchesCriteria(
    variant: CatalogVariant,
    criteria: SalesSearchCriteria,
  ): boolean {
    return criteria.attributes.every((attribute) =>
      variant.selectedOptions.some((option) =>
        this.sameOptionValue(option.value, attribute.value),
      ),
    );
  }

  private parseCollectionSelection(outputText: string): CollectionSelection {
    const cleanText = this.cleanJsonResponse(outputText);

    try {
      const parsed = JSON.parse(cleanText) as Partial<CollectionSelection>;

      if (
        parsed.mode === 'collection' &&
        typeof parsed.collectionId === 'string' &&
        parsed.collectionId.trim()
      ) {
        return {
          mode: 'collection',
          collectionId: parsed.collectionId.trim(),
        };
      }
    } catch {
      return {
        mode: 'products',
        collectionId: null,
      };
    }

    return {
      mode: 'products',
      collectionId: null,
    };
  }

  private parseCriteria(
    outputText: string,
    originalMessage: string,
  ): SalesSearchCriteria {
    const cleanText = this.cleanJsonResponse(outputText);

    try {
      const parsed = JSON.parse(cleanText) as Partial<SalesSearchCriteria>;

      const catalogQuery =
        typeof parsed.catalogQuery === 'string' &&
        parsed.catalogQuery.trim()
          ? parsed.catalogQuery.trim().slice(0, 100)
          : originalMessage.slice(0, 100);

      const attributes = Array.isArray(parsed.attributes)
        ? parsed.attributes
            .filter(
              (attribute): attribute is RequestedAttribute =>
                typeof attribute?.name === 'string' &&
                typeof attribute?.value === 'string' &&
                attribute.name.trim().length > 0 &&
                attribute.value.trim().length > 0,
            )
            .map((attribute) => ({
              name: attribute.name.trim().slice(0, 50),
              value: attribute.value.trim().slice(0, 80),
            }))
        : [];

      return {
        catalogQuery,
        attributes,
      };
    } catch {
      return {
        catalogQuery: originalMessage.slice(0, 100),
        attributes: [],
      };
    }
  }

  private cleanJsonResponse(outputText: string): string {
    return outputText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
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

  private formatPrice(price: string): string {
    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice)) {
      return price;
    }

    return `$${numericPrice.toLocaleString('es-CO', {
      maximumFractionDigits: 0,
    })}`;
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