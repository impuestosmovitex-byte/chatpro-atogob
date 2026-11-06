-- MW1 diagnostic remediation: historical Meta IDs for Shopify automations.
-- Review and run in staging first. Do NOT infer delivery from a send acceptance.
-- This script only fills missing provider_message_id from the existing payload;
-- it does not update statuses, resend messages, or touch customer data.
BEGIN;
WITH candidates AS (
  SELECT id, payload->>'provider_message_id' AS message_id
  FROM public.automation_executions
  WHERE provider_message_id IS NULL
    AND payload->>'provider_message_id' ~ '^wamid[.]'
), uniquely_mapped AS (
  SELECT id, message_id
  FROM candidates
  WHERE message_id IN (
    SELECT message_id FROM candidates GROUP BY message_id HAVING COUNT(*) = 1
  )
)
UPDATE public.automation_executions AS ae
SET provider_message_id = um.message_id,
    updated_at = NOW()
FROM uniquely_mapped AS um
WHERE ae.id = um.id
  AND ae.provider_message_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.automation_executions AS existing
    WHERE existing.provider_message_id = um.message_id
  );
-- Review affected rows and verify status mapping before COMMIT.
ROLLBACK;
