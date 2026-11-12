# MW1 — SEG-003 | Inbox and contacts tenant isolation — PROPOSAL / NO DEPLOY

## Scope and authorization

Prepared only in GitHub with two entirely synthetic companies `company-fixture-alpha` and `company-fixture-beta`. No Supabase production/staging writes, Railway variable changes, merges, or deployments are authorized by this preparation.

**Branch parent:** deployed API candidate at commit `371275cb9d0fb8797a5fef678d41973448ceb5eb`, the head of draft PR #31 (SEG-002). Review SEG-003 as a **dependent draft PR targeting that exact branch**, not as a merge from unrelated `main`.

## Confirmed code concerns (read-only review)

1. `InboxController.actor()` previously verified active `company_memberships` and `inbox.view`, but determined `isFullAccess` using `x-chatpro-role-key` (a proxy-supplied header). That value can be outdated, and should not be the authority for granting owner/admin access. In this candidate, **role key comes from `app_roles` via the active membership**, and `app_profiles.active` is checked. Existing role/header is retained only for the *legacy bootstrap* branch.
2. `ConversationMemoryService.getInboxConversation()`, `listInboxSessions()`, `listClients()`, and `getClientProfile()` already derive their target company via the profile and filter source sessions accordingly. Their subsequent message reads used session IDs without a redundant `company_id` clause. The candidate adds this database-level tenant predicate on each existing message read, without altering business processing.
3. `ConversationMemoryService.upsertContact()` now requires `company_id` as well as record ID for updates to an existing contact. Cleanup of an internal test conversation also requires the company ID.
4. Production has **21 tables without RLS and with direct role grants**. This draft does not address direct Data API exposure and is NOT a substitute for the separate RLS hardening work.
5. Some lower-level internal methods still read/update sessions by ID alone (e.g. `getSessionById`, `updateSession`, `touchSession`, `updateAttention`, provider status processing). These are used by WhatsApp, AI and automation flows; **do not change their signatures across the board without mapping each caller and testing the internal pipelines**. Their risks remain open and require a further scoped change.
6. The legacy `bootstrap` branch of `InboxController.actor` still relies on an upstream-signed company and owner claim, guarded with `CHATPRO_INBOX_KEY`. No transition of existing bootstrap users is part of this patch. Review and deprecate separately.
7. Current production sometimes reports `GET /inbox/:id` HTTP 500 for a session not found in the selected company. That failure predates this proposal; maintain incident tracking separately. Failures due to missing/foreign sessions should eventually become appropriate `404/403` without leaking tenant existence.

## Synthetic test plan

The offline Jest suite `src/seg003-inbox-tenant-isolation.spec.ts` covers:
- Advisor cannot elevate privilege by claiming owner in proxy headers.
- Actual owner and admin retain full-access semantics even with stale header role.
- Revoked company membership, disabled profile and missing `inbox.view` are denied.
- Company Alfa user cannot claim company Beta membership.
- Alfa cannot retrieve a Beta session by ID.
- Alfa and Beta receive only their own chat messages. An intentionally malformed row with another company ID and identical session ID is filtered.
- Original SEG-002 statistics protection tests continue to pass.
- NestJS compilation succeeds without touching deployed API or database.

## Remaining tests required before deployment or SQL changes

- Test the role hierarchy and assigned/unassigned advisor workflows in a **fully isolated staging environment** after obtaining explicit staging authorization.
- Simulate WhatsApp receive/send, status receipts, AI handoff, schedules, Shopify confirmations and abandoned-cart recovery for two independent fake companies.
- Test Instagram and Messenger session and media retrieval, including mismatched tenant IDs.
- Confirm that older bootstrap sessions keep functioning as intended or provide migration to user sessions.
- Audit every low-level mutation by ID and message-provider status handler for company verification.
- Before any production RLS stage, verify actual Data API exposure and role grants, snapshot policies/ACL, validate backups and roll back procedure.

## Staging/production safeguards

- No `ENABLE ROW LEVEL SECURITY`, `REVOKE` or `CREATE POLICY` statements are in this PR.
- No changes to Supabase projects, real contacts, message storage, WhatsApp, Shopify, Meta integration, AI settings or automation executions.
- Do **not** merge or deploy without specific later authorization; if authorized, start with a designated staging deployment and user-visible acceptance checks.
- Treat RLS as additional defense, not the entire authorization: `service_role` bypasses RLS.
