-- Deletes PIGEM accounts, applications and screening jobs. Storage files and Vault are separate.
BEGIN;

DROP FUNCTION IF EXISTS public.pigem_provision_admin(text,text,text,text);
DROP FUNCTION IF EXISTS public.pigem_create_screening_staff(text,text,text,text,text);
DROP FUNCTION IF EXISTS public.pigem_screening_sign_in(text,text);
DROP FUNCTION IF EXISTS public.pigem_screening_session(text,boolean);
DROP FUNCTION IF EXISTS public.pigem_enqueue_screening(text,text);
DROP FUNCTION IF EXISTS public.pigem_claim_screening();
DROP FUNCTION IF EXISTS public.pigem_finish_screening(uuid,integer,jsonb);

DROP TABLE IF EXISTS
  pigem_private.admin_setup,
  pigem_private.screening_jobs,
  pigem_private.screening_intake,
  pigem_private.screening_staff;

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

COMMIT;
