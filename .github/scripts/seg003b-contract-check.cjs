/**
 * SEG-003B cross-branch API/web contract audit (offline, no credentials).
 * Web checkout must be the exact planned staging web change branch.
 */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.cwd();
const get = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const webUsers = get('web-compatible/app/api/users/route.ts');
const webRoles = get('web-compatible/app/api/roles/route.ts');
const session = get('web-compatible/app/lib/inbox-auth.ts');
const apiUsers = get('apps/api/src/users.controller.ts');
const apiRoles = get('apps/api/src/roles.controller.ts');
const guard = get('apps/api/src/tenant-admin-authorization.ts');
const stagingModule = get('apps/api/src/staging-app.module.ts');

assert.match(session, /crypto\.subtle\.verify/, 'Web must validate session signature');
assert.match(session, /payload\.exp <= Date\.now\(\)/, 'Web must enforce expiration');
assert.match(session, /userId: string \| null/, 'Session needs nullable user ID');
for (const [name, web, api, routes] of [
  ['users', webUsers, apiUsers, 4],
  ['roles', webRoles, apiRoles, 3],
]) {
  for (const header of [
    'x-chatpro-inbox-key',
    'x-chatpro-session-type',
    'x-chatpro-user-id',
    'x-chatpro-company-id',
  ]) {
    assert.ok(web.includes("'"+header+"'"), name+' web missing '+header);
    assert.ok(api.includes("@Headers('"+header+"')"), name+' API missing '+header);
  }
  assert.match(web, /session\.type === 'user' \? session\.userId \|\| '' : ''/,
    'Web cannot forward user claims for a non-user session');
  assert.match(web, /MW1_STAGING_MODE === 'true' && session\.type !== 'user'/,
    'Bootstrap/platform must be blocked for administrative operations in staging');
  assert.match(web, /getInboxSession\(request\.cookies\.get\(INBOX_SESSION_COOKIE\)/,
    'Identity must come from the signed session cookie');
  assert.match(web, /target\.searchParams\.set\('company', companySlug\)/,
    'Proxy should use company from signed session');
  const matched = api.match(/\.assertCurrentManager\(actorUserId, actorSessionType, actorCompanyId, companySlug\)/g) || [];
  assert.equal(matched.length, routes, name+' all routes must check live membership');
  assert.match(api, /this\.assertInternalKey\(providedKey\)/,
    'Retain existing internal service authorization');
}
for(const predicate of [
  /\.eq\('id', companyId\)/, /\.eq\('slug', companySlug\)/,
  /profile\?\.active !== true/, /!membership\?\.active/,
  /role\.company_id !== companyId/, /\['owner', 'admin'\]/,
]) assert.match(guard,predicate,'Missing server-side restriction '+predicate);
assert.match(stagingModule,/UsersController/);
assert.doesNotMatch(stagingModule,/^\s+RolesController,?\s*$/m,
  'Roles controller must not be activated by this change');
process.stdout.write('SEG-003B integrated API/web contract checks passed. No deployment.\n');
