'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const code = fs.readFileSync('app/page.tsx', 'utf8');
const action = code.slice(code.indexOf('  async function runAction('),code.indexOf('  async function openTransferDialog('));
const opening = code.slice(code.indexOf('  async function openConversation('),code.indexOf('  async function loadOlderMessages('));
assert.ok(action.length > 500);
assert.ok(!/await\s+openConversation\s*\(\s*sessionId\s*\)/.test(action),
  'Stale action MUST NOT re-open a previously selected customer');
assert.ok(!/await\s+loadList\s*\(\s*false\s*\)/.test(action),
  'Action completion MUST NOT block on a full inbox list refresh');
assert.match(action, /current\.session\.id !== sessionId/,
  'Action response must be scoped to the original conversation');
assert.match(action, /openingSessionIdRef\.current !== sessionId/,
  'Action response must respect the advisor selecting a new conversation');
assert.match(action, /activeSessionIdRef\.current === sessionId/,
  'Old action responses must not display success text on another conversation');
assert.match(action, /action === "close"/,
  'Close action must reconcile locally without refetching old conversation');
assert.match(opening, /manualConversationAbortRef\.current\?\.abort\(\)/,
  'New chat must cancel the older conversation HTTP request');
assert.match(opening, /setSelected\(\(current\) =>\s*current\?\.session\.id === sessionId \? current : null/,
  'Old composer must disappear while another chat opens');
assert.match(opening, /String\(silent \? 40 : HISTORY_PAGE_SIZE\)/,
  'Background fetch must download a smaller message page');
assert.match(code, /window\.setInterval\(\s*lightRefreshVisibleList,\s*5000/,
  'Preserve inbox visible list refresh cadence while tuning');
console.log('PASS: inbox switch/close/send stale-state guards, immediate navigation, scoped refresh');
