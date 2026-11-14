'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const session = fs.readFileSync('app/api/auth/session/route.ts','utf8');
const sidebar = fs.readFileSync('app/components/AppSidebar.tsx','utf8');
assert.ok(session.includes("isUnifiedPanelEnabled(session.companySlug)"),'Opt-in must come from server, not client guess');
assert.ok(sidebar.includes('const optedIn = sessionData.unifiedPanelEnabled === true'),'Sidebar must use signed server session opt-in');
assert.ok(sidebar.includes('} else if (optedIn) {'),'Failed permissions response must be handled, not just exceptions');
assert.ok(sidebar.includes('if (optedIn) setUnifiedPanelEnabled(false)'),'Error path must hide panel entry');
for (const cap of ['inbox','clients','automations','statistics','configuration','testAgent','health']) {
  const pattern=new RegExp(cap+': !panelOptedIn');
  assert.ok(pattern.test(sidebar),'No guessed '+cap+' before permissions');
}
assert.ok(sidebar.includes('automations: !optedIn && fullAccess'),'Legacy manager fallback unchanged if no opt-in');
assert.ok(sidebar.includes('statistics: !optedIn && fullAccess'),'Legacy statistics fallback unchanged');
console.log('MW1 opt-in navigation fails closed on missing capabilities; old CRM fallback retained');
