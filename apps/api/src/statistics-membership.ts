import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

function ensureQuery(result: { data: any; error: any }): any {
  if (result.error) {
    // Do not disclose table names or SQL internals to an API consumer.
    throw new ServiceUnavailableException('No se pudieron validar los permisos.');
  }
  return result.data;
}

export async function requireStatisticsMembership(
  client: SupabaseClient,
  companyId: string,
  userId: string,
): Promise<void> {
  // Never derive a role or company from an unverified browser header.
  const company = ensureQuery(await client.from('companies')
    .select('id,status').eq('id', companyId).maybeSingle());
  if (!company || company.status !== 'active') {
    throw new ForbiddenException('No tienes acceso a las estadísticas de esta empresa.');
  }

  const membership = ensureQuery(await client.from('company_memberships')
    .select('role_id,active')
    .eq('company_id', companyId).eq('user_id', userId).maybeSingle());
  const profile = ensureQuery(await client.from('app_profiles')
    .select('active').eq('user_id', userId).maybeSingle());
  if (!membership?.active || !membership.role_id || profile?.active !== true) {
    throw new ForbiddenException('No tienes acceso a las estadísticas de esta empresa.');
  }

  const role = ensureQuery(await client.from('app_roles')
    .select('key,company_id').eq('id', membership.role_id).maybeSingle());
  // Global roles have company_id = null. A tenant-scoped role MUST belong
  // to the same tenant as the membership (not merely have a matching ID).
  if (!role?.key || (role.company_id && role.company_id !== companyId)) {
    throw new ForbiddenException('No tienes acceso a las estadísticas de esta empresa.');
  }

  const roleKey = String(role.key).trim().toLowerCase();
  if (roleKey === 'owner' || roleKey === 'admin') return;

  const links = ensureQuery(await client.from('app_role_permissions')
    .select('permission_id').eq('role_id', membership.role_id));
  const permissionIds = (links || [])
    .map((row: { permission_id?: unknown }) => row.permission_id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  if (permissionIds.length === 0) {
    throw new ForbiddenException('No tienes permiso para consultar estadísticas.');
  }

  const permissions = ensureQuery(await client.from('app_permissions')
    .select('key').in('id', permissionIds));
  const allowed = (permissions || []).some((row: { key?: unknown }) => {
    const key = typeof row.key === 'string' ? row.key.trim().toLowerCase() : '';
    // Preserve existing capabilities controller semantics for legacy roles.
    return ['statistics', 'report', 'reports'].some(prefix =>
      key === prefix || key.startsWith(prefix + '.'));
  });
  if (!allowed) {
    throw new ForbiddenException('No tienes permiso para consultar estadísticas.');
  }
}
