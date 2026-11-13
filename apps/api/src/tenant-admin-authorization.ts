import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/** SEG-003B: server-side authorization for tenant administration.
 * Never trust browser-provided role claims. Internal service key is checked
 * separately by the caller and must never be exposed to browsers.
 */
export class TenantAdminAuthorization {
  constructor(private readonly supabase: SupabaseService) {}

  async assertCurrentManager(
    userId: string,
    sessionType: string,
    companyId: string,
    companySlug: string,
  ): Promise<void> {
    if (sessionType !== 'user' || !userId || !companyId || !companySlug)
      throw new UnauthorizedException('Se requiere una sesión de usuario vigente.');

    const db = this.supabase.getClient();
    const { data: company, error: companyError } = await db.from('companies')
      .select('id,status,slug').eq('id', companyId)
      .eq('slug', companySlug).maybeSingle();
    if (companyError || company?.status !== 'active')
      throw new ForbiddenException('Empresa no autorizada.');

    const { data: profile, error: profileError } = await db.from('app_profiles')
      .select('active').eq('user_id', userId).maybeSingle();
    if (profileError || profile?.active !== true)
      throw new ForbiddenException('Usuario desactivado.');

    const { data: membership, error: membershipError } = await db
      .from('company_memberships').select('role_id,active')
      .eq('company_id', companyId).eq('user_id', userId).maybeSingle();
    if (membershipError || !membership?.active || !membership.role_id)
      throw new ForbiddenException('Membresía inactiva o inexistente.');

    const { data: role, error: roleError } = await db.from('app_roles')
      .select('key,company_id').eq('id', membership.role_id).maybeSingle();
    if (roleError || !role || (role.company_id && role.company_id !== companyId) ||
        !['owner', 'admin'].includes(String(role.key).trim().toLowerCase()))
      throw new ForbiddenException('No tienes permisos actuales para administrar esta empresa.');
  }
}
