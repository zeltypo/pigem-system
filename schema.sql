DROP POLICY IF EXISTS "Allow public access to website-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow access to documents" ON storage.objects;

DROP TABLE IF EXISTS public.system_logs CASCADE;
DROP TABLE IF EXISTS public.login_history CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.provider_updates CASCADE;
DROP TABLE IF EXISTS public.corrections CASCADE;
DROP TABLE IF EXISTS public.screenings CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.applications CASCADE;
DROP TABLE IF EXISTS public.agent_links CASCADE;
DROP TABLE IF EXISTS public.website_content CASCADE;
DROP TABLE IF EXISTS public.system_settings CASCADE;
DROP TABLE IF EXISTS public.plans CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

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
  id_cropped_url TEXT,
  id_back_cropped_url TEXT,
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

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

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
ON CONFLICT (id) DO UPDATE SET public = true;

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
  ('1900', 'Plan 1900', 500, 1900.00, 'Fiber for your home', false, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  speed = EXCLUDED.speed,
  price = EXCLUDED.price,
  tag = EXCLUDED.tag,
  featured = EXCLUDED.featured,
  active = EXCLUDED.active;

INSERT INTO public.system_settings (id, ai_enabled, maintenance_mode, maintenance_message)
VALUES ('main', true, false, '')
ON CONFLICT (id) DO UPDATE SET
  ai_enabled = EXCLUDED.ai_enabled,
  maintenance_mode = EXCLUDED.maintenance_mode;

INSERT INTO public.website_content (id, data) VALUES (
  'main',
  '{"logo_image": "black-logo-white-mode.png", "dark_logo_image": "white-logo-dark-mode.png", "hero_slide_count": 3, "hero_slides": [], "about_slides": [], "client_images": ["Clients/client-infus8.png", "Clients/client-radius.png", "Clients/client-maxcyc.png"], "announcement": {"active": false, "headline": "", "body": ""}}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;
