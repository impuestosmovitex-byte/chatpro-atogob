-- SEG-002 STAGING ONLY.  Never apply to operational/historical Supabase.
-- Adapted from 202608070002_statistics_summary.sql with only data sources
-- redirected to private, completely synthetic fixture tables.
-- The output keys and aggregation SQL remain identical to production.
-- Demo tenants already exist in isolated staging; no changes to companies,
-- memberships, profiles, automations, channels or existing conversations.
BEGIN;
DO $seg002_guard$
BEGIN
  IF to_regnamespace('seg002_fixture') IS NOT NULL
     OR to_regprocedure('public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'SEG-002 abort: fixture or statistics RPC already exists';
  END IF;
END $seg002_guard$;
CREATE SCHEMA seg002_fixture;
REVOKE ALL ON SCHEMA seg002_fixture FROM PUBLIC, anon, authenticated;
CREATE TABLE seg002_fixture.conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  customer_phone text NOT NULL DEFAULT 'synthetic-only',
  channel text NOT NULL,
  event_type text NOT NULL,
  event_source text NOT NULL DEFAULT 'seg002-synthetic',
  advisor_user_id uuid,
  advisor_name text,
  service_area_id uuid,
  service_area_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE TABLE seg002_fixture.conversation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  pending_count integer NOT NULL DEFAULT 0,
  pending_since timestamptz
);
ALTER TABLE seg002_fixture.conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE seg002_fixture.conversation_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA seg002_fixture FROM PUBLIC, anon, authenticated;
INSERT INTO seg002_fixture.conversation_events
  (company_id,channel,event_type,event_source,advisor_user_id,advisor_name,service_area_id,service_area_name,created_at)
SELECT c.id,e.channel,e.kind,'seg002-synthetic',e.advisor_id,e.advisor_name,NULL,NULL,e.at_time
FROM (VALUES
  ('mw1-demo-mercado','whatsapp','customer_message',NULL::uuid,NULL::text,'2026-11-11 16:00:00+00'::timestamptz),
  ('mw1-demo-mercado','whatsapp','customer_message',NULL,NULL,'2026-11-11 16:01:00+00'),
  ('mw1-demo-mercado','whatsapp','customer_message',NULL,NULL,'2026-11-11 16:02:00+00'),
  ('mw1-demo-mercado','whatsapp','ai_message',NULL,NULL,'2026-11-11 16:03:00+00'),
  ('mw1-demo-mercado','whatsapp','advisor_message','00000000-0000-4000-8000-000000000001'::uuid,'Ficticio Asesor Alfa','2026-11-11 16:04:00+00'),
  ('mw1-demo-mercado','whatsapp','order_paid',NULL,NULL,'2026-11-11 16:05:00+00'),
  ('piloto-mw1-prueba','instagram','customer_message',NULL,NULL,'2026-11-11 16:06:00+00'),
  ('piloto-mw1-prueba','instagram','ai_message',NULL,NULL,'2026-11-11 16:07:00+00'),
  ('piloto-mw1-prueba','instagram','advisor_message','00000000-0000-4000-8000-000000000002'::uuid,'Ficticio Asesor Beta','2026-11-11 16:08:00+00')
) AS e(slug,channel,kind,advisor_id,advisor_name,at_time)
JOIN public.companies c ON c.slug=e.slug AND c.status='active';
DO $assert$
BEGIN
  IF (SELECT count(*) FROM seg002_fixture.conversation_events) != 9 THEN
    RAISE EXCEPTION 'SEG-002 abort: expected 9 synthetic events';
  END IF;
END $assert$;
INSERT INTO seg002_fixture.conversation_sessions(company_id,pending_count,pending_since)
SELECT c.id, 1, now()-interval '7 minutes'
FROM public.companies c WHERE c.slug='mw1-demo-mercado'
UNION ALL
SELECT c.id, 1, now()-interval '40 minutes'
FROM public.companies c WHERE c.slug='piloto-mw1-prueba';
-- Production-compatible aggregation over private synthetic sources only.
create or replace function public.chatpro_statistics_summary(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_timezone text default 'America/Bogota',
  p_bucket text default 'hour'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with filtered_events as (
  select
    id,
    session_id,
    customer_phone,
    channel,
    event_type,
    event_source,
    advisor_user_id,
    advisor_name,
    service_area_id,
    service_area_name,
    metadata,
    created_at
  from seg002_fixture.conversation_events
  where company_id = p_company_id
    and created_at >= p_from
    and created_at < p_to
),

summary as (
  select
    count(*) filter (
      where event_type = 'customer_message'
    )::integer as customer_messages,

    count(*) filter (
      where event_type = 'ai_message'
    )::integer as ai_messages,

    count(*) filter (
      where event_type = 'advisor_message'
    )::integer as advisor_messages,

    count(*) filter (
      where event_type = 'human_handoff_requested'
    )::integer as handoffs_requested,

    count(*) filter (
      where event_type = 'human_handoff_assigned'
    )::integer as handoffs_assigned,

    count(*) filter (
      where event_type = 'checkout_created'
    )::integer as checkouts_created,

    count(*) filter (
      where event_type = 'conversation_closed'
    )::integer as conversations_closed,

    count(*) filter (
      where event_type = 'conversation_resumed_ai'
    )::integer as conversations_resumed_ai,

    count(*) filter (
      where event_type = 'payment_proof_received'
    )::integer as payment_proofs,

    count(*) filter (
      where event_type = 'order_created'
    )::integer as orders_created,

    count(*) filter (
      where event_type = 'payment_pending'
    )::integer as payments_pending,

    count(*) filter (
      where event_type = 'order_paid'
    )::integer as orders_paid,

    count(distinct session_id)::integer as conversations_with_activity
  from filtered_events
),

channels as (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'channel', channel,
          'events', total
        )
        order by total desc
      ),
      '[]'::jsonb
    ) as data
  from (
    select
      channel,
      count(*)::integer as total
    from filtered_events
    group by channel
  ) x
),

