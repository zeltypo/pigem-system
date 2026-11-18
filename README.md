# PIGEM

Public application form and Customer, Agent, Manager, and Admin portals.

## Fresh setup or reset

1. To reset an existing demo, run `schema-drop.sql` in Supabase SQL Editor.
   This deletes PIGEM accounts, applications, and screening jobs. Keep any
   records you need before running it. Start directly at step 2 for a new database.
2. Run `schema.sql`. Copy the `admin_setup_code` from the result.
3. Deploy this code, open `/setup-accounts.html`, and create the Admin using the
   setup code and the username and password you choose. The code expires after
   24 hours and is consumed when Admin creation succeeds.
4. Sign in as Admin and create Agents and Managers from the Admin portal.
   Staff sign in with the username and password entered on the form. They do
   not need an email account or a separate enrollment query.

A reset in the same Supabase project keeps Storage files, Supabase Auth users,
Vault secrets, and the Cron schedule. Vercel variables are managed separately.
The legacy portal database policies are broad. Use fictional data for evaluation.

## Background screening

Customers receive the reference number once the application is saved. The worker
queues new CAPTCHA-verified submissions and runs OpenCV preparation, Azure
extraction, local validation, and OpenAI wording. The Admin sees progress, and
the Agent and Manager see saved findings. Older applications and corrections
are outside the automatic intake implemented in this version.

On the existing configured project, a schema reset does not change the scheduler
or worker secrets. For a new project, configure the Production variables
`SUPABASE_SERVICE_ROLE_KEY`, `SCREENING_WORKER_SECRET`, and
`SCREENING_BACKGROUND_ENABLED=true`. Put the same worker secret in Supabase
Vault as `pigem_screening_worker_secret`, then run
`schedule-background-screening.sql` after updating its deployment URL.
Keep the existing Supabase URL and anon key, Azure, OpenAI, SMTP, and CAPTCHA
configuration on the server as appropriate.

The SQL copies under `pigem-system-duplicate` explain the same install and reset
steps. Use the root SQL files for setup.
