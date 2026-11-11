-- SEG-002: PROPOSAL ONLY. DO NOT EXECUTE UNTIL SEPARATELY APPROVED.
-- Must be applied AFTER the signed web/API authorization is validated in staging.
-- The function is absent from current staging; clone its schema with fictional
-- data and verify API behavior before production application.
-- Backup: export pg_get_functiondef, proname/oid/proacl, caller grants, and
-- capture current dashboard checks BEFORE any change.
--
-- Restrict direct access while retaining backend service-role compatibility.
BEGIN;
DO $seg002$
BEGIN
  IF to_regprocedure('public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)') IS NULL THEN
    RAISE EXCEPTION 'SEG-002 precondition failed: statistics function absent';
  END IF;
END
$seg002$;
REVOKE EXECUTE ON FUNCTION
  public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)
TO service_role;
COMMIT;

-- Read-only verification after applying:
-- select has_function_privilege('anon',
--   'public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)',
--   'EXECUTE') = false as anon_blocked,
-- has_function_privilege('authenticated',
--   'public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)',
--   'EXECUTE') = false as authenticated_blocked,
-- has_function_privilege('service_role',
--   'public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)',
--   'EXECUTE') = true as server_still_allowed;

-- A rollback of API/web code must NEVER silently regrant PUBLIC.
-- If backend stats stop functioning, restore the previous API/web version
-- while keeping the RPC private and investigate the service_role binding.
-- Reopening public grants needs a separate explicit risk acceptance.
