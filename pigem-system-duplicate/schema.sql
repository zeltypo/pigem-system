-- ============================================================================
-- PIGEM FIBER INTERNET APPLICATION & AI-ASSISTED SCREENING SYSTEM
-- FILE: pigem-system-duplicate/schema.sql (Simplified & Commented Study Schema)
--
-- HOW THIS SCHEMA WORKS (FOR CAPSTONE DEFENSE STUDY):
--   Section 1: Full Reset (Drops old functions, tables, and policies cleanly)
--   Section 2: Public Portal Tables (13 tables for Users, Plans, Applications, etc.)
--   Section 3: Row-Level Security (RLS) & Table Grants
--   Section 4: Multi-Bucket Storage Setup (website-assets + documents & documents-1..10)
--   Section 5: Default Seed Data (Fiber Plans 1000/1400/1900, System Settings, Logos)
--   Section 6: Private Staff Authentication (bcrypt passwords + 2h session tokens)
--   Section 7: Background AI Screening Queue (Enqueue, Claim, Finish RPCs)
--   Section 8: One-Time Admin Provisioning (Generates 48-char setup code at the end)
--
-- IMPORTANT:
--   0% of table/column/function names or behaviors are altered. This script is
--   100% compatible with the live frontend (web/) and backend (api/).
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: CLEAN RESET (DROP OLD FUNCTIONS, TABLES, AND STORAGE POLICIES)
-- ============================================================================

