-- ============================================================================
-- PIGEM FIBER INTERNET APPLICATION & AI-ASSISTED SCREENING SYSTEM
-- FILE: pigem-system-duplicate/schema-drop.sql (Annotated Study Version)
--
-- PURPOSE:
--   Wipes all PIGEM database functions, private staff/queue tables, public
--   portal tables, and storage policies so the database can be rebuilt cleanly.
--
-- NOTE ON STORAGE FILES:
--   Supabase blocks direct SQL DELETE on storage.objects when files exist.
--   To empty uploaded ID files, go to:
--   Supabase Dashboard -> Storage -> Select Bucket -> (⋮) -> Empty bucket.
-- ============================================================================

BEGIN;

-- 1. Drop RPC functions first because they depend on the tables below.
DROP FUNCTION IF EXISTS public.pigem_provision_admin(text, text, text, text);
DROP FUNCTION IF EXISTS public.pigem_create_screening_staff(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.pigem_screening_sign_in(text, text);
DROP FUNCTION IF EXISTS public.pigem_screening_session(text, boolean);
DROP FUNCTION IF EXISTS public.pigem_enqueue_screening(text, text);
DROP FUNCTION IF EXISTS public.pigem_claim_screening();
DROP FUNCTION IF EXISTS public.pigem_finish_screening(uuid, integer, jsonb);

-- 2. Drop private security & background queue tables (in pigem_private schema).
DROP TABLE IF EXISTS
  pigem_private.admin_setup,
  pigem_private.screening_jobs,
  pigem_private.screening_intake,
  pigem_private.screening_staff
CASCADE;

-- 3. Drop all 13 public application & portal tables.
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

-- 4. Drop storage bucket access policies (re-created by schema.sql).
DROP POLICY IF EXISTS "Allow public access to website-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow access to documents" ON storage.objects;

COMMIT;