advisors as (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'advisorUserId', advisor_user_id,
          'advisorName', advisor_name,
          'messages', messages,
          'assignments', assignments
        )
        order by messages desc, assignments desc
      ),
      '[]'::jsonb
    ) as data
  from (
    select
      advisor_user_id,
      max(advisor_name) as advisor_name,

      count(*) filter (
        where event_type = 'advisor_message'
      )::integer as messages,

      count(*) filter (
        where event_type = 'human_handoff_assigned'
      )::integer as assignments

    from filtered_events
    where advisor_user_id is not null
    group by advisor_user_id
  ) x
),

areas as (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'serviceAreaId', service_area_id,
          'serviceAreaName', service_area_name,
          'events', total
        )
        order by total desc
      ),
      '[]'::jsonb
    ) as data
  from (
    select
      service_area_id,
      max(service_area_name) as service_area_name,
      count(*)::integer as total
    from filtered_events
    where service_area_id is not null
    group by service_area_id
  ) x
),

timeline as (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', bucket_value,
          'customerMessages', customer_messages,
          'aiMessages', ai_messages,
          'advisorMessages', advisor_messages,
          'checkouts', checkouts,
          'handoffs', handoffs
        )
        order by bucket_value
      ),
      '[]'::jsonb
    ) as data
  from (
    select
      case
        when lower(p_bucket) = 'day'
          then date_trunc(
            'day',
            created_at at time zone p_timezone
          )
        else date_trunc(
          'hour',
          created_at at time zone p_timezone
        )
      end as bucket_value,

      count(*) filter (
        where event_type = 'customer_message'
      )::integer as customer_messages,

      count(*) filter (
        where event_type = 'ai_message'
      )::integer as ai_messages,

      count(*) filter (
        where event_type = 'advisor_message'
      )::integer as advisor_messages,

      count(*) filter (
        where event_type = 'checkout_created'
      )::integer as checkouts,

      count(*) filter (
        where event_type = 'human_handoff_requested'
      )::integer as handoffs

    from filtered_events
    group by 1
  ) x
),

pending_now as (
  select
    count(*)::integer as conversations
  from seg002_fixture.conversation_sessions
  where company_id = p_company_id
    and pending_count > 0
),

pending_age as (
  select
    count(*) filter (
      where pending_since > now() - interval '5 minutes'
    )::integer as under_5_minutes,

    count(*) filter (
      where pending_since <= now() - interval '5 minutes'
        and pending_since > now() - interval '15 minutes'
    )::integer as minutes_5_15,

    count(*) filter (
      where pending_since <= now() - interval '15 minutes'
        and pending_since > now() - interval '30 minutes'
    )::integer as minutes_15_30,

    count(*) filter (
      where pending_since <= now() - interval '30 minutes'
        and pending_since > now() - interval '1 hour'
    )::integer as minutes_30_60,

    count(*) filter (
      where pending_since <= now() - interval '1 hour'
    )::integer as over_1_hour

  from seg002_fixture.conversation_sessions
  where company_id = p_company_id
    and pending_count > 0
    and pending_since is not null
)

select jsonb_build_object(
  'from', p_from,
  'to', p_to,
  'timezone', p_timezone,
  'bucket', case
    when lower(p_bucket) = 'day' then 'day'
    else 'hour'
  end,

  'summary', jsonb_build_object(
    'conversationsWithActivity', s.conversations_with_activity,
    'customerMessages', s.customer_messages,
    'aiMessages', s.ai_messages,
    'advisorMessages', s.advisor_messages,
    'handoffsRequested', s.handoffs_requested,
    'handoffsAssigned', s.handoffs_assigned,
    'checkoutsCreated', s.checkouts_created,
    'conversationsClosed', s.conversations_closed,
    'conversationsResumedAi', s.conversations_resumed_ai,
    'paymentProofs', s.payment_proofs,
    'ordersCreated', s.orders_created,
    'paymentsPending', s.payments_pending,
    'ordersPaid', s.orders_paid,
    'unansweredNow', p.conversations
  ),

  'unansweredAge', jsonb_build_object(
    'under5Minutes', pa.under_5_minutes,
    'minutes5To15', pa.minutes_5_15,
    'minutes15To30', pa.minutes_15_30,
    'minutes30To60', pa.minutes_30_60,
    'over1Hour', pa.over_1_hour
  ),

  'channels', c.data,
  'advisors', a.data,
  'areas', ar.data,
  'timeline', t.data
)
from summary s
cross join pending_now p
cross join pending_age pa
cross join channels c
cross join advisors a
cross join areas ar
cross join timeline t;
$$;


-- Avoid Postgres's default PUBLIC EXECUTE grant for new public functions.
REVOKE EXECUTE ON FUNCTION public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chatpro_statistics_summary(uuid,timestamptz,timestamptz,text,text)
TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
