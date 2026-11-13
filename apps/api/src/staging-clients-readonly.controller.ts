import {
  Controller, ForbiddenException, Get, Headers, Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/**
 * SEG-003: read-only staging contact lookup.
 * No production controllers, background processes, sending or writes.
 */
@Controller('clients')
export class StagingClientsReadonlyController {
  constructor(private readonly db: SupabaseService) {}

  private async authorize(
    key: string, type: string, userId: string, companyId: string, slug: string,
  ) {
    if (process.env.MW1_STAGING_MODE !== 'true')
      throw new ForbiddenException('Disponible solo en staging.');
    if (!process.env.CHATPRO_INBOX_KEY ||
        key !== process.env.CHATPRO_INBOX_KEY.trim() ||
        type !== 'user' || !userId || !companyId || !slug)
      throw new UnauthorizedException('Sesión de usuario requerida.');

    const db = this.db.getClient();
    const { data: company, error: companyError } = await db.from('companies')
      .select('id,slug,name,status').eq('id', companyId).eq('slug', slug)
      .maybeSingle();
    if (companyError || company?.status !== 'active')
      throw new ForbiddenException('Empresa no autorizada.');
    const { data: profile, error: profileError } = await db.from('app_profiles')
      .select('active').eq('user_id', userId).maybeSingle();
    if (profileError || !profile?.active)
      throw new ForbiddenException('Usuario inactivo.');
    const { data: membership, error: membershipError } = await db
      .from('company_memberships').select('role_id,active')
      .eq('company_id', company.id).eq('user_id', userId).maybeSingle();
    if (membershipError || !membership?.active || !membership.role_id)
      throw new ForbiddenException('Membresía no autorizada.');
    const { data: role, error: roleError } = await db.from('app_roles')
      .select('key,company_id').eq('id', membership.role_id).maybeSingle();
    if (roleError || !role ||
        (role.company_id && role.company_id !== company.id))
      throw new ForbiddenException('Rol no autorizado.');

    const fullAccess = role.key === 'owner' || role.key === 'admin';
    if (!fullAccess) {
      const { data: permissionLinks, error: linksError } = await db
        .from('app_role_permissions').select('permission_id')
        .eq('role_id', membership.role_id);
      if (linksError) throw new ForbiddenException('Permisos no disponibles.');
      const ids = (permissionLinks ?? []).map((x: any) => x.permission_id)
        .filter((x: unknown): x is string => typeof x === 'string');
      const { data: permissions, error: permissionsError } = ids.length
        ? await db.from('app_permissions').select('key').in('id', ids)
        : { data: [], error: null };
      if (permissionsError ||
          !(permissions ?? []).some((p: any) => p.key === 'clients.view'))
        throw new ForbiddenException('Sin permiso para consultar clientes.');
    }
    return { db, company, fullAccess, userId };
  }

  @Get()
  async list(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-session-type') type = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Query('search') search = '',
    @Query('limit') limit = '100',
  ) {
    const actor = await this.authorize(key, type, userId, companyId, slug);
    const take = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 150);
    // No cross-tenant joins or reads before authorization.
    const { data: sessions, error } = await actor.db.from('conversation_sessions')
      .select('id,customer_phone,last_message_at,attention_status,assigned_to_user_id,assigned_to_name')
      .eq('company_id', actor.company.id)
      .order('last_message_at', { ascending: false }).limit(take);
    if (error) throw new ForbiddenException('No se pudieron consultar clientes.');
    const visible = (sessions ?? []).filter((s: any) =>
      actor.fullAccess || (s.attention_status === 'human' &&
        s.assigned_to_user_id === actor.userId));
    const normalizedSearch = typeof search === 'string' ? search.trim() : '';
    const matches = visible.filter((s: any) => !normalizedSearch ||
      String(s.customer_phone ?? '').includes(normalizedSearch));
    // Preserve existing client-list response contract while keeping
    // the staging dataset read-only and avoiding unrelated message reads.
    return {
      ok: true,
      company: { id: actor.company.id, slug: actor.company.slug, name: actor.company.name },
      canEdit: false,
      clients: matches.map((s: any) => ({
        customerPhone: s.customer_phone,
        contact: null,
        firstMessageAt: null,
        lastMessageAt: s.last_message_at,
        attentionStatus: s.attention_status ?? 'ai',
        assignedToName: s.assigned_to_name ?? null,
        totalMessages: 0,
        lastMessage: null,
        historyRestricted: !actor.fullAccess,
        startAvailable: false,
        startBlockedReason: 'Operaciones desactivadas en staging.',
      })),
      stagingReadOnly: true,
    };
  }

  @Get('profile')
  async profile(
    @Headers('x-chatpro-inbox-key') key = '',
    @Headers('x-chatpro-session-type') type = '',
    @Headers('x-chatpro-user-id') userId = '',
    @Headers('x-chatpro-company-id') companyId = '',
    @Query('company') slug = '',
    @Query('phone') phone = '',
  ) {
    const actor = await this.authorize(key, type, userId, companyId, slug);
    if (!phone || typeof phone !== 'string' || phone.length > 60)
      throw new ForbiddenException('Cliente no disponible.');
    const { data: session, error } = await actor.db.from('conversation_sessions')
      .select('id,company_id,customer_phone,stage,context,last_message_at,attention_status,assigned_to_user_id,assigned_to_name,taken_at,closed_at')
      .eq('company_id', actor.company.id).eq('customer_phone', phone).maybeSingle();
    if (error || !session ||
        (!actor.fullAccess && !(session.attention_status === 'human' &&
          session.assigned_to_user_id === actor.userId)))
      throw new ForbiddenException('Cliente no disponible para este usuario.');
    // Staging deliberately returns no messages or editable contact details.
    return {
      ok: true,
      company: { id: actor.company.id, slug: actor.company.slug, name: actor.company.name },
      client: {
        customerPhone: session.customer_phone, contact: null,
        firstMessageAt: null, lastMessageAt: session.last_message_at,
        attentionStatus: session.attention_status ?? 'ai',
        assignedToName: session.assigned_to_name ?? null,
        totalMessages: 0, lastMessage: null,
        historyRestricted: true, startAvailable: false,
        startBlockedReason: 'Operaciones desactivadas en staging.',
      },
      session: {
        id: session.id, companyId: session.company_id,
        customerPhone: session.customer_phone, stage: session.stage,
        context: {}, lastMessageAt: session.last_message_at,
        attentionStatus: session.attention_status ?? 'ai',
        assignedToName: session.assigned_to_name ?? null,
        takenAt: session.taken_at, closedAt: session.closed_at,
      },
      messages: [], historyRestricted: true, canEdit: false,
      startAvailable: false,
      startBlockedReason: 'Operaciones desactivadas en staging.',
      stagingReadOnly: true,
    };
  }
}
