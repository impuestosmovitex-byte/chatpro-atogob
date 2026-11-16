'use strict';
/**
 * MW1 isolated tenant-boundary source guards.
 *
 * These checks are STATIC regression guards, NOT authenticated E2E evidence.
 * They do not contact Railway, Supabase or customer data.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
function must(source, expression, reason) {
  assert.match(source, expression, reason);
}
const access = read('apps/api/src/access.controller.ts');
const inbox = read('apps/api/src/inbox.controller.ts');
const clients = read('apps/api/src/clients.controller.ts');
const stats = read('apps/api/src/statistics.controller.ts');
const switchMethod = access.slice(access.indexOf("@Post('switch-company')"), access.indexOf("@Post('login')"));
assert.ok(switchMethod.length > 500, 'Cannot find switch-company implementation');
must(switchMethod, /\.eq\('company_id', company\.id\)/, 'Switch must check target company');
must(switchMethod, /\.eq\('user_id', userId\)/, 'Switch must check current user membership');
must(switchMethod, /if \(!membership\.active\)/, 'Switch must reject inactive memberships');
must(switchMethod, /role\.company_id\s*&&\s*role\.company_id\s*!==\s*company\.id/, 'Switch must reject role assigned to another company');

function assertActor(name, source) {
  const actorStart = source.indexOf('private async actor(');
  assert.ok(actorStart >= 0, name + ' actor authorization missing');
  const actor = source.slice(actorStart, actorStart + 3600);
  must(actor, /headerCompanyId\.trim\(\)\s*!==\s*companyId/, name + ' must bind header tenant to requested tenant');
  must(actor, /\.from\('company_memberships'\)/, name + ' must use actual membership');
  must(actor, /\.eq\('company_id', companyId\)/, name + ' must scope membership by tenant');
  must(actor, /\.eq\('user_id', id\)/, name + ' must scope membership by principal');
  must(actor, /!membership\?\.active/, name + ' must reject inactive membership');
  must(actor, /\.from\('app_role_permissions'\)/, name + ' must load authorized permissions');
}
assertActor('Inbox', inbox);
assertActor('Clients', clients);
const inboxList = inbox.slice(inbox.indexOf('  @Get()\n  async list('), inbox.indexOf('  @Get()\n  async list(') + 2400);
must(inboxList, /getCompanyProfile\(companySlug\)/, 'Inbox must resolve requested tenant');
must(inboxList, /await this\.actor\(/, 'Inbox must verify actor');
const clientsList = clients.slice(clients.indexOf('  @Get()\n  async list('), clients.indexOf('  @Get()\n  async list(') + 1600);
must(clientsList, /listClients\(/, 'Client listing must use scoped service');
must(clientsList, /await this\.actor\(/, 'Client listing must verify actor');
must(stats, /verifyStatisticsContext\(/, 'Stats must validate signed context');
must(stats, /requireStatisticsMembership\(/, 'Stats must revalidate tenant membership');
must(stats, /p_company_id: cleanCompanyId/, 'Stats query must constrain company ID');

// Staging deliberately uses its own read-only Clients controller (not ClientsController).
// Guard the exact endpoint used by the advisor E2E screenshots.
const stagingModule = read('apps/api/src/staging-app.module.ts');
const stagingClients = read('apps/api/src/staging-clients-readonly.controller.ts');
must(stagingModule, /StagingClientsReadonlyController/, 'Staging must register its restricted Clients controller');
must(stagingClients, /verifyInternalAttestation\(/, 'Staging Clients must validate signed identity');
must(stagingClients, /\.eq\('company_id', actor\.company\.id\)/, 'Staging Clients must scope DB rows by tenant');
must(stagingClients, /\.eq\('customer_phone', phone\)/, 'Staging profile must select exact phone');
must(stagingClients, /session\.attention_status === 'human'/, 'Staging Clients must require human assignment for advisor profile access');
must(stagingClients, /session\.assigned_to_user_id === actor\.userId/, 'Staging Clients must restrict profile to its assigned advisor');
must(stagingClients, /\.eq\('company_id', company\.id\)\.eq\('user_id', userId\)/, 'Staging Clients must verify active membership scoped by tenant');
must(stagingClients, /messages: \[\]/, 'Staging Clients profile must not expose messages');
must(stagingClients, /stagingReadOnly: true/, 'Staging Clients must remain read-only');

console.log('PASS: static tenant guards for switch-company, inbox, clients and statistics');
console.log('NOT RUN: negative authenticated cross-tenant HTTP/E2E checks (credentials unavailable)');
