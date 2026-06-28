import { Injectable } from '@nestjs/common';
import {
  ConversationMemoryService,
  type ConversationSession,
} from './conversation-memory.service';
import { ShopifyService } from './shopify.service';
import { SupabaseService } from './supabase.service';

type JsonObject = Record<string, unknown>;

type ProductOption = {
  name: string;
  value: string;
};

type SelectedProduct = {
  id: string;
  handle: string;
  title: string;
  url: string;
};

type SelectedVariant = {
  id: string;
  legacyResourceId: string;
  title: string;
  price: string;
  options: ProductOption[];
};

export type CartLine = {
  productId: string;
  productTitle: string;
  productUrl: string;
  variantId: string;
  variantLegacyId: string;
  variantTitle: string;
  unitPrice: string;
  options: ProductOption[];
  quantity: number;
};

@Injectable()
export class CartService {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly shopifyService: ShopifyService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async addSelectedVariant(
    session: ConversationSession,
    quantity: number,
  ) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('La cantidad debe ser un número entero mayor a cero.');
    }

    const product = this.readSelectedProduct(session.context);
    const variant = this.readSelectedVariant(session.context);

    if (!product || !variant) {
      return {
        ok: false,
        error:
          'Primero debes tener un producto y una variante seleccionados.',
      };
    }

    return this.addCartLines(session, [
      {
        productId: product.id,
        productTitle: product.title,
        productUrl: product.url,
        variantId: variant.id,
        variantLegacyId: variant.legacyResourceId,
        variantTitle: variant.title,
        unitPrice: variant.price,
        options: variant.options,
        quantity,
      },
    ]);
  }

  async addCartLines(
    session: ConversationSession,
    linesToAdd: CartLine[],
  ) {
    if (!Array.isArray(linesToAdd) || !linesToAdd.length) {
      return {
        ok: false,
        error: 'No hay productos válidos para agregar al carrito.',
      };
    }

    const cart = this.readCart(session.context).map((line) => ({
      ...line,
      options: line.options.map((option) => ({ ...option })),
    }));

    for (const candidate of linesToAdd) {
      if (
        !candidate ||
        typeof candidate.productId !== 'string' ||
        typeof candidate.productTitle !== 'string' ||
        typeof candidate.productUrl !== 'string' ||
        typeof candidate.variantId !== 'string' ||
        typeof candidate.variantLegacyId !== 'string' ||
        typeof candidate.variantTitle !== 'string' ||
        typeof candidate.unitPrice !== 'string' ||
        !Array.isArray(candidate.options) ||
        !Number.isInteger(candidate.quantity) ||
        candidate.quantity < 1
      ) {
        return {
          ok: false,
          error: 'Una de las variantes no tiene información válida.',
        };
      }

      const existingLine = cart.find(
        (line) => line.variantId === candidate.variantId,
      );

      if (existingLine) {
        existingLine.quantity += candidate.quantity;
      } else {
        cart.push({
          ...candidate,
          options: candidate.options.map((option) => ({ ...option })),
        });
      }
    }

    const links = await this.shopifyService.buildCartLinks(
      cart.map((line) => ({
        variantLegacyId: line.variantLegacyId,
        quantity: line.quantity,
      })),
    );

    const updatedSession =
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: {
          ...session.context,
          cart,
          lastCartUrl: links.cartUrl,
          lastCheckoutUrl: links.checkoutUrl,
          lastCartUpdatedAt: new Date().toISOString(),
        },
      });

    await this.syncRecoveryCart(
      updatedSession,
      cart,
      'active',
      links.checkoutUrl,
    );

    return {
      ok: true,
      cart: this.cartSummary(cart),
      cart_url: links.cartUrl,
      checkout_url: links.checkoutUrl,
    };
  }

  async getCart(session: ConversationSession) {
    const cart = this.readCart(session.context);

    if (!cart.length) {
      return {
        ok: false,
        error: 'El carrito está vacío.',
      };
    }

    return {
      ok: true,
      cart: this.cartSummary(cart),
    };
  }

  async createCheckoutLink(session: ConversationSession) {
    const cart = this.readCart(session.context);

    if (!cart.length) {
      return {
        ok: false,
        error: 'El carrito está vacío.',
      };
    }

    const links = await this.shopifyService.buildCartLinks(
      cart.map((line) => ({
        variantLegacyId: line.variantLegacyId,
        quantity: line.quantity,
      })),
    );

    const updatedSession =
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'checkout',
        context: {
          ...session.context,
          lastCartUrl: links.cartUrl,
          lastCheckoutUrl: links.checkoutUrl,
          checkoutCreatedAt: new Date().toISOString(),
        },
      });

    await this.syncRecoveryCart(
      updatedSession,
      cart,
      'checkout_sent',
      links.checkoutUrl,
    );

    return {
      ok: true,
      cart: this.cartSummary(cart),
      cart_url: links.cartUrl,
      checkout_url: links.checkoutUrl,
    };
  }

  private async syncRecoveryCart(
    session: ConversationSession,
    cart: CartLine[],
    state: 'active' | 'checkout_sent',
    checkoutUrl: string | null,
  ) {
    const now = new Date().toISOString();
    const client = this.supabaseService.getClient();

    try {
      const { data: existingCart, error: findError } = await client
        .from('abandoned_carts')
        .select('id')
        .eq('company_id', session.companyId)
        .eq('session_id', session.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (findError) {
        throw new Error(findError.message);
      }

      const payload = {
        company_id: session.companyId,
        session_id: session.id,
        customer_phone: session.customerPhone,
        cart_snapshot: this.cartSummary(cart),
        cart_state: state,
        checkout_url: checkoutUrl,
        checkout_created_at: checkoutUrl ? now : null,
        last_activity_at: now,
        updated_at: now,
      };

      const { error } = existingCart
        ? await client
            .from('abandoned_carts')
            .update(payload)
            .eq('id', existingCart.id)
        : await client.from('abandoned_carts').insert(payload);

      if (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      console.error(
        'No se pudo sincronizar el carrito para recuperación:',
        error,
      );
    }
  }

  private cartSummary(cart: CartLine[]) {
    const itemsTotal = cart.reduce(
      (total, line) =>
        total + Number(line.unitPrice || 0) * line.quantity,
      0,
    );

    return {
      items_count: cart.reduce(
        (total, line) => total + line.quantity,
        0,
      ),
      products_total_cop: String(itemsTotal),
      lines: cart.map((line) => ({
        product_title: line.productTitle,
        variant_title: line.variantTitle,
        options: line.options,
        quantity: line.quantity,
        unit_price_cop: line.unitPrice,
        line_total_cop: String(
          Number(line.unitPrice || 0) * line.quantity,
        ),
      })),
    };
  }

  private readSelectedProduct(
    context: JsonObject,
  ): SelectedProduct | null {
    const value = context.selectedProduct;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const product = value as Record<string, unknown>;

    if (
      typeof product.id !== 'string' ||
      typeof product.handle !== 'string' ||
      typeof product.title !== 'string' ||
      typeof product.url !== 'string'
    ) {
      return null;
    }

    return {
      id: product.id,
      handle: product.handle,
      title: product.title,
      url: product.url,
    };
  }

  private readSelectedVariant(
    context: JsonObject,
  ): SelectedVariant | null {
    const value = context.selectedVariant;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const variant = value as Record<string, unknown>;

    if (
      typeof variant.id !== 'string' ||
      typeof variant.legacyResourceId !== 'string' ||
      typeof variant.title !== 'string' ||
      typeof variant.price !== 'string' ||
      !Array.isArray(variant.options)
    ) {
      return null;
    }

    const options = variant.options.filter(
      (option): option is ProductOption => {
        if (
          !option ||
          typeof option !== 'object' ||
          Array.isArray(option)
        ) {
          return false;
        }

        const item = option as Record<string, unknown>;

        return (
          typeof item.name === 'string' &&
          typeof item.value === 'string'
        );
      },
    );

    return {
      id: variant.id,
      legacyResourceId: variant.legacyResourceId,
      title: variant.title,
      price: variant.price,
      options,
    };
  }

  private readCart(context: JsonObject): CartLine[] {
    const value = context.cart;

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((line): line is CartLine => {
      if (
        !line ||
        typeof line !== 'object' ||
        Array.isArray(line)
      ) {
        return false;
      }

      const item = line as Record<string, unknown>;

      return (
        typeof item.productId === 'string' &&
        typeof item.productTitle === 'string' &&
        typeof item.productUrl === 'string' &&
        typeof item.variantId === 'string' &&
        typeof item.variantLegacyId === 'string' &&
        typeof item.variantTitle === 'string' &&
        typeof item.unitPrice === 'string' &&
        Array.isArray(item.options) &&
        Number.isInteger(item.quantity) &&
        Number(item.quantity) > 0
      );
    });
  }
}