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

Background screening is configured automatically when the Supabase URL,
service-role key, and worker secret are present. There is no separate enable
flag. The scheduler still has to be installed and active. On the same Supabase
project, the schema reset keeps the scheduler and Vault secret.

## Environment setup

Copy the names from `.env.example` into Vercel Project Settings under
Environment Variables. Select Production and redeploy after making changes.
Keep secrets server-side and mark them Sensitive in Vercel.

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project Connect dialog for the URL and Settings → API Keys for the legacy anon and service_role keys. The service_role key is server-only. |
| `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY` | Azure Document Intelligence resource → Keys and Endpoint. |
| `OPENAI_API_KEY` | OpenAI Platform → API keys for the project with model access and billing. `OPENAI_MODEL` defaults to `gpt-5.4`. |
| `SMTP_USER`, `SMTP_PASSWORD` | Gmail address and its Google Account app password. Set `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=465`. |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA Admin → v2 checkbox site registration. Add your deployed hostname to the allowed domains. |
| `APP_BASE_URL` | The full deployed site URL, beginning with `https://`. |
| `SCREENING_WORKER_SECRET` | Generate with `python -c "import secrets; print(secrets.token_hex(32))"`. Use the same value in Supabase Vault under `pigem_screening_worker_secret`. This authenticates scheduler calls. |

For a new project, open Supabase SQL Editor and run
`schedule-background-screening.sql` after updating its deployment URL and adding
the Vault secret. The schedule runs every minute. For a different Supabase
project, update the public project URL and anon key in `web/js/config.js` too.

## Run locally

Use Node.js and Python. From the repository root, copy `.env.example` to
`.env.local` and fill in the values for your development project. Run
`npx vercel dev` and open the local URL it prints. Vercel Dev uses the routing in
`vercel.json` for the web pages and FastAPI routes. The production scheduler calls
the production URL and does not require a local browser.

The SQL copies under `pigem-system-duplicate` include detailed comments. Run the
root SQL files for setup. `tmp` and `.venv` are local folders. If `tmp` contains a
Git worktree, remove that worktree with `git worktree remove` after saving its
changes before deleting the folder.
