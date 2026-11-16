'use strict';
/**
 * Regression check: social media bytes cannot be read before authenticated
 * company membership / inbox.view / conversation visibility are checked.
 * Static safety check only; NOT a substitute for authenticated E2E.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('apps/api/src/inbox.controller.ts', 'utf8');
const start = source.indexOf("  @Get(':sessionId/messages/:messageId/media')");
const end = source.indexOf("  @Post(':sessionId/templates')", start);
assert.ok(start >= 0 && end > start, 'Media GET handler missing');
const handler = source.slice(start, end);
const social = handler.slice(handler.indexOf('if (socialMediaConversation)'), handler.indexOf('const conversation ='));
assert.match(social, /await this\.actor\([\s\S]*?socialMediaProfile\.id/, 'Social media must authenticate actor against correct tenant');
assert.match(social, /this\.canView\(socialMediaActor, socialMediaConversation\.session\)/, 'Social media must check conversation visibility');
assert.match(social, /throw new ForbiddenException/, 'Unauthorized media read must fail closed');
const authorize = social.indexOf('await this.actor(');
const visibility = social.indexOf('this.canView(');
const rowRead = social.indexOf(".from('social_conversations')");
const remoteFetch = social.indexOf('await fetch(location)');
const storage = social.indexOf(".from('chatpro-media')");
assert.ok(authorize >= 0 && visibility > authorize &&
  rowRead > visibility && remoteFetch > visibility && storage > visibility,
  'Social media must authorize BEFORE query, remote fetch or storage download');
const actor = source.slice(source.indexOf('  private async actor('), source.indexOf('  private async actor(') + 3300);
assert.match(actor, /headerCompanyId\.trim\(\) !== companyId/, 'Actor must match tenant');
assert.match(actor, /\.from\('company_memberships'\)/, 'Actor must revalidate membership');
assert.match(actor, /permissions\.has\('inbox\.view'\)/, 'Actor must require inbox.view');
console.log('PASS: social media is gated by tenant membership and inbox.view before bytes are retrieved');
console.log('NOT RUN: authenticated cross-tenant and cross-advisor HTTP tests');
