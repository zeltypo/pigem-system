






BEGIN;

SET LOCAL pigem.reset_demo = 'off';

DO $reset$
BEGIN
  IF current_setting('pigem.reset_demo') = 'on' THEN
    DROP TABLE IF EXISTS pigem_private.screening_jobs, pigem_private.screening_intake, pigem_private.screening_staff;
    DROP TABLE IF EXISTS
      public.screenings,
      public.documents,
      public.corrections,
      public.provider_updates,
      public.applications,
      public.agent_links,
      public.notifications,
      public.login_history,
      public.system_logs,
      public.system_settings,
      public.website_content,
      public.plans,
      public.users;
  END IF;
END
$reset$;

CREATE TABLE public.users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer'
    CHECK (role IN ('admin', 'manager', 'agent', 'customer')),
  phone TEXT,
  password_hash TEXT,
  password_changed_at TIMESTAMPTZ DEFAULT now(),
  password_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  session_token TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  activated BOOLEAN NOT NULL DEFAULT true,
  activation_code TEXT,
  reset_code TEXT,
  avatar_url TEXT,
  intro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_username ON public.users (username);

CREATE UNIQUE INDEX idx_users_username_lower ON public.users (lower(username));
CREATE UNIQUE INDEX idx_users_single_admin ON public.users (role) WHERE role = 'admin';
CREATE INDEX idx_users_role ON public.users (role);

CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  speed INTEGER NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  tag TEXT DEFAULT 'Fiber for your home',
  featured BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE public.system_settings (
  id TEXT PRIMARY KEY,
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.website_content (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_links (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  link_code TEXT,
  agent_id TEXT,
  agent_email TEXT,
  agent_name TEXT,
  note TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.applications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ref_no TEXT UNIQUE NOT NULL,
  reference_no TEXT,
  customer_id TEXT,
  agent_id TEXT,
  agent_link_code TEXT,
  assigned_agent TEXT,
  plan TEXT,
  plan_id TEXT,
  plan_name TEXT,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  full_name TEXT NOT NULL,
  customer_name TEXT,
  birth_date TEXT,
  phone TEXT NOT NULL,
  phone_alt TEXT,
  email TEXT NOT NULL,
  house_no TEXT,
  house_suffix TEXT,
  unit_no TEXT,
  unit_type TEXT DEFAULT 'House',
  floor_no TEXT,
  building_name TEXT DEFAULT 'N/A',
  street TEXT,
  subdivision TEXT DEFAULT 'N/A',
  barangay TEXT,
  city TEXT,
  province TEXT,
  landmark TEXT,
  address_line TEXT,
  lat DOUBLE PRECISION DEFAULT 14.3294,
  lng DOUBLE PRECISION DEFAULT 120.9367,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  id_type TEXT NOT NULL,
  id_number TEXT NOT NULL,
  id_front_path TEXT,
  id_back_path TEXT,
  id_image_url TEXT,
  id_back_image_url TEXT,
  cropped_id_path TEXT,
  id_cropped_url TEXT DEFAULT '',
  id_back_cropped_url TEXT DEFAULT '',
  cropped_id_url TEXT,
  cropped_back_url TEXT,
  remarks TEXT,
  agree_tu BOOLEAN NOT NULL DEFAULT false,
  original_copy JSONB,
  original_submission JSONB,
  corrected_copy JSONB,
  has_correction BOOLEAN NOT NULL DEFAULT false,
  screening JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_result JSONB,
  ai_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'Pending Review',
  correction_note TEXT,
  correction_declined BOOLEAN NOT NULL DEFAULT false,
  correction_declined_reason TEXT,
  correction_declined_at TIMESTAMPTZ,
  last_correction_reminder_at TIMESTAMPTZ,
  agent_remarks TEXT,
  provider_ref TEXT,
  provider_remarks TEXT,
  customer_instruction TEXT,
  encoded BOOLEAN NOT NULL DEFAULT false,
  encoded_proof TEXT,
  encoding_proof_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_applications_email ON public.applications (email);
CREATE INDEX idx_applications_status ON public.applications (status);
CREATE INDEX idx_applications_created_at ON public.applications (created_at DESC);

CREATE TABLE public.documents (
  id BIGSERIAL PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  id_type TEXT,
  id_number TEXT,
  front_image_url TEXT,
  back_image_url TEXT,
  cropped_front_url TEXT,
  cropped_back_url TEXT,
  doc_type TEXT,
  file_path TEXT,
  version TEXT NOT NULL DEFAULT 'original',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.screenings (
  id BIGSERIAL PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  document_id BIGINT REFERENCES public.documents(id) ON DELETE SET NULL,
  quality_passed BOOLEAN DEFAULT true,
  overall_match BOOLEAN DEFAULT true,
  blur_score DOUBLE PRECISION DEFAULT 0,
  brightness DOUBLE PRECISION DEFAULT 0,
  glare_pct DOUBLE PRECISION DEFAULT 0,
  extracted_fields JSONB DEFAULT '{}'::jsonb,
  field_comparisons JSONB DEFAULT '{}'::jsonb,
  notes JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  quality JSONB,
  ocr JSONB,
  comparisons JSONB,
  ai_remark TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.corrections (
  id BIGSERIAL PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  agent_id TEXT,
  issue_note TEXT NOT NULL,
  customer_response JSONB,
  status TEXT NOT NULL DEFAULT 'Pending Customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.provider_updates (
  id BIGSERIAL PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  recorded_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  provider_ref TEXT,
  provider_status TEXT NOT NULL,
  provider_remark TEXT,
  customer_instruction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  email TEXT,
  role TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_tab TEXT,
  target_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX idx_notifications_email ON public.notifications (email);

CREATE TABLE public.login_history (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  email TEXT,
  role TEXT,
  action TEXT NOT NULL DEFAULT 'login',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.system_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_username TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on users" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on plans" ON public.plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on system_settings" ON public.system_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on website_content" ON public.website_content FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on agent_links" ON public.agent_links FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on applications" ON public.applications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on documents" ON public.documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on screenings" ON public.screenings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on corrections" ON public.corrections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on provider_updates" ON public.provider_updates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on notifications" ON public.notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on login_history" ON public.login_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on system_logs" ON public.system_logs FOR ALL USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public) VALUES
  ('website-assets', 'website-assets', true),
  ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public access to website-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow access to documents" ON storage.objects;

CREATE POLICY "Allow public access to website-assets"
  ON storage.objects FOR ALL
  USING (bucket_id = 'website-assets')
  WITH CHECK (bucket_id = 'website-assets');

CREATE POLICY "Allow access to documents"
  ON storage.objects FOR ALL
  USING (bucket_id = 'documents')
  WITH CHECK (bucket_id = 'documents');

INSERT INTO public.plans (id, name, speed, price, tag, featured, active) VALUES
  ('1000', 'Plan 1000', 100, 1000.00, 'Fiber for your home', false, true),
  ('1400', 'Plan 1400', 300, 1400.00, 'Most Chosen', true, true),
  ('1900', 'Plan 1900', 500, 1900.00, 'Fiber for your home', false, true);

INSERT INTO public.system_settings (id, ai_enabled, maintenance_mode, maintenance_message)
VALUES ('main', true, false, '');

INSERT INTO public.website_content (id, data) VALUES (
  'main',
  '{"logo_image": "black-logo-white-mode.png", "dark_logo_image": "white-logo-dark-mode.png", "hero_slide_count": 3, "hero_slides": [], "about_slides": [], "client_images": ["Clients/client-infus8.png", "Clients/client-radius.png", "Clients/client-maxcyc.png"], "announcement": {"active": false, "headline": "", "body": ""}}'::jsonb
);



GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users, public.plans, public.system_settings, public.website_content,
  public.agent_links, public.applications, public.documents, public.screenings,
  public.corrections, public.provider_updates, public.notifications,
  public.login_history, public.system_logs
TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE
  public.agent_links_id_seq, public.documents_id_seq, public.screenings_id_seq,
  public.corrections_id_seq, public.provider_updates_id_seq,
  public.notifications_id_seq, public.login_history_id_seq, public.system_logs_id_seq
TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS pigem_private;
REVOKE ALL ON SCHEMA pigem_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS pigem_private.screening_staff (
  username text PRIMARY KEY CHECK (username = lower(username)),
  staff_id text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('agent', 'manager')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  attempts integer NOT NULL DEFAULT 0,
  attempt_window timestamptz NOT NULL DEFAULT now(),
  token_hash text,
  expires_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS screening_staff_token_hash
  ON pigem_private.screening_staff (token_hash) WHERE token_hash IS NOT NULL;

REVOKE ALL ON pigem_private.screening_staff FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pigem_screening_sign_in(login_username text, login_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  staff pigem_private.screening_staff%ROWTYPE;
  token text;
BEGIN
  IF login_username IS NULL OR length(login_username) NOT BETWEEN 3 AND 30 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO staff FROM pigem_private.screening_staff
    WHERE username = lower(login_username) FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT staff.active THEN RETURN jsonb_build_object('enrolled', true, 'reason', 'disabled'); END IF;
  IF staff.attempt_window < now() - interval '5 minutes' THEN
    staff.attempt_window := now();
    staff.attempts := 0;
  END IF;
  IF staff.attempts >= 5 THEN RETURN jsonb_build_object('enrolled', true, 'reason', 'locked'); END IF;
  IF login_password IS NULL OR octet_length(login_password) NOT BETWEEN 1 AND 72 OR
     extensions.crypt(login_password, staff.password_hash) IS DISTINCT FROM staff.password_hash THEN
    UPDATE pigem_private.screening_staff SET attempts = staff.attempts + 1,
      attempt_window = staff.attempt_window WHERE username = staff.username;
    RETURN jsonb_build_object('enrolled', true, 'reason', 'wrong_password');
  END IF;
  token := 'pigem_staff_' || encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE pigem_private.screening_staff SET attempts = 0, attempt_window = now(),
    token_hash = encode(extensions.digest(token, 'sha256'), 'hex'),
    expires_at = now() + interval '2 hours' WHERE username = staff.username;
  RETURN jsonb_build_object('token', token, 'staff_id', staff.staff_id, 'role', staff.role);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pigem_screening_session(session_token text, revoke_session boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  staff pigem_private.screening_staff%ROWTYPE;
BEGIN
  IF session_token IS NULL OR session_token !~ '^pigem_staff_[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO staff FROM pigem_private.screening_staff
    WHERE token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
      AND active AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF revoke_session THEN
    UPDATE pigem_private.screening_staff SET token_hash = NULL, expires_at = NULL
      WHERE username = staff.username AND token_hash = staff.token_hash;
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('id', staff.staff_id, 'role', staff.role);
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_screening_sign_in(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pigem_screening_session(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_screening_sign_in(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_screening_session(text, boolean) TO anon, authenticated;


ALTER TABLE pigem_private.screening_staff DROP CONSTRAINT IF EXISTS screening_staff_role_check;
ALTER TABLE pigem_private.screening_staff
  ADD CONSTRAINT screening_staff_role_check CHECK (role IN ('admin', 'agent', 'manager'));

CREATE OR REPLACE FUNCTION public.pigem_create_screening_staff(
  admin_token text, staff_username text, staff_name text, staff_password text, staff_role text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  new_id text;
BEGIN
  IF (public.pigem_screening_session(admin_token)->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sign in with your verified Admin password to create staff.';
  END IF;
  IF staff_role IS NULL OR staff_role NOT IN ('agent', 'manager')
     OR staff_username IS NULL OR staff_username !~ '^[A-Za-z0-9_.-]{3,30}$'
     OR staff_name IS NULL OR length(trim(staff_name)) NOT BETWEEN 1 AND 200
     OR staff_password IS NULL OR octet_length(staff_password) NOT BETWEEN 8 AND 72 THEN
    RAISE EXCEPTION 'Check the staff details. Password must be 8 to 72 bytes.';
  END IF;
  new_id := gen_random_uuid()::text;
  INSERT INTO public.users (id, username, full_name, role, active, activated)
    VALUES (new_id, staff_username, trim(staff_name), staff_role, true, true);
  INSERT INTO pigem_private.screening_staff (staff_id, username, role, password_hash)
    VALUES (new_id, lower(staff_username), staff_role,
      extensions.crypt(staff_password, extensions.gen_salt('bf', 12)));
  RETURN jsonb_build_object('id', new_id, 'username', staff_username, 'role', staff_role);
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_create_screening_staff(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_create_screening_staff(text,text,text,text,text) TO anon, authenticated;


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
