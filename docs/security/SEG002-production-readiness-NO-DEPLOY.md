# MW1 — SEG-002 | Production readiness checklist (NOT AUTHORIZED FOR DEPLOYMENT)

**Status:** proposal and read-only preflight only. This file is not a migration and must not be executed automatically.

## Production versions pinned at investigation (2026-11-11)

- **Web** `chatpro-web` (and `Chat Pro Inbox Web`): `main` commit `99a9d3ebdb38fc1212957403ebd2dbfec8fc620c`.
- **API** `pleasant-trust`: `integration/mw1-ai-sales-orders-visual-20261109` commit `266921e71d0786d5dc8911441446c6731969f8ea`.
- **Operational Supabase:** `lttucfblydpaljfboxro`. Do not write to it during planning.
- **Staging security tests:** PR #29, isolated with synthetic data. Do not merge staging wholesale: >1,000 unrelated commits diverge from production.
- **Proposed web patch:** `fix/seg002-prod-web-minimal-20261111`, based exactly on the live web commit.
- **Proposed API patch:** `fix/seg002-prod-api-minimal-20261111`, based exactly on the live API commit.

## Confirmed database exposure (read only)

The operational function `public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)` is `SECURITY DEFINER`, owned by `postgres`, and has `EXECUTE` currently granted to `PUBLIC`, `anon`, `authenticated`, and `service_role`. Its body filters rows by caller-supplied `p_company_id` but never verifies the requesting user's membership.

Staging has equivalent business aggregation over private synthetic tables with `anon=false`, `authenticated=false`, `service_role=true`. Owner and advisor functional tests, request forgery tests and live permission revocation/restore in staging have passed.

The product currently has **38 public tables; 21 lack RLS**. That is a separate project, not part of this release.

## Deployment safety blockers

- [ ] **Backups externally verified** — tool access does not include a list of actual scheduled backups/PITR restore points. Authorized operator must open **Supabase > operational project > Database > Backups** and verify timestamp, retention, restore method, and an acceptable recovery point. Do not assert backups exist based only on subscription or SQL metadata.
- [ ] **Storage awareness** — Supabase database backups store object metadata, not the Storage objects themselves. Do not mistake database restore for full media recovery.
- [ ] **Snapshot** — securely export the current function DDL (`pg_get_functiondef`) and exact ACL (`pg_proc.proacl`) to a restricted location; never commit a production data dump or secrets to a public repo.
- [ ] **Individual owners** — verify both ATOGOB (1 active owner profile) and MAOGO / `emprende-con-maogo` (2 active owner profiles) can log in using *user* sessions. The legacy `bootstrap` session has no individual identity and is intentionally denied statistics by the proposed patch.
- [ ] **Traffic mapping** — verify which production web service sends traffic to `pleasant-trust`. Railway OAuth exposes variable *names* only, not `CHATPRO_API_URL` values. `Chat Pro Inbox Web` and `chatpro-web` are separate live services; do not update both without verifying routing.
- [ ] **Token privileges** — `pleasant-trust` has `SUPABASE_SECRET_KEY` and `CHATPRO_INBOX_KEY` variable names. Confirm its actual Supabase role can execute the private RPC after revocation (do not print secret values).
- [ ] **Private production HMAC secret** — generate a distinct random `MW1_STATS_CONTEXT_SECRET` (>=32 chars) in a secret manager; set the *same value* on the production web that serves stats and the API. **Never reuse the staging key** or put it in GitHub.
- [ ] **Change window and service readiness** — snapshot current deployment IDs, confirm all production replicas online, and assign a human reviewer with authority to stop rollout.
- [ ] **Independent production approval** — creation of these branches is NOT approval to configure production variables, deploy builds, change grants, or restore a backup.

## Proposed coordinated release order — NOT EXECUTED

1. Revalidate actual traffic routing and user-session readiness. Prepare baseline owner statistics for ATOGOB and MAOGO (aggregate totals only, no PII), and negative test IDs.
2. With separate authorization, stage the signing key in the relevant web and API services. Understand that even variable-only Railway changes can trigger redeploys; use a controlled change window and wait for services to settle.
3. **Deploy the patched web first** after identifying all web instances serving `/api/statistics`. Existing API still accepts `x-chatpro-inbox-key` and `x-chatpro-company-id` and ignores the additional signed header, so owner stats can continue to load. Legacy `bootstrap` statistics intentionally require migration to individual login.
4. Confirm the web uses individual sessions and all its old replicas have drained; only then **deploy the patched API**. The patched API rejects unsigned requests, checks HMAC, validates live membership/profile and statistics permissions, and scopes the RPC by the signed tenant ID.
5. With both services stable, **separately authorize** the following single-function ACL change in the operational DB:

```sql
-- PROPOSAL ONLY. DO NOT EXECUTE BEFORE EXPLICIT DB AUTHORIZATION.
BEGIN;
REVOKE EXECUTE ON FUNCTION
  public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)
TO service_role;
COMMIT;
```

6. Read-only validation:
```sql
SELECT
  has_function_privilege('anon',
    'public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)', 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated',
    'public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)', 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role',
    'public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)', 'EXECUTE') AS api_can_execute;
-- Expected: false, false, true.
```
7. Verify owner stats of both real companies (totals must match baseline within time-window drift); advisor with `statistics.view` succeeds; advisor without it gets 403; attempts to change company ID get 401/403. Check API logs for 4xx/5xx and verify WhatsApp, Instagram, Shopify, inbox, AI, automations and orders are unaffected.
8. Retain a monitoring window and rollback plan; **do not continue with the 21 RLS tables in this SEG-002 rollout**.

## If checks fail

- **Before SQL ACL change:** stop; investigate the failed component. Keep the API/DB versions that preserve operational messaging. If rolling back either API or web to the old version, recognize the old API still accepts a tenant ID with only the internal key. Record this residual risk and do not call SEG-002 closed.
- **After SQL ACL change:** keep `PUBLIC/anon/authenticated` execution blocked. Prefer restoring the last compatible web/API releases or temporarily disabling only the statistics endpoint while investigating. Never regrant public `EXECUTE` as an automatic rollback step.
- Avoid restoring an entire operational Supabase backup for a privilege-only change: a full restore can overwrite newer messages/orders. Restoration of an entire database requires a separate incident decision and backup/PITR verification.

## Read-only preflight SQL

```sql
SELECT p.oid::regprocedure::text AS function_signature,
       p.prosecdef AS security_definer,
       p.proacl::text AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='chatpro_statistics_summary';
```

No production writes, migrations, variable changes, deploys or merges were performed during this preparation.
