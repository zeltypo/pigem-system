BEGIN;

SELECT pg_advisory_xact_lock(92163018);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pigem_private.screening_jobs
    WHERE state = 'running' AND started_at >= now() - interval '6 minutes'
  ) THEN
    RAISE EXCEPTION 'A document check is running. Wait for it to finish before resetting.';
  END IF;
END $$;

CREATE TEMP TABLE reset_customers ON COMMIT DROP AS
SELECT id, lower(email) AS email
FROM public.users
WHERE role = 'customer';

DELETE FROM public.notifications AS n
WHERE n.role = 'customer'
   OR EXISTS (
     SELECT 1 FROM reset_customers AS c
     WHERE c.id = n.user_id OR c.email = lower(n.email)
   )
   OR EXISTS (
     SELECT 1 FROM public.applications AS a
     WHERE n.target_id IN (a.id, a.ref_no, a.reference_no)
   );

DELETE FROM public.login_history AS h
WHERE h.role = 'customer'
   OR EXISTS (SELECT 1 FROM reset_customers AS c WHERE c.id = h.user_id);

DELETE FROM public.applications;

DELETE FROM auth.users AS a
WHERE EXISTS (
  SELECT 1 FROM reset_customers AS c
  WHERE c.id = a.id::text OR c.email = lower(a.email)
)
AND NOT EXISTS (
  SELECT 1 FROM public.users AS u
  WHERE u.role IN ('admin', 'manager', 'agent')
    AND (u.id = a.id::text OR lower(u.email) = lower(a.email))
)
AND NOT EXISTS (
  SELECT 1 FROM pigem_private.screening_staff AS s WHERE s.staff_id = a.id::text
)
AND coalesce(a.raw_app_meta_data->>'role', '') NOT IN ('admin', 'manager', 'agent');

DELETE FROM public.users WHERE role = 'customer';

COMMIT;

SELECT
  (SELECT count(*) FROM public.applications) AS applications_remaining,
  count(*) FILTER (WHERE role = 'customer') AS customers_remaining,
  count(*) FILTER (WHERE role IN ('admin', 'manager', 'agent')) AS staff_remaining
FROM public.users;
