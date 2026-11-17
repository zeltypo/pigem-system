BEGIN;

CREATE SCHEMA IF NOT EXISTS pigem_private;
REVOKE ALL ON SCHEMA pigem_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS pigem_private.screening_intake (
  ticket text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON pigem_private.screening_intake FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS pigem_private.screening_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  revision text NOT NULL,
  ticket text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  UNIQUE (application_id, revision)
);

REVOKE ALL ON pigem_private.screening_jobs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pigem_enqueue_screening(app_id text, intake_ticket text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE app public.applications%ROWTYPE; rev text; inserted uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(92163017);
  SELECT * INTO app FROM public.applications WHERE id = app_id FOR UPDATE;
  IF NOT FOUND OR app.created_at < now() - interval '10 minutes' OR
     app.status NOT IN ('Pending Review', 'Needs Correction') OR app.corrected_copy IS NOT NULL
     OR COALESCE(app.id_image_url, app.id_front_path, '') = '' THEN RETURN false; END IF;
  rev := app.created_at::text;
  IF EXISTS (SELECT 1 FROM pigem_private.screening_jobs WHERE application_id = app_id AND revision = rev) THEN
    RETURN true;
  END IF;
  DELETE FROM pigem_private.screening_intake WHERE used_at < now() - interval '24 hours';
  IF (SELECT count(*) FROM pigem_private.screening_intake) >= 50 THEN
    RETURN false;
  END IF;
  INSERT INTO pigem_private.screening_intake(ticket) VALUES (intake_ticket) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO pigem_private.screening_jobs(application_id, revision, ticket, payload)
  VALUES (app_id, rev, intake_ticket, jsonb_build_object(
    'front', COALESCE(app.id_image_url, app.id_front_path),
    'back', COALESCE(app.id_back_image_url, app.id_back_path),
    'full_name', app.full_name, 'birth_date', app.birth_date,
    'id_number', app.id_number, 'id_type', app.id_type))
  ON CONFLICT DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN RETURN false; END IF;
  UPDATE public.applications SET screening = screening || '{"background_state":"queued"}'::jsonb
    WHERE id = app_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.pigem_claim_screening()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE job pigem_private.screening_jobs%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(92163018);
  UPDATE pigem_private.screening_jobs SET state = 'failed', payload = '{}'::jsonb
    WHERE state = 'running' AND attempts >= 2 AND started_at < now() - interval '6 minutes';
  UPDATE public.applications a SET screening = a.screening || '{"background_state":"failed"}'::jsonb
    FROM pigem_private.screening_jobs j WHERE j.application_id = a.id AND j.state = 'failed'
      AND j.revision = a.created_at::text AND a.corrected_copy IS NULL
      AND a.screening->>'background_state' = 'running';
  IF EXISTS (SELECT 1 FROM pigem_private.screening_jobs WHERE state = 'running' AND started_at >= now() - interval '6 minutes') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO job FROM pigem_private.screening_jobs
    WHERE state = 'queued' OR (state = 'running' AND attempts < 2 AND started_at < now() - interval '6 minutes')
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE pigem_private.screening_jobs SET state = 'running', attempts = attempts + 1, started_at = now()
    WHERE id = job.id RETURNING * INTO job;
  UPDATE public.applications SET screening = screening || '{"background_state":"running"}'::jsonb
    WHERE id = job.application_id AND corrected_copy IS NULL AND created_at::text = job.revision;
  RETURN jsonb_build_object('id',job.id,'attempt',job.attempts,'payload',job.payload);
END $$;

CREATE OR REPLACE FUNCTION public.pigem_finish_screening(job_id uuid, job_attempt integer, findings jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE job pigem_private.screening_jobs%ROWTYPE; result_state text;
BEGIN
  SELECT * INTO job FROM pigem_private.screening_jobs WHERE id = job_id FOR UPDATE;
  IF NOT FOUND OR job.state <> 'running' OR job.attempts <> job_attempt THEN RETURN false; END IF;
  result_state := CASE WHEN findings IS NULL THEN 'failed' ELSE 'completed' END;
  UPDATE pigem_private.screening_jobs SET state = result_state, payload = '{}'::jsonb WHERE id = job_id;
  UPDATE public.applications SET screening = screening || jsonb_build_object(
      'background_state',result_state,'background_findings',findings)
    WHERE id = job.application_id AND corrected_copy IS NULL AND created_at::text = job.revision
      AND COALESCE(id_image_url,id_front_path) = job.payload->>'front'
      AND COALESCE(id_back_image_url,id_back_path,'') = COALESCE(job.payload->>'back','')
      AND full_name = job.payload->>'full_name' AND id_number = job.payload->>'id_number'
      AND birth_date IS NOT DISTINCT FROM job.payload->>'birth_date'
      AND id_type = job.payload->>'id_type';
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.pigem_enqueue_screening(text,text),
  public.pigem_claim_screening(), public.pigem_finish_screening(uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_enqueue_screening(text,text),
  public.pigem_claim_screening(), public.pigem_finish_screening(uuid,integer,jsonb) TO service_role;

COMMIT;
