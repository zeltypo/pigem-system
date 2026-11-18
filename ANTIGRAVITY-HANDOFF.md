# PIGEM handoff for Antigravity

Baseline is commit f7a348aa5daaae370ecfad79a8f49b3ec3546c25.
The current main includes the final SQL, Admin provisioning, and worker configuration cleanup.
`secondback` preserves e4cc947 (previous live submission flow).
`backupworkingscreening` preserves bd00498 (final SQL and Admin provisioning
before the configuration cleanup).

## What changed

- Restored the Azure IDP and GPT-5.4 pipeline and fixed fail-closed reCAPTCHA.
  Apply opens directly from Home. The application form requires the real checkbox.
- Added server OpenCV fallback, parallel Azure reads, and review states based on
  the extracted fields. Latest Copy preserves color. Unreadable text is not shown
  as a confirmed mismatch.
- Added stage logs for session, photo preparation, Azure, local validation, and
  OpenAI. Completed findings are saved per submission revision.
- Replaced email-based screening authorization with private username sessions.
  Fresh setup now produces a one-time Admin setup code. The Admin form automatically
  provisions new Agent and Manager accounts.
- Added a private background queue, protected worker, and Admin status list.
  The customer receives the reference as soon as the application is saved.
- Removed SCREENING_BACKGROUND_ENABLED from the worker. The Supabase credentials
  and dedicated worker secret now determine readiness. Added .env.example and
  simplified setup in README.

## What went wrong and what to watch

- Healthy configuration did not prove an authorized request ran. Staff were
  reaching the portal without a verified screening token, so Azure and OpenAI
  had zero calls. A later live check verified both providers and local validation.
- Background jobs initially stayed empty because the applications were submitted
  before the worker deployment. New CAPTCHA-verified applications enter the queue.
  Existing applications and resubmissions still need separate intake.
- A schema reset deletes application records, profiles, and private staff credentials.
  It preserves Storage objects, Vault, and the scheduler. Provision the new Admin
  from the setup code before creating staff.
- The latest schema and provisioning changes were not run against the live database.
  The owner asked to handle functional testing and monitoring.
