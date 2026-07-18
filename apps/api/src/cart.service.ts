import { Injectable } from '@nestjs/common';
import {
  ConversationMemoryService,
  type ConversationSession,
} from './conversation-memory.service';
import { ShopifyService } from './shopify.service';
import { CompanyCommerceService } from './company-commerce.service';
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

type CartLinksForSession = {
  cartUrl: string;
  checkoutUrl: string;
  lines: Array<{
    variantLegacyId: string;
    quantity: number;
  }>;
};

@Injectable()
export class CartService {
  constructor(
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly shopifyService: ShopifyService,
    private readonly companyCommerceService: CompanyCommerceService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private async refreshSession(
    session: ConversationSession,
  ): Promise<ConversationSession> {
    return this.conversationMemoryService.getSessionById(session.id);
  }

  async addSelectedVariant(
    session: ConversationSession,
    quantity: number,
  ) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('La cantidad debe ser un número entero mayor a cero.');
    }

    const currentSession = await this.refreshSession(session);
    const product = this.readSelectedProduct(currentSession.context);
    const variant = this.readSelectedVariant(currentSession.context);

    if (!product || !variant) {
      return {
        ok: false,
        error:
          'Primero debes tener un producto y una variante seleccionados.',
      };
    }

    return this.addCartLines(currentSession, [
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

    const currentSession = await this.refreshSession(session);
    const cart = this.readCart(currentSession.context).map((line) => ({
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

    const links = await this.buildCartLinksForSession(currentSession, cart);

    const updatedSession =
      await this.conversationMemoryService.updateSession(currentSession.id, {
        stage: 'sales',
        context: {
          ...currentSession.context,
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

  async replaceCartLineWithSelectedVariant(
    session: ConversationSession,
    currentVariantId: string,
    quantity: number,
  ) {
    if (!currentVariantId.trim()) {
      return {
        ok: false,
        error: 'Falta identificar el producto del carrito que se va a cambiar.',
      };
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        ok: false,
        error: 'La cantidad para el cambio debe ser un número entero mayor a cero.',
      };
    }

    const currentSession = await this.refreshSession(session);
    const selectedProduct = this.readSelectedProduct(currentSession.context);
    const selectedVariant = this.readSelectedVariant(currentSession.context);
    const cart = this.readCart(currentSession.context).map((line) => ({
      ...line,
      options: line.options.map((option) => ({ ...option })),
    }));

    if (!selectedProduct || !selectedVariant) {
      return {
        ok: false,
        error: 'Primero selecciona el producto y la variante nueva que el cliente confirmó.',
      };
    }

    const sourceIndex = cart.findIndex(
      (line) => line.variantId === currentVariantId,
    );

    if (sourceIndex < 0) {
      return {
        ok: false,
        error: 'El producto que se quiere cambiar ya no está en el carrito actual.',
      };
    }

    const source = cart[sourceIndex];

    if (source.productId !== selectedProduct.id) {
      return {
        ok: false,
        error: 'La variante nueva no corresponde al mismo producto del carrito.',
      };
    }

    if (quantity > source.quantity) {
      return {
        ok: false,
        error: 'La cantidad que se quiere cambiar es mayor a la cantidad actual del carrito.',
      };
    }

    if (source.variantId === selectedVariant.id) {
      source.quantity = quantity;
      return this.persistEditedCart(currentSession, cart);
    }

    const replacement: CartLine = {
      productId: selectedProduct.id,
      productTitle: selectedProduct.title,
      productUrl: selectedProduct.url,
      variantId: selectedVariant.id,
      variantLegacyId: selectedVariant.legacyResourceId,
      variantTitle: selectedVariant.title,
      unitPrice: selectedVariant.price,
      options: selectedVariant.options.map((option) => ({ ...option })),
      quantity,
    };

    const sameVariantIndex = cart.findIndex(
      (line, index) =>
        index !== sourceIndex && line.variantId === replacement.variantId,
    );

    if (quantity === source.quantity) {
      if (sameVariantIndex >= 0) {
        cart[sameVariantIndex].quantity += quantity;
        cart.splice(sourceIndex, 1);
      } else {
        cart[sourceIndex] = replacement;
      }
    } else {
      source.quantity -= quantity;

      if (sameVariantIndex >= 0) {
        cart[sameVariantIndex].quantity += quantity;
      } else {
        cart.push(replacement);
      }
    }

    return this.persistEditedCart(currentSession, cart);
  }

  async setCartLineQuantity(
    session: ConversationSession,
    variantId: string,
    quantity: number,
  ) {
    if (!variantId.trim()) {
      return {
        ok: false,
        error: 'Falta identificar el producto del carrito.',
      };
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        ok: false,
        error: 'La cantidad debe ser un número entero mayor a cero.',
      };
    }

    const currentSession = await this.refreshSession(session);
    const cart = this.readCart(currentSession.context).map((line) => ({
      ...line,
      options: line.options.map((option) => ({ ...option })),
    }));

    const line = cart.find((item) => item.variantId === variantId);

    if (!line) {
      return {
        ok: false,
        error: 'El producto ya no está en el carrito actual.',
      };
    }

    line.quantity = quantity;

    return this.persistEditedCart(currentSession, cart);
  }

  async removeCartLine(
    session: ConversationSession,
    variantId: string,
  ) {
    if (!variantId.trim()) {
      return {
        ok: false,
        error: 'Falta identificar el producto del carrito.',
      };
    }

    const currentSession = await this.refreshSession(session);
    const current = this.readCart(currentSession.context);
    const cart = current
      .filter((line) => line.variantId !== variantId)
      .map((line) => ({
        ...line,
        options: line.options.map((option) => ({ ...option })),
      }));

    if (cart.length === current.length) {
      return {
        ok: false,
        error: 'El producto ya no está en el carrito actual.',
      };
    }

    return this.persistEditedCart(currentSession, cart);
  }

  async getCart(session: ConversationSession) {
    const currentSession = await this.refreshSession(session);
    const cart = this.readCart(currentSession.context);

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
    // El checkout debe usar el carrito persistido más reciente, no una copia
    // anterior que pudo existir antes de agregar o cambiar una variante.
    const currentSession = await this.refreshSession(session);
    const cart = this.readCart(currentSession.context);

    if (!cart.length) {
      return {
        ok: false,
        error: 'El carrito está vacío.',
      };
    }

    const requestedLines = cart.map((line) => ({
      variantLegacyId: line.variantLegacyId,
      quantity: line.quantity,
    }));

    const links = await this.buildCartLinksForSession(
      currentSession,
      cart,
    );

    const expected = new Map(
      requestedLines.map((line) => [
        line.variantLegacyId,
        line.quantity,
      ]),
    );
    const generated = new Map(
      links.lines.map((line) => [
        line.variantLegacyId,
        line.quantity,
      ]),
    );

    const matchesCart =
      expected.size === generated.size &&
      Array.from(expected.entries()).every(
        ([variantLegacyId, quantity]) =>
          generated.get(variantLegacyId) === quantity,
      );

    if (!matchesCart) {
      return {
        ok: false,
        error:
          'No se pudo confirmar que el enlace contiene todos los productos actuales del carrito.',
      };
    }

    const updatedSession =
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'checkout',
        context: {
          ...currentSession.context,
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
      checkout_url: links.checkoutUrl,
      checkout_purpose: 'payment',
    };
  }

  private async persistEditedCart(
    session: ConversationSession,
    cart: CartLine[],
  ) {
    const links = cart.length
      ? await this.buildCartLinksForSession(session, cart)
      : null;

    const updatedSession =
      await this.conversationMemoryService.updateSession(session.id, {
        stage: 'sales',
        context: {
          ...session.context,
          cart,
          lastCartUrl: links?.cartUrl ?? null,
          lastCheckoutUrl: links?.checkoutUrl ?? null,
          lastCartUpdatedAt: new Date().toISOString(),
        },
      });

    await this.syncRecoveryCart(
      updatedSession,
      cart,
      'active',
      links?.checkoutUrl ?? null,
    );

    return {
      ok: true,
      cart: this.cartSummary(cart),
      cart_url: links?.cartUrl ?? null,
      checkout_url: links?.checkoutUrl ?? null,
    };
  }

  private async buildCartLinksForSession(
    session: ConversationSession,
    cart: CartLine[],
  ): Promise<CartLinksForSession> {
    if (await this.companyCommerceService.isEnabled(session.companyId)) {
      const links = await this.companyCommerceService.createCheckoutLink(
        session.companyId,
        cart.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
        })),
      );

      return {
        cartUrl: links.cartUrl,
        checkoutUrl: links.checkoutUrl,
        lines: links.lines.map((line) => ({
          variantLegacyId: line.variantLegacyId,
          quantity: line.quantity,
        })),
      };
    }

    return this.shopifyService.buildCartLinks(
      cart.map((line) => ({
        variantLegacyId: line.variantLegacyId,
        quantity: line.quantity,
      })),
    );
  }

  private async syncRecoveryCart(
    session: ConversationSession,
    cart: CartLine[],
    state: 'active' | 'checkout_sent',
    checkoutUrl: string | null,
  ) {
    const now = new Date().toISOString();
    const client = this.supabaseService.getClient();
    const recoveryCartId = this.readRecoveryCartId(session.context);
    const recoveryCurrency = this.readRecoveryCurrency(session.context);

    try {
      const payload = {
        company_id: session.companyId,
        session_id: session.id,
        customer_phone: session.customerPhone,
        cart_snapshot: this.cartRecoverySnapshot(cart, recoveryCurrency),
        cart_state: state,
        checkout_url: checkoutUrl,
        checkout_created_at: checkoutUrl ? now : null,
        last_activity_at: now,
        updated_at: now,
      };

      if (recoveryCartId) {
        const { data: recoveredCart, error: recoveryUpdateError } =
          await client
            .from('abandoned_carts')
            .update(payload)
            .eq('id', recoveryCartId)
            .eq('company_id', session.companyId)
            .select('id')
            .maybeSingle();

        if (recoveryUpdateError) {
          throw new Error(recoveryUpdateError.message);
        }

        if (recoveredCart?.id) {
          return;
        }
      }

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

  private readRecoveryCartId(context: JsonObject): string | null {
    const value = context.cart_recovery;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const cartId = (value as Record<string, unknown>).cart_id;

    return typeof cartId === 'string' && cartId.trim()
      ? cartId.trim()
      : null;
  }

  private readRecoveryCurrency(context: JsonObject): string | null {
    const value = context.cart_recovery;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const cart = (value as Record<string, unknown>).cart;

    if (!cart || typeof cart !== 'object' || Array.isArray(cart)) {
      return null;
    }

    const currency = (cart as Record<string, unknown>).currency;

    return typeof currency === 'string' && currency.trim()
      ? currency.trim()
      : null;
  }

  private cartRecoverySnapshot(
    cart: CartLine[],
    currency: string | null,
  ) {
    const summary = this.cartSummary(cart);

    return {
      ...summary,
      total_amount: summary.products_total_cop,
      currency,
      lines: cart.map((line) => ({
        product_id: line.productId,
        product_title: line.productTitle,
        product_url: line.productUrl,
        variant_id: line.variantId,
        variant_legacy_id: line.variantLegacyId,
        variant_title: line.variantTitle,
        options: line.options.map((option) => ({ ...option })),
        quantity: line.quantity,
        unit_price: line.unitPrice,
        currency,
      })),
    };
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
