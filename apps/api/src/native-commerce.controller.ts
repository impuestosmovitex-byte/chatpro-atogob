import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';

type AdvanceOrderBody = { expectedStatus?: unknown; nextStatus?: unknown };
type AuthorizedCompany = { id: string; name: string; slug: string };

@Controller('native-commerce')
export class NativeCommerceController {
  constructor(private readonly supabase: SupabaseService) {}

  private async authorize(
    internalKey: string,
    companyId: string,
    userId: string,
  ): Promise<AuthorizedCompany> {
    const secret = process.env.CHATPRO_INBOX_KEY?.trim();
    if (!secret || internalKey !== secret) {
      throw new UnauthorizedException('No autorizado.');
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(companyId) || !uuidPattern.test(userId)) {
      throw new UnauthorizedException('Se requiere iniciar sesión.');
    }

    const db = this.supabase.getClient();
    const [companyResult, membershipResult, profileResult, entitlementResult] =
      await Promise.all([
        db.from('companies').select('id,name,slug,status').eq('id', companyId).maybeSingle(),
        db.from('company_memberships').select('role_id,active')
          .eq('company_id', companyId).eq('user_id', userId).maybeSingle(),
        db.from('app_profiles').select('active').eq('user_id', userId).maybeSingle(),
        db.from('company_entitlements').select('commerce_enabled,native_orders_enabled')
          .eq('company_id', companyId).maybeSingle(),
      ]);

    if (companyResult.error || membershipResult.error ||
        profileResult.error || entitlementResult.error) {
      throw new BadRequestException('No se pudieron validar los permisos.');
    }

    if (!companyResult.data || companyResult.data.status !== 'active' ||
        !membershipResult.data?.active || !profileResult.data?.active) {
      throw new ForbiddenException('No tienes acceso activo a esta empresa.');
    }
    if (!entitlementResult.data?.commerce_enabled ||
        !entitlementResult.data?.native_orders_enabled) {
      throw new ForbiddenException('El módulo de pedidos no está incluido en este plan.');
    }

    const { data: role, error: roleError } = await db.from('app_roles')
      .select('key,company_id').eq('id', membershipResult.data.role_id).maybeSingle();
    if (roleError || !role || !['owner', 'admin'].includes(role.key) ||
        (role.company_id && role.company_id !== companyId)) {
      throw new ForbiddenException('Solo el propietario o un administrador puede operar pedidos.');
    }
    return {
      id: companyResult.data.id,
      name: companyResult.data.name,
      slug: companyResult.data.slug,
    };
  }

  @Get('access')
  async access(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Headers('x-chatpro-user-id') userId = '',
  ) {
    const company = await this.authorize(key, companyId, userId);
    return { ok: true, enabled: true, company: { name: company.name } };
  }

  @Get('orders')
  async orders(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Query('status') status = '',
  ) {
    const company = await this.authorize(key, companyId, userId);
    const validStatuses = [
      'pending_confirmation', 'confirmed', 'preparing', 'ready',
      'dispatched', 'delivered', 'cancelled',
    ];
    const selected = status.trim();
    if (selected && !validStatuses.includes(selected)) {
      throw new BadRequestException('Estado de pedido no válido.');
    }

    let query = this.supabase.getClient().from('commerce_orders')
      .select('id,order_code,channel,status,payment_status,currency,grand_total,created_at,updated_at')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (selected) query = query.eq('status', selected);

    const { data, error } = await query;
    if (error) throw new BadRequestException('No se pudieron consultar los pedidos.');
    return { ok: true, company: { name: company.name }, orders: data ?? [] };
  }

  @Get('products')
  async products(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Headers('x-chatpro-user-id') userId = '',
  ) {
    const company = await this.authorize(key, companyId, userId);
    const { data, error } = await this.supabase.getClient().from('commerce_products')
      .select('id,name,sku,base_price,currency,available,published,source_id')
      .eq('company_id', company.id)
      .order('name')
      .limit(100);
    if (error) throw new BadRequestException('No se pudo cargar el catálogo.');
    return { ok: true, products: data ?? [] };
  }

  @Post('products')
  async createProduct(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Body() body: Record<string, unknown> = {},
  ) {
    const company = await this.authorize(key, companyId, userId);
    const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const price = body.price;
    const stock = body.stock ?? null;
    if (!sku || !name || typeof price !== 'number' || !Number.isFinite(price) ||
        (stock !== null && (typeof stock !== 'number' || !Number.isFinite(stock)))) {
      throw new BadRequestException('Debes indicar nombre, SKU y precio válidos.');
    }
    const { data, error } = await this.supabase.getClient()
      .rpc('mw1_commerce_create_manual_product', {
        p_company_id: company.id,
        p_actor_user_id: userId,
        p_sku: sku,
        p_name: name,
        p_price: price,
        p_stock: stock,
      });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Get('orders/:orderId')
  async detail(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Param('orderId') orderId = '',
  ) {
    const company = await this.authorize(key, companyId, userId);
    const db = this.supabase.getClient();
    const { data: order, error: orderError } = await db.from('commerce_orders')
      .select('id,order_code,status,payment_status,currency,subtotal,delivery_fee,discount_total,grand_total,customer_snapshot,delivery_address,scheduled_for,customer_note,staff_note,created_at')
      .eq('company_id', company.id)
      .eq('id', orderId).maybeSingle();
    if (orderError || !order) throw new BadRequestException('Pedido no encontrado.');
    const { data: items, error: itemsError } = await db.from('commerce_order_items')
      .select('id,product_name,variant_label,unit,quantity,unit_price,line_total')
      .eq('company_id', company.id).eq('order_id', orderId);
    if (itemsError) throw new BadRequestException('No se pudo consultar el detalle.');
    return { ok: true, order, items: items ?? [] };
  }

  @Patch('orders/:orderId/status')
  async advance(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Param('orderId') orderId = '',
    @Body() body: AdvanceOrderBody = {},
  ) {
    const company = await this.authorize(key, companyId, userId);
    const expectedStatus =
      typeof body.expectedStatus === 'string' ? body.expectedStatus.trim() : '';
    const nextStatus =
      typeof body.nextStatus === 'string' ? body.nextStatus.trim() : '';

    if (!expectedStatus || !nextStatus || expectedStatus === nextStatus) {
      throw new BadRequestException('Indica una transición válida.');
    }

    // The database RPC checks active company and membership again,
    // locks the order, validates the allowed transition, and appends an event
    // atomically. This API never marks a payment as paid.
    const { data, error } = await this.supabase.getClient()
      .rpc('mw1_commerce_transition_order', {
        p_company_id: company.id,
        p_order_id: orderId,
        p_expected_status: expectedStatus,
        p_next_status: nextStatus,
        p_actor_user_id: userId,
      });
    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }
}
