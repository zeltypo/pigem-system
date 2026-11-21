CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Before executing this file, create/reuse the Vault secret named
-- pigem_screening_worker_secret, with the SAME value as SCREENING_WORKER_SECRET.
-- Set the deployment URL below. Do not include the actual secret in this file.

SELECT cron.schedule(
  'pigem-screening-worker',
  '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://YOUR-EXISTING-DEPLOYMENT.vercel.app/api/screen/worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='pigem_screening_worker_secret' LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $job$
);
