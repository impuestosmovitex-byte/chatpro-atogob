'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const messages=fs.readFileSync('app/api/automation-messages/route.ts','utf8');
const templates=fs.readFileSync('app/api/whatsapp-templates/route.ts','utf8');
const page=fs.readFileSync('app/automatizaciones/mensajes/page.tsx','utf8');
for (const [name,s] of [['messages',messages],['templates',templates]]) {
  assert.equal((s.match(/code: 'STAGING_TEMPLATE_CONFIG_UNAVAILABLE'/g)||[]).length,1,name+' GET must explain no staging template records');
  assert.equal((s.match(/code: 'STAGING_TEMPLATE_CONFIG_READ_ONLY'/g)||[]).length,name==='templates'?2:1,name+' must block all writes');
  assert.ok(s.includes("process.env.MW1_STAGING_MODE === 'true'"),name+' must affect staging only');
  assert.ok(s.includes("target.searchParams.set('company', session.companySlug)") ||
    s.includes("target.searchParams.set('company', access.session.companySlug)"),
    name+' must resolve tenant from signed session, not request body');
}
assert.ok(messages.indexOf('STAGING_TEMPLATE_CONFIG_READ_ONLY') < messages.indexOf('const body = (await request.json())'),'Reject message edits before request parse or backend');
assert.ok(templates.indexOf('STAGING_TEMPLATE_CONFIG_READ_ONLY') < templates.indexOf("const body = (await request.json().catch"),'Reject template sync before calling Meta');
assert.ok(page.includes(') : error ? null : ('),'Do not show editable empty forms when staging backend is unavailable');
console.log('PASS staging template read/write guards; production tenant-scoped endpoints retained; empty editor hidden');
