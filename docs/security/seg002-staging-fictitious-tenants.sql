-- SEG-002 | Only fictitious in-memory fixtures; no production data.
-- Executable in Supabase staging with SELECT only. Does not create/write rows.
WITH
company_fixture(company_id,company_status) AS (
  VALUES ('alfa-ficticia','active'),('beta-ficticia','active')
),
profile_fixture(user_id,active) AS (
  VALUES
    ('owner-alfa',true),('owner-beta',true),('advisor-alfa-yes',true),
    ('advisor-alfa-no',true),('owner-inactive',true),
    ('owner-profile-disabled',false),('old-owner-demoted',true)
),
role_fixture(role_id,role_key,company_id) AS (
  VALUES
    ('role-owner','owner',NULL::text),
    ('role-advisor-yes','advisor','alfa-ficticia'),
    ('role-advisor-no','advisor','alfa-ficticia')
),
membership_fixture(user_id,company_id,role_id,active) AS (
  VALUES
    ('owner-alfa','alfa-ficticia','role-owner',true),
    ('owner-beta','beta-ficticia','role-owner',true),
    ('advisor-alfa-yes','alfa-ficticia','role-advisor-yes',true),
    ('advisor-alfa-no','alfa-ficticia','role-advisor-no',true),
    ('owner-inactive','alfa-ficticia','role-owner',false),
    ('owner-profile-disabled','alfa-ficticia','role-owner',true),
    ('old-owner-demoted','alfa-ficticia','role-advisor-no',true)
),
permission_fixture(role_id,permission_key) AS (
  VALUES ('role-advisor-yes','statistics.view'),
         ('role-advisor-no','inbox.view')
),
scenarios(test_name,user_id,request_company,expected) AS (
  VALUES
    ('owner A reads A','owner-alfa','alfa-ficticia',true),
    ('owner A cannot read B','owner-alfa','beta-ficticia',false),
    ('owner B reads B','owner-beta','beta-ficticia',true),
    ('owner B cannot read A','owner-beta','alfa-ficticia',false),
    ('advisor with permission reads A','advisor-alfa-yes','alfa-ficticia',true),
    ('advisor cannot read B','advisor-alfa-yes','beta-ficticia',false),
    ('advisor without permission denied','advisor-alfa-no','alfa-ficticia',false),
    ('inactive membership denied','owner-inactive','alfa-ficticia',false),
    ('disabled profile denied','owner-profile-disabled','alfa-ficticia',false),
    ('old owner downgraded denied','old-owner-demoted','alfa-ficticia',false)
)
SELECT
  s.test_name AS test,
  CASE WHEN s.expected THEN 'PERMIT' ELSE 'DENY' END AS expected,
  CASE WHEN EXISTS (
    SELECT 1
    FROM membership_fixture m
    JOIN company_fixture c ON c.company_id=m.company_id AND c.company_status='active'
    JOIN profile_fixture p ON p.user_id=m.user_id AND p.active
    JOIN role_fixture r ON r.role_id=m.role_id
      AND (r.company_id IS NULL OR r.company_id=m.company_id)
    WHERE m.user_id=s.user_id AND m.company_id=s.request_company AND m.active
      AND (r.role_key IN ('owner','admin') OR EXISTS (
        SELECT 1 FROM permission_fixture x
        WHERE x.role_id=r.role_id AND x.permission_key='statistics.view'
      ))
  ) THEN 'PERMIT' ELSE 'DENY' END AS actual
FROM scenarios s ORDER BY s.test_name;
