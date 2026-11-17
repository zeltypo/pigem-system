CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'pigem-background-screening',
  '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://pigem-seven.vercel.app/api/screen/worker',
    headers := jsonb_build_object('Authorization', 'Bearer ' || decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  )
  FROM vault.decrypted_secrets WHERE name = 'pigem_screening_worker_secret';
  $job$
);
