const fs=require('node:fs');
const assert=require('node:assert/strict');
const inbox=fs.readFileSync('app/api/inbox/route.ts','utf8');
const channels=fs.readFileSync('app/api/inbox/channels/route.ts','utf8');
const presence=fs.readFileSync('app/api/advisor-presence/route.ts','utf8');
const app=fs.readFileSync('app/page.tsx','utf8');
const staging=fs.readFileSync('apps/api/src/staging-app.module.ts','utf8');
// The staging runtime deliberately does not activate production inbox integrations.
// Never silently return fake successful message delivery or attach production credentials.
assert(!staging.includes('InboxController,'),'Production InboxController unexpectedly activated in staging');
assert(!staging.includes('IntegrationsController,'),'Production IntegrationsController unexpectedly activated in staging');
for(const [name,code] of Object.entries({inbox,channels,presence})){
 assert(code.includes("process.env.MW1_STAGING_MODE === 'true'"),name+' has no explicit staging gate');
 assert(code.includes("code:'STAGING_INBOX_DISABLED'")||code.includes("code: 'STAGING_INBOX_DISABLED'"),name+' does not provide a stable reason code');
 assert(code.includes('status:503'),name+' must fail unavailable, never claim delivery');
}
assert(app.includes("data as ApiList & {code?:string}"),'Inbox must render staging state rather than raw 404');
assert(app.includes('Modo de incorporación MW1'),'CRM staging notice is missing');
assert(!inbox.includes("sessions: []"),'Never fabricate an empty inbox when no runtime exists');
console.log('MW1 staging inbox is clearly unavailable; production runtime remains excluded.');