-- Drop RPC functions before dropping the tables they reference
DROP FUNCTION IF EXISTS public.pigem_provision_admin(text, text, text, text);
DROP FUNCTION IF EXISTS public.pigem_create_screening_staff(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.pigem_screening_sign_in(text, text);
DROP FUNCTION IF EXISTS public.pigem_screening_session(text, boolean);
DROP FUNCTION IF EXISTS public.pigem_enqueue_screening(text, text);
DROP FUNCTION IF EXISTS public.pigem_claim_screening();
DROP FUNCTION IF EXISTS public.pigem_finish_screening(uuid, integer, jsonb);

-- Drop private tables (Admin setup code, screening queue jobs, and staff credentials)
DROP TABLE IF EXISTS
  pigem_private.admin_setup,
  pigem_private.screening_jobs,
  pigem_private.screening_intake,
  pigem_private.screening_staff
CASCADE;

-- Drop public tables (CASCADE removes dependent foreign keys and views automatically)
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

-- Drop old storage policies so they can be recreated cleanly below
DROP POLICY IF EXISTS "Allow public access to website-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow access to documents" ON storage.objects;


-- ============================================================================
-- SECTION 2: PUBLIC PORTAL TABLES (13 TABLES)
-- ============================================================================

-- 2.1 USERS TABLE
-- Stores all 4 portal roles: 'admin', 'manager', 'agent', and 'customer'.
-- Customers sign in via activated email/username; staff sign in via pigem_private.screening_staff.
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

-- Indexes for fast username lookup and enforcing a single Admin account in the system
CREATE INDEX idx_users_username ON public.users (username);
CREATE UNIQUE INDEX idx_users_username_lower ON public.users (lower(username));
CREATE UNIQUE INDEX idx_users_single_admin ON public.users (role) WHERE role = 'admin';
CREATE INDEX idx_users_role ON public.users (role);


-- 2.2 PLANS TABLE
-- Stores the fiber internet plans shown on the homepage and application form.
CREATE TABLE public.plans (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  speed    INTEGER NOT NULL,          -- Speed in Mbps (e.g., 100, 300, 500)
  price    NUMERIC(10, 2) NOT NULL,   -- Monthly price in PHP (e.g., 1000.00)
  tag      TEXT DEFAULT 'Fiber for your home',
  featured BOOLEAN NOT NULL DEFAULT false,
  active   BOOLEAN NOT NULL DEFAULT true
);


-- 2.3 SYSTEM SETTINGS TABLE
-- Single-row table ('main') controlling whether AI screening or maintenance mode is active.
CREATE TABLE public.system_settings (
  id                  TEXT PRIMARY KEY,
  ai_enabled          BOOLEAN NOT NULL DEFAULT true,
  maintenance_mode    BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 2.4 WEBSITE CONTENT TABLE
-- Single-row JSONB store ('main') for CMS items: logos, hero slides, client logos, announcements.
CREATE TABLE public.website_content (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 2.5 AGENT LINKS TABLE
-- Referral codes generated by Agents so customer applications are auto-assigned to that Agent.
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


-- 2.6 APPLICATIONS TABLE (CORE TABLE OF THE SYSTEM)
-- Stores every customer fiber application, address pin, ID image URLs, AI screening JSON,
-- correction resubmissions (corrected_copy), and ISP provider encoding status.
CREATE TABLE public.applications (
  -- Primary & Reference IDs
  id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ref_no                      TEXT UNIQUE NOT NULL,
  reference_no                TEXT,

  -- Ownership & Agent Referral
  customer_id                 TEXT,
  agent_id                    TEXT,
  agent_link_code             TEXT,
  assigned_agent              TEXT,

  -- Selected Fiber Plan
  plan                        TEXT,
  plan_id                     TEXT,
  plan_name                   TEXT,

  -- Applicant Personal Information
  first_name                  TEXT,
  middle_name                 TEXT,
  last_name                   TEXT,
  full_name                   TEXT NOT NULL,
  customer_name               TEXT,
  birth_date                  TEXT,
  phone                       TEXT NOT NULL,
  phone_alt                   TEXT,
  email                       TEXT NOT NULL,

  -- Installation Address & Leaflet Map Coordinates (Cavite default)
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

  -- Submitted Government ID Details & Storage Bucket Image URLs
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

  -- Applicant Notes & Terms Agreement
  remarks                     TEXT,
  agree_tu                    BOOLEAN NOT NULL DEFAULT false,

  -- Original vs. Resubmitted Copies (for Needs Correction comparison)
  original_copy               JSONB,
  original_submission         JSONB,
  corrected_copy              JSONB,
  has_correction              BOOLEAN NOT NULL DEFAULT false,

  -- AI Pre-Screening State & Findings (3-Route Pipeline + Green/Yellow/Red Triage)
  screening                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_result                   JSONB,
  ai_log                      JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Workflow Status & Correction Tracking
  status                      TEXT NOT NULL DEFAULT 'Pending Review',
  correction_note             TEXT,
  correction_declined         BOOLEAN NOT NULL DEFAULT false,
  correction_declined_reason  TEXT,
  correction_declined_at      TIMESTAMPTZ,
  last_correction_reminder_at TIMESTAMPTZ,

  -- Agent & Manager Provider Encoding Fields
  agent_remarks               TEXT,
  provider_ref                TEXT,
  provider_remarks            TEXT,
  customer_instruction        TEXT,
  encoded                     BOOLEAN NOT NULL DEFAULT false,
  encoded_proof               TEXT,
  encoding_proof_url          TEXT,

  -- Audit Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_applications_email ON public.applications (email);
CREATE INDEX idx_applications_status ON public.applications (status);
CREATE INDEX idx_applications_created_at ON public.applications (created_at DESC);


-- 2.7 DOCUMENTS TABLE
-- Tracks original and resubmitted ID document records linked to an application.
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


-- 2.8 SCREENINGS TABLE
-- Historical log table for screening checks linked to an application.
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


-- 2.9 CORRECTIONS TABLE
-- Tracks Agent correction requests and Customer responses.
CREATE TABLE public.corrections (
  id                BIGSERIAL PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  agent_id          TEXT,
  issue_note        TEXT NOT NULL,
  customer_response JSONB,
  status            TEXT NOT NULL DEFAULT 'Pending Customer',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 2.10 PROVIDER UPDATES TABLE
-- Tracks Manager updates after encoding the application into the ISP provider portal.
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


-- 2.11 NOTIFICATIONS TABLE
-- In-app bell notifications for Customers, Agents, Managers, and Admin.
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


-- 2.12 LOGIN HISTORY TABLE
-- Audit trail of user sign-ins and sign-outs across all roles.
CREATE TABLE public.login_history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT,
  username   TEXT,
  email      TEXT,
  role       TEXT,
  action     TEXT NOT NULL DEFAULT 'login',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- 2.13 SYSTEM LOGS TABLE
-- Operational audit log of actions taken by staff and administrators.
CREATE TABLE public.system_logs (
  id             BIGSERIAL PRIMARY KEY,
  actor_username TEXT,
  actor_email    TEXT,
  action         TEXT NOT NULL,
  detail         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- SECTION 3: ROW-LEVEL SECURITY (RLS) & DATA API PERMISSIONS
-- ============================================================================

-- Enable RLS on all 13 public tables
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

-- Demo access policies for public tables (private staff passwords remain locked in pigem_private)
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

-- Grant table and sequence permissions to Supabase Data API roles
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


-- ============================================================================
-- SECTION 4: MULTI-BUCKET STORAGE (website-assets + documents + documents-1..10)
-- ============================================================================
-- Creates 11 document buckets (50 MB = 52,428,800 bytes per file limit).
-- If 'documents' fills up or errors, web/js/db.js automatically falls back
-- to 'documents-1', 'documents-2', ..., 'documents-10'.

INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES
  ('website-assets', 'website-assets', true, 52428800),
  ('documents',      'documents',      true, 52428800),
  ('documents-1',    'documents-1',    true, 52428800),
  ('documents-2',    'documents-2',    true, 52428800),
  ('documents-3',    'documents-3',    true, 52428800),
  ('documents-4',    'documents-4',    true, 52428800),
  ('documents-5',    'documents-5',    true, 52428800),
  ('documents-6',    'documents-6',    true, 52428800),
  ('documents-7',    'documents-7',    true, 52428800),
  ('documents-8',    'documents-8',    true, 52428800),
  ('documents-9',    'documents-9',    true, 52428800),
  ('documents-10',   'documents-10',   true, 52428800)
ON CONFLICT (id) DO UPDATE
SET public          = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

CREATE POLICY "Allow public access to website-assets"
  ON storage.objects FOR ALL
  USING (bucket_id = 'website-assets')
  WITH CHECK (bucket_id = 'website-assets');

CREATE POLICY "Allow access to documents"
  ON storage.objects FOR ALL
  USING (bucket_id IN (
    'documents',
    'documents-1', 'documents-2', 'documents-3', 'documents-4', 'documents-5',
    'documents-6', 'documents-7', 'documents-8', 'documents-9', 'documents-10'
  ))
  WITH CHECK (bucket_id IN (
    'documents',
    'documents-1', 'documents-2', 'documents-3', 'documents-4', 'documents-5',
    'documents-6', 'documents-7', 'documents-8', 'documents-9', 'documents-10'
  ));


-- ============================================================================
-- SECTION 5: DEFAULT SEED DATA (PLANS, SETTINGS, WEBSITE CONTENT)
-- ============================================================================

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


-- ============================================================================
-- SECTION 6: PRIVATE STAFF AUTHENTICATION (pigem_private.screening_staff)
-- ============================================================================
-- Why a private schema?
--   Public tables can be queried by the frontend anon key, so staff password hashes
--   and active session tokens are isolated inside `pigem_private` where `anon` and
--   `authenticated` roles have ZERO direct table access. They can only call the
--   SECURITY DEFINER functions below.

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


-- 6.1 STAFF SIGN-IN FUNCTION
-- Verifies username + bcrypt password, enforces a 5-attempt / 5-minute lockout,
-- and returns a 2-hour bearer token ('pigem_staff_<64 hex chars>').
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
  -- 1. Validate username length
  IF login_username IS NULL OR length(login_username) NOT BETWEEN 3 AND 30 THEN
    RETURN NULL;
  END IF;

  -- 2. Lock the staff row for login attempt check
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

  -- 3. Reset failed-attempt counter if 5 minutes have passed
  IF staff.attempt_window < now() - interval '5 minutes' THEN
    staff.attempt_window := now();
    staff.attempts := 0;
  END IF;

  -- 4. Block sign-in if 5 failed attempts occurred within 5 minutes
  IF staff.attempts >= 5 THEN
    RETURN jsonb_build_object('enrolled', true, 'reason', 'locked');
  END IF;

  -- 5. Compare password against bcrypt hash
  IF login_password IS NULL
     OR octet_length(login_password) NOT BETWEEN 1 AND 72
     OR extensions.crypt(login_password, staff.password_hash) IS DISTINCT FROM staff.password_hash THEN
    UPDATE pigem_private.screening_staff
    SET attempts       = staff.attempts + 1,
        attempt_window = staff.attempt_window
    WHERE username = staff.username;

    RETURN jsonb_build_object('enrolled', true, 'reason', 'wrong_password');
  END IF;

  -- 6. Issue a fresh 2-hour session token and store only its SHA-256 hash
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


-- 6.2 STAFF SESSION VERIFICATION & LOGOUT FUNCTION
-- Checks if a 'pigem_staff_...' token is valid and unexpired, or revokes it on logout.
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

  -- If logging out, clear the stored token hash
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


-- 6.3 ADMIN-ONLY STAFF CREATION FUNCTION
-- Lets a logged-in Admin create new Agent or Manager accounts with private bcrypt credentials.
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
  -- 1. Verify caller holds an active Admin session token
  IF (public.pigem_screening_session(admin_token)->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sign in with your verified Admin password to create staff.';
  END IF;

  -- 2. Validate role, username format, name length, and password length
  IF staff_role IS NULL OR staff_role NOT IN ('agent', 'manager')
     OR staff_username IS NULL OR staff_username !~ '^[A-Za-z0-9_.-]{3,30}$'
     OR staff_name IS NULL OR length(trim(staff_name)) NOT BETWEEN 1 AND 200
     OR staff_password IS NULL OR octet_length(staff_password) NOT BETWEEN 8 AND 72 THEN
    RAISE EXCEPTION 'Check the staff details. Password must be 8 to 72 bytes.';
  END IF;

  -- 3. Insert public profile + private bcrypt password hash
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


-- ============================================================================
-- SECTION 7: BACKGROUND AI SCREENING QUEUE (V2 CONDITIONAL PIPELINE)
-- ============================================================================
-- How the Background Queue works:
--   1. Customer submits an application (or resubmits a Needs Correction form).
--   2. FastAPI calls `pigem_enqueue_screening(app_id, ticket)` which stores a job
--      in `pigem_private.screening_jobs` and marks `applications.screening` as 'queued'.
--   3. Once per minute, Supabase pg_cron calls `/api/screen/worker` on Vercel.
--   4. The worker calls `pigem_claim_screening()` to lock 1 job, runs Stage 1
--      (gpt-6.2-sol Quality Gate) -> Stage 2 (Targeted OpenCV) -> Stage 3 (Azure DI OCR)
--      -> Stage 4 (Deterministic Validation + gpt-5.4 Triage), and calls
--      `pigem_finish_screening()` to save the findings into `public.applications.screening`.

CREATE TABLE IF NOT EXISTS pigem_private.screening_intake (
  ticket  text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON pigem_private.screening_intake FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS pigem_private.screening_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id text NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  revision       text NOT NULL,
  ticket         text NOT NULL UNIQUE,
  payload        jsonb NOT NULL,
  state          text NOT NULL DEFAULT 'queued',
  attempts       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  UNIQUE (application_id, revision)
);
REVOKE ALL ON pigem_private.screening_jobs FROM PUBLIC, anon, authenticated;


-- 7.1 ENQUEUE SCREENING JOB (Supports both initial submissions and customer resubmissions)
CREATE OR REPLACE FUNCTION public.pigem_enqueue_screening(
  app_id        text,
  intake_ticket text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  app       public.applications%ROWTYPE;
  rev       text;
  inserted  uuid;
  front_url text;
  back_url  text;
  c_name    text;
  c_bdate   text;
  c_idnum   text;
  c_idtype  text;
BEGIN
  -- Serialize intake operations with a transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(92163017);

  SELECT * INTO app
  FROM public.applications
  WHERE id = app_id
  FOR UPDATE;

  IF NOT FOUND OR app.status NOT IN ('Pending Review', 'Under Agent Review', 'Needs Correction') THEN
    RETURN false;
  END IF;

  -- Use the resubmitted corrected_copy fields if present; otherwise use original application fields
  IF app.corrected_copy IS NOT NULL AND jsonb_typeof(app.corrected_copy) = 'object' THEN
    front_url := COALESCE(app.corrected_copy->>'id_image_url', app.corrected_copy->>'id_front_path', app.id_image_url, app.id_front_path, '');
    back_url  := COALESCE(app.corrected_copy->>'id_back_image_url', app.corrected_copy->>'id_back_path', app.id_back_image_url, app.id_back_path, '');
    c_name    := COALESCE(app.corrected_copy->>'full_name', app.full_name);
    c_bdate   := COALESCE(app.corrected_copy->>'birth_date', app.birth_date);
    c_idnum   := COALESCE(app.corrected_copy->>'id_number', app.id_number);
    c_idtype  := COALESCE(app.corrected_copy->>'id_type', app.id_type);
    rev       := COALESCE(app.corrected_copy->>'submitted_at', app.corrected_copy->>'resubmitted_at', app.updated_at::text, app.created_at::text);
  ELSE
    front_url := COALESCE(app.id_image_url, app.id_front_path, '');
    back_url  := COALESCE(app.id_back_image_url, app.id_back_path, '');
    c_name    := app.full_name;
    c_bdate   := app.birth_date;
    c_idnum   := app.id_number;
    c_idtype  := app.id_type;
    rev       := COALESCE(app.updated_at::text, app.created_at::text);
  END IF;

  IF front_url = '' THEN
    RETURN false;
  END IF;

  -- If this exact application revision is already queued/completed, return true (idempotent)
  IF EXISTS (
    SELECT 1 FROM pigem_private.screening_jobs
    WHERE application_id = app_id AND revision = rev
  ) THEN
    RETURN true;
  END IF;

  -- Prune intake tickets older than 24 hours and cap daily queue volume at 250
  DELETE FROM pigem_private.screening_intake
  WHERE used_at < now() - interval '24 hours';

  IF (SELECT count(*) FROM pigem_private.screening_intake) >= 250 THEN
    RETURN false;
  END IF;

  -- Record the single-use intake ticket
  INSERT INTO pigem_private.screening_intake(ticket)
  VALUES (intake_ticket)
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Insert the queued screening job with the snapshot payload
  INSERT INTO pigem_private.screening_jobs(application_id, revision, ticket, payload)
  VALUES (
    app_id,
    rev,
    intake_ticket,
    jsonb_build_object(
      'front',      front_url,
      'back',       back_url,
      'full_name',  c_name,
      'birth_date', c_bdate,
      'id_number',  c_idnum,
      'id_type',    c_idtype
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO inserted;

  IF inserted IS NULL THEN
    RETURN false;
  END IF;

  -- Update the application's screening status badge to 'queued'
  UPDATE public.applications
  SET screening = COALESCE(screening, '{}'::jsonb) || jsonb_build_object(
    'background_state', 'queued',
    'state',            'queued',
    'phase',            'Queued for AI Quality & ID Verification',
    'eta_seconds',      30
  )
  WHERE id = app_id;

  RETURN true;
END $$;


-- 7.2 CLAIM NEXT SCREENING JOB (Called once per minute by the background worker)
CREATE OR REPLACE FUNCTION public.pigem_claim_screening()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  job pigem_private.screening_jobs%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(92163018);

  -- 1. Mark jobs that timed out twice (> 6 minutes) as 'failed'
  UPDATE pigem_private.screening_jobs
  SET state   = 'failed',
      payload = '{}'::jsonb
  WHERE state = 'running'
    AND attempts >= 2
    AND started_at < now() - interval '6 minutes';

  UPDATE public.applications a
  SET screening = COALESCE(a.screening, '{}'::jsonb) || '{"background_state":"failed","state":"failed"}'::jsonb
  FROM pigem_private.screening_jobs j
  WHERE j.application_id = a.id
    AND j.state = 'failed'
    AND a.screening->>'background_state' = 'running';

  -- 2. Do not claim a new job if another job is currently running within its 6-minute window
  IF EXISTS (
    SELECT 1 FROM pigem_private.screening_jobs
    WHERE state = 'running' AND started_at >= now() - interval '6 minutes'
  ) THEN
    RETURN NULL;
  END IF;

  -- 3. Pick the oldest queued job (or a timed-out job on attempt 1)
  SELECT * INTO job
  FROM pigem_private.screening_jobs
  WHERE state = 'queued'
     OR (state = 'running' AND attempts < 2 AND started_at < now() - interval '6 minutes')
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 4. Mark job as 'running' and increment attempt count
  UPDATE pigem_private.screening_jobs
  SET state      = 'running',
      attempts   = attempts + 1,
      started_at = now()
  WHERE id = job.id
  RETURNING * INTO job;

  UPDATE public.applications
  SET screening = COALESCE(screening, '{}'::jsonb) || jsonb_build_object(
    'background_state', 'running',
    'state',            'layer1_running',
    'phase',            'Checking Image Quality & Cropping',
    'eta_seconds',      20
  )
  WHERE id = job.application_id;

  RETURN jsonb_build_object(
    'id',             job.id,
    'application_id', job.application_id,
    'attempt',        job.attempts,
    'payload',        job.payload
  );
END $$;


-- 7.3 FINISH SCREENING JOB (Saves final AI + OpenCV + Azure DI findings)
CREATE OR REPLACE FUNCTION public.pigem_finish_screening(
  job_id      uuid,
  job_attempt integer,
  findings    jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  job          pigem_private.screening_jobs%ROWTYPE;
  result_state text;
BEGIN
  SELECT * INTO job
  FROM pigem_private.screening_jobs
  WHERE id = job_id
  FOR UPDATE;

  IF NOT FOUND OR job.state <> 'running' OR job.attempts <> job_attempt THEN
    RETURN false;
  END IF;

  result_state := CASE WHEN findings IS NULL THEN 'failed' ELSE 'completed' END;

  -- Clear job payload once finished and save state
  UPDATE pigem_private.screening_jobs
  SET state   = result_state,
      payload = '{}'::jsonb
  WHERE id = job_id;

  -- Save complete screening findings into public.applications.screening
  UPDATE public.applications
  SET screening = COALESCE(screening, '{}'::jsonb) || jsonb_build_object(
    'background_state',    result_state,
    'state',               result_state,
    'phase',               CASE WHEN result_state = 'completed' THEN 'Verification Complete' ELSE 'Verification Incomplete' END,
    'eta_seconds',         0,
    'triage',              COALESCE(findings->>'triage', 'yellow'),
    'route',               COALESCE(findings->>'route', 'good'),
    'quality_gate',        COALESCE(findings->'qualityGate', '{}'::jsonb),
    'openai_response_id',  COALESCE(findings->>'openaiResponseId', ''),
    'background_findings', findings
  )
  WHERE id = job.application_id;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION
  public.pigem_enqueue_screening(text, text),
  public.pigem_claim_screening(),
  public.pigem_finish_screening(uuid, integer, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.pigem_enqueue_screening(text, text),
  public.pigem_claim_screening(),
  public.pigem_finish_screening(uuid, integer, jsonb)
TO service_role;


-- ============================================================================
-- SECTION 8: ONE-TIME ADMIN SETUP CODE & PROVISIONING
-- ============================================================================
-- Stores the SHA-256 hash of a one-time 48-character hex code (valid for 24h).
-- When the user opens `#admin-setup` on the website and enters this code,
-- `pigem_provision_admin` creates the single Admin account and deletes the code.

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
  -- 1. Check setup code format (48 hex characters)
  IF setup_code IS NULL OR setup_code !~ '^[0-9a-f]{48}$' THEN
    RAISE EXCEPTION 'Enter the setup code returned by schema.sql.';
  END IF;

  -- 2. Check username, full name, and password format
  IF admin_username IS NULL OR admin_username !~ '^[A-Za-z0-9_.]{3,30}$'
     OR admin_name IS NULL OR length(trim(admin_name)) NOT BETWEEN 1 AND 200
     OR admin_password IS NULL OR octet_length(admin_password) NOT BETWEEN 8 AND 72 THEN
    RAISE EXCEPTION 'Check your Admin details. Password must be 8 to 72 bytes.';
  END IF;

  -- 3. Verify the setup code matches the stored SHA-256 hash and has not expired
  SELECT * INTO setup
  FROM pigem_private.admin_setup
  WHERE singleton
  FOR UPDATE;

  IF NOT FOUND
     OR setup.expires_at <= now()
     OR setup.code_hash <> encode(extensions.digest(setup_code, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'The Admin setup code is invalid, expired, or already used.';
  END IF;

  -- 4. Ensure no Admin account already exists
  IF EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') THEN
    RAISE EXCEPTION 'An Admin account already exists.';
  END IF;

  -- 5. Create the Admin public profile and private bcrypt credential
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

  -- 6. Consume (delete) the setup code so it can never be used a second time
  DELETE FROM pigem_private.admin_setup WHERE singleton;
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_provision_admin(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_provision_admin(text, text, text, text) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- SECTION 9: GENERATE & DISPLAY THE ONE-TIME 48-CHAR ADMIN SETUP CODE
-- ============================================================================
-- Copy the `admin_setup_code` value returned by Supabase SQL Editor and paste
-- it into the Provision Admin page (`https://pigem-seven.vercel.app/#admin-setup`).

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
