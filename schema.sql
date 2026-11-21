
BEGIN;


DROP FUNCTION IF EXISTS public.pigem_provision_admin(text, text, text, text);
DROP FUNCTION IF EXISTS public.pigem_create_screening_staff(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.pigem_screening_sign_in(text, text);
DROP FUNCTION IF EXISTS public.pigem_screening_session(text, boolean);
DROP FUNCTION IF EXISTS public.pigem_enqueue_screening(text, text);
DROP FUNCTION IF EXISTS public.pigem_claim_screening();
DROP FUNCTION IF EXISTS public.pigem_finish_screening(uuid, integer, jsonb);
DROP FUNCTION IF EXISTS public.pigem_screening_progress(uuid, integer, text);

DROP TABLE IF EXISTS
  pigem_private.admin_setup,
  pigem_private.screening_jobs,
  pigem_private.screening_intake,
  pigem_private.screening_staff
CASCADE;

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
  public.users,
  public.qa_tester_sync
CASCADE;

DROP POLICY IF EXISTS "Allow public access to website-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow access to documents" ON storage.objects;



CREATE TABLE public.users (
  id                  TEXT PRIMARY KEY,
  username            TEXT UNIQUE NOT NULL,
  email               TEXT UNIQUE,
  full_name           TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'customer'
                        CHECK (role IN ('admin', 'manager', 'agent', 'customer')),
  phone               TEXT,
  password_hash       TEXT,
  password_changed_at TIMESTAMPTZ DEFAULT now(),
  password_history    JSONB NOT NULL DEFAULT '[]'::jsonb,
  session_token       TEXT,
  active              BOOLEAN NOT NULL DEFAULT true,
  activated           BOOLEAN NOT NULL DEFAULT true,
  activation_code     TEXT,
  reset_code          TEXT,
  avatar_url          TEXT,
  intro               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_username ON public.users (username);
CREATE UNIQUE INDEX idx_users_username_lower ON public.users (lower(username));
CREATE UNIQUE INDEX idx_users_single_admin ON public.users (role) WHERE role = 'admin';
CREATE INDEX idx_users_role ON public.users (role);


CREATE TABLE public.plans (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  speed    INTEGER NOT NULL,          -- Speed in Mbps (e.g., 100, 300, 500)
  price    NUMERIC(10, 2) NOT NULL,   -- Monthly price in PHP (e.g., 1000.00)
  tag      TEXT DEFAULT 'Fiber for your home',
  featured BOOLEAN NOT NULL DEFAULT false,
  active   BOOLEAN NOT NULL DEFAULT true
);


CREATE TABLE public.system_settings (
  id                  TEXT PRIMARY KEY,
  ai_enabled          BOOLEAN NOT NULL DEFAULT true,
  maintenance_mode    BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.website_content (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.agent_links (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  link_code   TEXT,
  agent_id    TEXT,
  agent_email TEXT,
  agent_name  TEXT,
  note        TEXT DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.applications (
  id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ref_no                      TEXT UNIQUE NOT NULL,
  reference_no                TEXT,

  customer_id                 TEXT,
  agent_id                    TEXT,
  agent_link_code             TEXT,
  assigned_agent              TEXT,

  plan                        TEXT,
  plan_id                     TEXT,
  plan_name                   TEXT,

  first_name                  TEXT,
  middle_name                 TEXT,
  last_name                   TEXT,
  full_name                   TEXT NOT NULL,
  customer_name               TEXT,
  birth_date                  TEXT,
  phone                       TEXT NOT NULL,
  phone_alt                   TEXT,
  email                       TEXT NOT NULL,

  house_no                    TEXT,
  house_suffix                TEXT,
  unit_no                     TEXT,
  unit_type                   TEXT DEFAULT 'House',
  floor_no                    TEXT,
  building_name               TEXT DEFAULT 'N/A',
  street                      TEXT,
  subdivision                 TEXT DEFAULT 'N/A',
  barangay                    TEXT,
  city                        TEXT,
  province                    TEXT,
  landmark                    TEXT,
  address_line                TEXT,
  lat                         DOUBLE PRECISION DEFAULT 14.3294,
  lng                         DOUBLE PRECISION DEFAULT 120.9367,
  latitude                    DOUBLE PRECISION,
  longitude                   DOUBLE PRECISION,

  id_type                     TEXT NOT NULL,
  id_number                   TEXT NOT NULL,
  id_front_path               TEXT,
  id_back_path                TEXT,
  id_image_url                TEXT,
  id_back_image_url           TEXT,
  cropped_id_path             TEXT,
  id_cropped_url              TEXT DEFAULT '',
  id_back_cropped_url         TEXT DEFAULT '',
  cropped_id_url              TEXT,
  cropped_back_url            TEXT,

  remarks                     TEXT,
  agree_tu                    BOOLEAN NOT NULL DEFAULT false,

  original_copy               JSONB,
  original_submission         JSONB,
  corrected_copy              JSONB,
  has_correction              BOOLEAN NOT NULL DEFAULT false,

  screening                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_result                   JSONB,
  ai_log                      JSONB NOT NULL DEFAULT '[]'::jsonb,

  status                      TEXT NOT NULL DEFAULT 'Pending Review' CHECK (status IN ('Pending Review','Under Agent Review','Encoding','Approved','Rejected','Needs Correction')),
  correction_note             TEXT,
  correction_fields           JSONB NOT NULL DEFAULT '[]'::jsonb,
  validator_raw_remark        TEXT,
  correction_declined         BOOLEAN NOT NULL DEFAULT false,
  correction_declined_reason  TEXT,
  correction_declined_at      TIMESTAMPTZ,
  last_correction_reminder_at TIMESTAMPTZ,

  agent_remarks               TEXT,
  provider_ref                TEXT,
  provider_remarks            TEXT,
  customer_instruction        TEXT,
  encoded                     BOOLEAN NOT NULL DEFAULT false,
  encoded_proof               TEXT,
  encoding_proof_url          TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_applications_email ON public.applications (email);
CREATE INDEX idx_applications_status ON public.applications (status);
CREATE INDEX idx_applications_created_at ON public.applications (created_at DESC);
CREATE INDEX idx_applications_agent_status ON public.applications (assigned_agent, status);
CREATE INDEX idx_applications_customer ON public.applications (customer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.pigem_validate_status()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status='Pending Review' AND NEW.status='Under Agent Review') OR
    (OLD.status='Pending Review' AND NEW.status='Needs Correction' AND current_user IN ('postgres','service_role') AND NEW.screening->>'auto_correction_sent'='true') OR
    (OLD.status='Under Agent Review' AND NEW.status IN ('Encoding','Needs Correction')) OR
    (OLD.status='Encoding' AND NEW.status IN ('Approved','Rejected','Needs Correction')) OR
    (OLD.status='Needs Correction' AND NEW.status IN ('Pending Review','Under Agent Review','Rejected'))
  ) THEN RAISE EXCEPTION 'Invalid application status change: % to %',OLD.status,NEW.status; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pigem_status_transition BEFORE UPDATE OF status ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.pigem_validate_status();


CREATE TABLE public.documents (
  id                BIGSERIAL PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  id_type           TEXT,
  id_number         TEXT,
  front_image_url   TEXT,
  back_image_url    TEXT,
  cropped_front_url TEXT,
  cropped_back_url  TEXT,
  doc_type          TEXT,
  file_path         TEXT,
  version           TEXT NOT NULL DEFAULT 'original',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.screenings (
  id                BIGSERIAL PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  document_id       BIGINT REFERENCES public.documents(id) ON DELETE SET NULL,
  quality_passed    BOOLEAN DEFAULT true,
  overall_match     BOOLEAN DEFAULT true,
  blur_score        DOUBLE PRECISION DEFAULT 0,
  brightness        DOUBLE PRECISION DEFAULT 0,
  glare_pct         DOUBLE PRECISION DEFAULT 0,
  extracted_fields  JSONB DEFAULT '{}'::jsonb,
  field_comparisons JSONB DEFAULT '{}'::jsonb,
  notes             JSONB DEFAULT '[]'::jsonb,
  summary           TEXT,
  quality           JSONB,
  ocr               JSONB,
  comparisons       JSONB,
  ai_remark         TEXT,
  status            TEXT NOT NULL DEFAULT 'completed',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.corrections (
  id                BIGSERIAL PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  agent_id          TEXT,
  issue_note        TEXT NOT NULL,
  customer_response JSONB,
  status            TEXT NOT NULL DEFAULT 'Pending Customer',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.provider_updates (
  id                   BIGSERIAL PRIMARY KEY,
  application_id       TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  recorded_by          TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  provider_ref         TEXT,
  provider_status      TEXT NOT NULL,
  provider_remark      TEXT,
  customer_instruction TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT,
  email      TEXT,
  role       TEXT,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  target_tab TEXT,
  target_id  TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX idx_notifications_email ON public.notifications (email);


CREATE TABLE public.login_history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT,
  username   TEXT,
  email      TEXT,
  role       TEXT,
  action     TEXT NOT NULL DEFAULT 'login',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE public.system_logs (
  id             BIGSERIAL PRIMARY KEY,
  actor_username TEXT,
  actor_email    TEXT,
  action         TEXT NOT NULL,
  detail         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);



ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_content  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corrections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on users"            ON public.users            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on plans"            ON public.plans            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on system_settings"  ON public.system_settings  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on website_content"  ON public.website_content  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on agent_links"      ON public.agent_links      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on applications"     ON public.applications     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on documents"        ON public.documents        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on screenings"       ON public.screenings       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on corrections"      ON public.corrections      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on provider_updates" ON public.provider_updates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on notifications"    ON public.notifications    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on login_history"    ON public.login_history    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on system_logs"      ON public.system_logs      FOR ALL USING (true) WITH CHECK (true);

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



INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES
  ('website-assets', 'website-assets', true, 52428800),
  ('documents',      'documents',      true, 52428800)
ON CONFLICT (id) DO UPDATE
SET public          = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

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
  ('1400', 'Plan 1400', 300, 1400.00, 'Most Chosen',         true,  true),
  ('1900', 'Plan 1900', 500, 1900.00, 'Fiber for your home', false, true);

INSERT INTO public.system_settings (id, ai_enabled, maintenance_mode, maintenance_message)
VALUES ('main', true, false, '');

INSERT INTO public.website_content (id, data) VALUES (
  'main',
  '{"logo_image": "black-logo-white-mode.png", "dark_logo_image": "white-logo-dark-mode.png", "hero_slide_count": 3, "hero_slides": [], "about_slides": [], "client_images": ["Clients/client-infus8.png", "Clients/client-radius.png", "Clients/client-maxcyc.png"], "announcement": {"active": false, "headline": "", "body": ""}}'::jsonb
);



CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS pigem_private;
REVOKE ALL ON SCHEMA pigem_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS pigem_private.screening_staff (
  username       text PRIMARY KEY CHECK (username = lower(username)),
  staff_id       text NOT NULL UNIQUE,
  role           text NOT NULL CHECK (role IN ('admin', 'agent', 'manager')),
  password_hash  text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  attempts       integer NOT NULL DEFAULT 0,
  attempt_window timestamptz NOT NULL DEFAULT now(),
  token_hash     text,
  expires_at     timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS screening_staff_token_hash
  ON pigem_private.screening_staff (token_hash)
  WHERE token_hash IS NOT NULL;

REVOKE ALL ON pigem_private.screening_staff FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.pigem_screening_sign_in(
  login_username text,
  login_password text
)
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

  SELECT * INTO staff
  FROM pigem_private.screening_staff
  WHERE username = lower(login_username)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT staff.active THEN
    RETURN jsonb_build_object('enrolled', true, 'reason', 'disabled');
  END IF;

  IF staff.attempt_window < now() - interval '30 minutes' THEN
    staff.attempt_window := now();
    staff.attempts := 0;
  END IF;

  IF staff.attempts >= 5 THEN
    RETURN jsonb_build_object('enrolled', true, 'reason', 'locked', 'locked_until', staff.attempt_window + interval '30 minutes');
  END IF;

  IF login_password IS NULL
     OR octet_length(login_password) NOT BETWEEN 1 AND 72
     OR extensions.crypt(login_password, staff.password_hash) IS DISTINCT FROM staff.password_hash THEN
    UPDATE pigem_private.screening_staff
    SET attempts       = staff.attempts + 1,
        attempt_window = CASE WHEN staff.attempts + 1 >= 5 THEN now() ELSE staff.attempt_window END
    WHERE username = staff.username;

    IF staff.attempts + 1 >= 5 THEN
      RETURN jsonb_build_object('enrolled', true, 'reason', 'locked', 'locked_until', now() + interval '30 minutes');
    END IF;
    RETURN jsonb_build_object('enrolled', true, 'reason', 'wrong_password');
  END IF;

  token := 'pigem_staff_' || encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE pigem_private.screening_staff
  SET attempts       = 0,
      attempt_window = now(),
      token_hash     = encode(extensions.digest(token, 'sha256'), 'hex'),
      expires_at     = now() + interval '2 hours'
  WHERE username = staff.username;

  RETURN jsonb_build_object(
    'token',    token,
    'staff_id', staff.staff_id,
    'role',     staff.role
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.pigem_screening_session(
  session_token  text,
  revoke_session boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  staff pigem_private.screening_staff%ROWTYPE;
BEGIN
  IF session_token IS NULL OR session_token !~ '^pigem_staff_[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO staff
  FROM pigem_private.screening_staff
  WHERE token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    AND active
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF revoke_session THEN
    UPDATE pigem_private.screening_staff
    SET token_hash = NULL,
        expires_at = NULL
    WHERE username = staff.username
      AND token_hash = staff.token_hash;
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object('id', staff.staff_id, 'role', staff.role);
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_screening_sign_in(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pigem_screening_session(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_screening_sign_in(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_screening_session(text, boolean) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.pigem_create_screening_staff(
  admin_token    text,
  staff_username text,
  staff_name     text,
  staff_password text,
  staff_role     text
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
  VALUES (
    new_id,
    lower(staff_username),
    staff_role,
    extensions.crypt(staff_password, extensions.gen_salt('bf', 12))
  );

  RETURN jsonb_build_object('id', new_id, 'username', staff_username, 'role', staff_role);
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_create_screening_staff(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_create_screening_staff(text, text, text, text, text) TO anon, authenticated;



CREATE TABLE pigem_private.screening_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  revision text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed','superseded')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (application_id, revision)
);
CREATE INDEX idx_screening_queue ON pigem_private.screening_jobs(state, created_at);
REVOKE ALL ON pigem_private.screening_jobs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pigem_private.application_revision(a public.applications)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(a.corrected_copy->>'submitted_at',''), NULLIF(a.corrected_copy->>'resubmitted_at',''), a.created_at::text)
$$;

CREATE OR REPLACE FUNCTION pigem_private.queue_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  rev text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.corrected_copy IS NOT DISTINCT FROM OLD.corrected_copy THEN RETURN NEW; END IF;
  END IF;
  IF NEW.status NOT IN ('Pending Review','Under Agent Review') THEN RETURN NEW; END IF;
  rev := pigem_private.application_revision(NEW);
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE id='main' AND ai_enabled) THEN
    NEW.screening := COALESCE(NEW.screening,'{}'::jsonb) || '{"state":"manual_fallback","background_state":"failed","manual_fallback":true,"summary":"Review documents manually."}'::jsonb;
    RETURN NEW;
  END IF;
  NEW.screening := COALESCE(NEW.screening,'{}'::jsonb) - 'background_findings' - 'browser_check' - 'background_revision' - 'auto_correction_sent' - 'openai_response_id' - 'manual_fallback' - 'correction_photo_sides' - 'started_at' - 'deadline_at' - 'finished_at' - 'triage' - 'summary' - 'final_recommendation';
  NEW.screening := NEW.screening || jsonb_build_object('state','queued','background_state','queued','queued_at',now(),'phase','Waiting for document check','revision',rev,'eta_seconds',0);
  NEW.ai_result := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pigem_private.record_application_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE rev text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.corrected_copy IS NOT DISTINCT FROM OLD.corrected_copy THEN RETURN NEW; END IF;
  END IF;
  rev := pigem_private.application_revision(NEW);
  UPDATE pigem_private.screening_jobs SET state='superseded',finished_at=now()
  WHERE application_id=NEW.id AND revision<>rev AND state IN ('queued','running');
  IF NEW.screening->>'background_state' <> 'queued' THEN RETURN NEW; END IF;
  INSERT INTO pigem_private.screening_jobs(application_id,revision)
  VALUES (NEW.id,rev) ON CONFLICT (application_id,revision) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER pigem_prepare_screening BEFORE INSERT OR UPDATE OF corrected_copy
ON public.applications FOR EACH ROW EXECUTE FUNCTION pigem_private.queue_application();
CREATE TRIGGER pigem_record_screening AFTER INSERT OR UPDATE OF corrected_copy
ON public.applications FOR EACH ROW EXECUTE FUNCTION pigem_private.record_application_job();

CREATE OR REPLACE FUNCTION public.pigem_enqueue_screening(app_id text, intake_ticket text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM pigem_private.screening_jobs j WHERE j.application_id=app_id)
$$;

CREATE OR REPLACE FUNCTION public.pigem_claim_screening()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  job pigem_private.screening_jobs%ROWTYPE;
  a public.applications%ROWTYPE;
  c jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(92163018);
  UPDATE pigem_private.screening_jobs SET state='failed',finished_at=now()
  WHERE state='queued' AND created_at<now()-interval '20 minutes';
  UPDATE pigem_private.screening_jobs SET state='failed',finished_at=now()
  WHERE state='running' AND attempts>=2 AND started_at<now()-interval '6 minutes';
  UPDATE public.applications a0 SET screening = a0.screening || jsonb_build_object(
    'state','manual_fallback','background_state','failed','manual_fallback',true,
    'summary','Document check could not finish. Review manually.','eta_seconds',0)
  FROM pigem_private.screening_jobs j WHERE j.application_id=a0.id
    AND j.revision=pigem_private.application_revision(a0) AND j.state='failed'
    AND a0.screening->>'background_state' IN ('running','queued');
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE id='main' AND ai_enabled) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM pigem_private.screening_jobs WHERE state='running' AND started_at>=now()-interval '6 minutes') THEN RETURN NULL; END IF;
  SELECT j.* INTO job FROM pigem_private.screening_jobs j
  JOIN public.applications a0 ON a0.id=j.application_id
  WHERE j.revision=pigem_private.application_revision(a0)
    AND a0.status IN ('Pending Review','Under Agent Review')
    AND (j.state='queued' OR (j.state='running' AND j.attempts<2 AND j.started_at<now()-interval '6 minutes'))
  ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE pigem_private.screening_jobs SET state='running',attempts=attempts+1,started_at=now()
  WHERE id=job.id RETURNING * INTO job;
  SELECT * INTO a FROM public.applications WHERE id=job.application_id;
  c := COALESCE(a.corrected_copy,'{}'::jsonb);
  UPDATE public.applications SET screening=screening || jsonb_build_object(
    'background_state','running','state','layer1_running','phase','Checking documents',
    'started_at',job.started_at,'deadline_at',job.started_at+interval '6 minutes','eta_seconds',0), updated_at=now()
  WHERE id=a.id;
  RETURN jsonb_build_object('id',job.id,'application_id',a.id,'attempt',job.attempts,'revision',job.revision,
    'customer_email',COALESCE(NULLIF(c->>'contact_email',''),a.email),'reference_no',a.ref_no,
    'payload',jsonb_build_object(
      'front',COALESCE(NULLIF(c->>'id_image_url',''),NULLIF(c->>'id_front_path',''),a.id_image_url,a.id_front_path),
      'back',COALESCE(NULLIF(c->>'id_back_image_url',''),NULLIF(c->>'id_back_path',''),a.id_back_image_url,a.id_back_path),
      'full_name',COALESCE(c->>'full_name',a.full_name),'birth_date',COALESCE(c->>'birth_date',a.birth_date),
      'id_number',COALESCE(c->>'id_number',a.id_number),'id_type',COALESCE(c->>'id_type',a.id_type)));
END $$;

CREATE OR REPLACE FUNCTION public.pigem_screening_progress(job_id uuid, job_attempt integer, stage text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE phase_label text;
BEGIN
  phase_label := CASE stage WHEN 'quality_done' THEN 'Photo assessment completed'
    WHEN 'photo_preparation' THEN 'Preparing ID photos' WHEN 'extraction' THEN 'Reading ID details'
    WHEN 'comparison' THEN 'Comparing application details' WHEN 'recommendation' THEN 'Preparing recommendation' ELSE NULL END;
  IF phase_label IS NULL THEN RETURN false; END IF;
  UPDATE public.applications a SET screening=a.screening||jsonb_build_object('phase',phase_label)
  FROM pigem_private.screening_jobs j WHERE j.id=job_id AND j.attempts=job_attempt AND j.state='running'
    AND j.application_id=a.id AND j.revision=pigem_private.application_revision(a)
    AND a.status IN ('Pending Review','Under Agent Review');
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.pigem_finish_screening(job_id uuid, job_attempt integer, findings jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  job pigem_private.screening_jobs%ROWTYPE;
  a public.applications%ROWTYPE;
  result_state text;
  triage text;
  auto_correction boolean;
  correction_message text;
  correction_sides jsonb;
BEGIN
  SELECT * INTO job FROM pigem_private.screening_jobs WHERE id=job_id FOR UPDATE;
  IF NOT FOUND OR job.state<>'running' OR job.attempts<>job_attempt THEN RETURN false; END IF;
  SELECT * INTO a FROM public.applications WHERE id=job.application_id FOR UPDATE;
  IF NOT FOUND OR pigem_private.application_revision(a)<>job.revision OR a.status NOT IN ('Pending Review','Under Agent Review') THEN
    UPDATE pigem_private.screening_jobs SET state='superseded',finished_at=now() WHERE id=job_id;
    RETURN false;
  END IF;
  result_state := CASE WHEN findings IS NULL THEN 'failed' ELSE 'completed' END;
  triage := COALESCE(findings->>'triage','yellow');
  auto_correction := COALESCE(triage='red' AND findings->>'autoNeedsCorrection'='true' AND jsonb_array_length(COALESCE(findings->'confirmedDefects','[]'::jsonb))>0, false);
  correction_message := COALESCE(NULLIF(findings->>'suggestedPoliteRemark',''),'Please replace the affected ID photo in My Account with a clear photo of the correct side.');
  correction_sides := COALESCE(findings->'correctionPhotoSides','[]'::jsonb);
  UPDATE pigem_private.screening_jobs SET state=result_state,finished_at=now() WHERE id=job_id;
  UPDATE public.applications SET
    screening=screening || jsonb_build_object(
      'background_state',result_state,'state',CASE WHEN findings IS NULL THEN 'manual_fallback' ELSE 'completed' END,
      'manual_fallback',findings IS NULL OR COALESCE(findings->>'manualFallback'='true',false),'background_revision',job.revision,'background_findings',findings,
      'phase',CASE WHEN findings IS NULL THEN 'Manual review needed' WHEN auto_correction THEN 'Correction requested' ELSE 'Ready for agent review' END,
      'auto_correction_sent',auto_correction,'auto_correction_type',CASE WHEN auto_correction THEN 'pigem_screening' ELSE '' END,
      'correction_photo_sides',CASE WHEN auto_correction THEN correction_sides ELSE '[]'::jsonb END,
      'finished_at',now(),'eta_seconds',0,'triage',triage,'route',COALESCE(findings->>'route',''),
      'summary',COALESCE(findings->>'queueSummary','Document check unavailable. Review manually.'),
      'final_recommendation',COALESCE(findings->>'finalRecommendation','Review original documents manually.'),
      'review_recommended',triage<>'green','overall_match',triage='green',
      'Suggested_remark',COALESCE(findings->>'suggestedPoliteRemark',''),
      'browser_check',jsonb_build_object('reader_version',5,'revision',COALESCE(a.corrected_copy->>'submitted_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'findings',findings)),
    updated_at=now(), status=CASE WHEN auto_correction THEN 'Needs Correction' ELSE a.status END,
    correction_fields=CASE WHEN auto_correction THEN '["id_photo"]'::jsonb ELSE a.correction_fields END,
    correction_note=CASE WHEN auto_correction THEN correction_message ELSE a.correction_note END,
    customer_instruction=CASE WHEN auto_correction THEN correction_message ELSE a.customer_instruction END,
    agent_remarks=CASE WHEN auto_correction THEN correction_message ELSE a.agent_remarks END,
    correction_declined=CASE WHEN auto_correction THEN false ELSE a.correction_declined END,
    ai_result=jsonb_build_object('overall_status',CASE WHEN triage='green' THEN 'Verified' WHEN auto_correction THEN 'Needs Correction' ELSE 'Needs Review' END,'triage',triage,'route',findings->>'route',
      'name_match',EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(findings->'fields','[]'::jsonb)) f WHERE f->>'key'='name' AND f->>'status'='match'),
      'birth_date_match',EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(findings->'fields','[]'::jsonb)) f WHERE f->>'key'='birth_date' AND f->>'status'='match'),
      'id_number_match',EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(findings->'fields','[]'::jsonb)) f WHERE f->>'key'='id_number' AND f->>'status'='match'),
      'issues',COALESCE(findings->'aiFindings','[]'::jsonb)||COALESCE(findings->'tamperingFlags','[]'::jsonb)),
    id_cropped_url=COALESCE(findings#>>'{stages,photoPreparation,front,preview_data_url}',''),
    id_back_cropped_url=COALESCE(findings#>>'{stages,photoPreparation,back,preview_data_url}',''),
    ai_log=COALESCE(ai_log,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('at',now(),'who','Document check','text',COALESCE(findings->>'queueSummary','Manual review needed.'))),
    original_copy=CASE WHEN a.corrected_copy IS NULL AND findings IS NOT NULL THEN COALESCE(original_copy,'{}'::jsonb)||jsonb_build_object('screening_findings',findings) ELSE original_copy END,
    original_submission=CASE WHEN a.corrected_copy IS NULL AND findings IS NOT NULL THEN COALESCE(original_submission,'{}'::jsonb)||jsonb_build_object('screening_findings',findings) ELSE original_submission END
  WHERE id=job.application_id;
  IF auto_correction THEN
    INSERT INTO public.notifications(user_id,email,role,title,message,target_tab,target_id)
    VALUES (a.customer_id,COALESCE(a.corrected_copy->>'contact_email',a.email),'customer',
      'Update needed for application '||a.ref_no,correction_message,'tab-apps',a.id);
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.pigem_enqueue_screening(text,text),public.pigem_claim_screening(),public.pigem_finish_screening(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_enqueue_screening(text,text),public.pigem_claim_screening(),public.pigem_finish_screening(uuid,integer,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pigem_screening_progress(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_screening_progress(uuid,integer,text) TO service_role;



CREATE TABLE pigem_private.admin_setup (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON pigem_private.admin_setup FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pigem_provision_admin(
  setup_code     text,
  admin_username text,
  admin_name     text,
  admin_password text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  setup  pigem_private.admin_setup%ROWTYPE;
  new_id text;
BEGIN
  IF setup_code IS NULL OR setup_code !~ '^[0-9a-f]{48}$' THEN
    RAISE EXCEPTION 'Enter the setup code returned by schema.sql.';
  END IF;

  IF admin_username IS NULL OR admin_username !~ '^[A-Za-z0-9_.]{3,30}$'
     OR admin_name IS NULL OR length(trim(admin_name)) NOT BETWEEN 1 AND 200
     OR admin_password IS NULL OR octet_length(admin_password) NOT BETWEEN 8 AND 72 THEN
    RAISE EXCEPTION 'Check your Admin details. Password must be 8 to 72 bytes.';
  END IF;

  SELECT * INTO setup
  FROM pigem_private.admin_setup
  WHERE singleton
  FOR UPDATE;

  IF NOT FOUND
     OR setup.expires_at <= now()
     OR setup.code_hash <> encode(extensions.digest(setup_code, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'The Admin setup code is invalid, expired, or already used.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') THEN
    RAISE EXCEPTION 'An Admin account already exists.';
  END IF;

  new_id := gen_random_uuid()::text;

  INSERT INTO public.users (id, username, full_name, role, active, activated)
  VALUES (new_id, admin_username, trim(admin_name), 'admin', true, true);

  INSERT INTO pigem_private.screening_staff (staff_id, username, role, password_hash)
  VALUES (
    new_id,
    lower(admin_username),
    'admin',
    extensions.crypt(admin_password, extensions.gen_salt('bf', 12))
  );

  DELETE FROM pigem_private.admin_setup WHERE singleton;
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_provision_admin(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_provision_admin(text, text, text, text) TO anon, authenticated;

-- Resolve an approved referral without returning personal profile records.
CREATE OR REPLACE FUNCTION public.pigem_resolve_referral(referral_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object('code', l.code, 'agent_id', u.id,
    'assigned_agent', CASE WHEN coalesce(u.username,'')<>'' THEN '@'||ltrim(u.username,'@') ELSE u.email END)
  FROM public.agent_links l
  JOIN public.users u ON (l.agent_id=u.id OR (coalesce(u.username,'')<>'' AND lower(ltrim(coalesce(l.agent_email,''),'@'))=lower(ltrim(u.username,'@')))
    OR lower(l.agent_email)=lower(u.email))
  WHERE l.code=upper(trim(referral_code)) AND l.code LIKE 'REF-%' AND l.active
    AND u.role='agent' AND u.active IS DISTINCT FROM false
    AND NOT (l.code='REF-CAV01' AND coalesce(l.agent_email,'')='agent@demo.test')
  ORDER BY l.id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.pigem_resolve_referral(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_resolve_referral(text) TO anon, authenticated;

-- Protect referral writes using the same active staff sessions as the rest of PIGEM.
-- Legacy staff can use their current portal session until migrated to verified staff credentials.
CREATE OR REPLACE FUNCTION public.pigem_referral_actor(verified_token text, portal_token text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; actor_id text;
BEGIN
  actor := public.pigem_screening_session(verified_token, false);
  IF actor IS NOT NULL THEN RETURN actor->>'id'; END IF;
  IF coalesce(portal_token,'')='' THEN RETURN NULL; END IF;
  SELECT u.id INTO actor_id FROM public.users u
  WHERE u.session_token=portal_token AND u.active AND u.role IN ('agent','manager')
    AND NOT EXISTS (SELECT 1 FROM pigem_private.screening_staff s WHERE s.staff_id=u.id);
  RETURN actor_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pigem_referral_actor(text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pigem_request_referral(verified_token text, portal_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE agent public.users%ROWTYPE; link public.agent_links%ROWTYPE; new_code text;
BEGIN
  SELECT * INTO agent FROM public.users WHERE id=public.pigem_referral_actor(verified_token,portal_token) AND active AND role='agent' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sign in as an agent to request a link'; END IF;
  SELECT * INTO link FROM public.agent_links WHERE code LIKE 'REF-%' AND
    (agent_id=agent.id OR lower(ltrim(coalesce(agent_email,''),'@'))=lower(ltrim(agent.username,'@')) OR lower(agent_email)=lower(agent.email))
    ORDER BY active DESC, created_at ASC LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(link); END IF;
  new_code := 'REF-'||upper(substr(encode(extensions.digest(agent.id,'sha256'),'hex'),1,24));
  INSERT INTO public.agent_links(code,agent_id,agent_email,agent_name,active,note)
  VALUES(new_code,agent.id,'@'||ltrim(agent.username,'@'),agent.full_name,false,'Requested') RETURNING * INTO link;
  RETURN to_jsonb(link);
END;
$$;
CREATE OR REPLACE FUNCTION public.pigem_approve_referral(referral_code text, verified_token text, portal_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=public.pigem_referral_actor(verified_token,portal_token) AND active AND role='manager') THEN
    RAISE EXCEPTION 'Sign in as a manager to approve a link';
  END IF;
  UPDATE public.agent_links SET active=true,note='Approved' WHERE code=referral_code AND code LIKE 'REF-%' AND NOT active;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.pigem_request_referral(text,text), public.pigem_approve_referral(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_request_referral(text,text), public.pigem_approve_referral(text,text,text) TO anon, authenticated;

-- Existing one-time registration invitations remain compatible; referral changes use the RPCs.
DROP POLICY IF EXISTS "Allow all on agent_links" ON public.agent_links;
DROP POLICY IF EXISTS "Read agent links" ON public.agent_links;
DROP POLICY IF EXISTS "Manage registration invitations" ON public.agent_links;
CREATE POLICY "Read agent links" ON public.agent_links FOR SELECT USING (true);
CREATE POLICY "Manage registration invitations" ON public.agent_links FOR ALL
USING (code LIKE 'INV-%') WITH CHECK (code LIKE 'INV-%');

CREATE OR REPLACE FUNCTION public.pigem_assign_referral()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE referral jsonb;
BEGIN
  IF coalesce(NEW.agent_link_code, '') <> '' THEN
    referral := public.pigem_resolve_referral(NEW.agent_link_code);
    IF referral IS NULL THEN RAISE EXCEPTION 'Application link is unavailable'; END IF;
    NEW.agent_link_code := referral->>'code';
    NEW.agent_id := referral->>'agent_id';
    NEW.assigned_agent := referral->>'assigned_agent';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pigem_assign_referral ON public.applications;
CREATE TRIGGER pigem_assign_referral BEFORE INSERT ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.pigem_assign_referral();

-- Remove only the known sample referral if it has no linked application.
DELETE FROM public.agent_links l WHERE l.code='REF-CAV01' AND l.agent_email='agent@demo.test'
AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.agent_link_code=l.code);

CREATE OR REPLACE FUNCTION public.pigem_change_verified_password(verified_token text, current_password text, new_password text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; staff pigem_private.screening_staff%ROWTYPE;
BEGIN
  actor := public.pigem_screening_session(verified_token,false);
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in again to change your password'; END IF;
  SELECT * INTO staff FROM pigem_private.screening_staff WHERE staff_id=actor->>'id' AND active FOR UPDATE;
  IF NOT FOUND OR current_password IS NULL OR octet_length(current_password) NOT BETWEEN 1 AND 72
    OR extensions.crypt(current_password,staff.password_hash) IS DISTINCT FROM staff.password_hash
    THEN RAISE EXCEPTION 'Current password is incorrect'; END IF;
  IF new_password IS NULL OR length(new_password)<8 OR octet_length(new_password)>72
     OR new_password !~ '[A-Z]' OR new_password !~ '[a-z]' OR new_password !~ '[0-9]' OR new_password !~ '[^A-Za-z0-9]'
    THEN RAISE EXCEPTION 'New password does not meet the password requirements'; END IF;
  IF new_password=current_password THEN RAISE EXCEPTION 'Choose a different password'; END IF;
  UPDATE pigem_private.screening_staff SET password_hash=extensions.crypt(new_password,extensions.gen_salt('bf',12))
    WHERE staff_id=staff.staff_id;
  UPDATE public.users SET password_changed_at=now() WHERE id=staff.staff_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.pigem_change_verified_password(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_change_verified_password(text,text,text) TO anon, authenticated;

COMMIT;


WITH setup AS MATERIALIZED (
  SELECT encode(extensions.gen_random_bytes(24), 'hex') AS code
), saved AS (
  INSERT INTO pigem_private.admin_setup (code_hash, expires_at)
  SELECT encode(extensions.digest(code, 'sha256'), 'hex'), now() + interval '24 hours'
  FROM setup
  RETURNING singleton
)
SELECT setup.code AS admin_setup_code
FROM setup CROSS JOIN saved;
