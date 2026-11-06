/**
 * Creates a fictional STAGING-ONLY demo owner.
 * Invoke manually inside the isolated staging API with:
 * MW1_STAGING_MODE=true, SUPABASE_URL, SUPABASE_SECRET_KEY,
 * MW1_DEMO_OWNER_PASSWORD.
 * Never invoke on production or record credentials in source control.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes, scryptSync } from 'node:crypto';

const allowed = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const url = process.env.SUPABASE_URL?.trim();
const secret = process.env.SUPABASE_SECRET_KEY?.trim();
const password = process.env.MW1_DEMO_OWNER_PASSWORD || '';

if (process.env.MW1_STAGING_MODE !== 'true' || url !== allowed) {
  throw new Error('Refusing to seed outside isolated MW1 staging.');
}
if (!secret || !password || password.length < 12) {
  throw new Error('Provide a private staging service key and demo password (12+ chars).');
}

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const slug = 'mw1-demo-mercado';
const identifier = 'MW1DEMO';
const email = 'demo-mercado@mw1-saas.example';
const { data: company, error: companyError } = await supabase
  .from('companies').select('id').eq('slug', slug).single();
if (companyError || !company) throw new Error('Fictional demo company is missing.');

const { data: existing, error: existingError } = await supabase
  .from('app_profiles').select('user_id').eq('login_identifier', identifier).maybeSingle();
if (existingError) throw new Error('Could not check demo owner.');
if (existing) {
  console.log('Staging demo owner already provisioned.');
  process.exit(0);
}

const { data: role, error: roleError } = await supabase
  .from('app_roles').select('id').eq('key', 'owner').is('company_id', null).single();
if (roleError || !role) throw new Error('Owner role is missing.');

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email, password, email_confirm: true,
  user_metadata: { full_name: 'Propietario Demo', demo: true },
});
if (createError || !created.user) throw new Error('Could not create the demo user.');
const userId = created.user.id;

try {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  const password_hash = `scrypt-v1:${salt}:${hash}`;
  const { error: profileError } = await supabase.from('app_profiles').insert({
    user_id: userId, full_name: 'Propietario Demo',
    login_identifier: identifier, password_hash, email,
  });
  if (profileError) throw new Error('Unable to save demo profile.');

  const { error: membershipError } = await supabase.from('company_memberships').insert({
    company_id: company.id, user_id: userId, role_id: role.id, active: true,
  });
  if (membershipError) throw new Error('Unable to save demo membership.');
  console.log('Fictional MW1 demo owner provisioned for staging only.');
} catch (error) {
  await supabase.auth.admin.deleteUser(userId);
  throw error;
}
