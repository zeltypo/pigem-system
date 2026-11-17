



BEGIN;

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
