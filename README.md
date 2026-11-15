# PIGEM Internet Service Application System

Plain HTML, CSS and JavaScript frontend; Python FastAPI backend on Vercel; Supabase database/storage; OpenAI-assisted document screening.

Read [THIRD_TEST_NOTES.md](THIRD_TEST_NOTES.md) for changes, checks and deployment blockers. This is a third-test candidate, not a production certification.

## Project layout

- `web/html/`: public pages, Customer, Agent, Manager and Admin portals.
- `web/js/`: page behavior, shared dashboard controls, API calls and database access.
- `web/style.css`: shared responsive styles.
- `api/index.py`: application API routes.
- `api/_quality.py`: image-quality checks and preview crops.
- `api/_openai_client.py`: one bounded OpenAI image/text request.
- `api/_ai.py`: OCR schema, field comparisons and screening guidance.
- `api/_screening.py`: document retrieval and saved screening results.
- `api/_auth.py`, `api/_mailer.py`: existing authentication helper and notifications; see release blockers.
- `pigem-system-duplicate/`: learning copy with additional defense comments; excluded from deployment.
- `test.html`: independent previous-round QA checklist.
- `test3.html` (`/test3`): independent third-round QA checklist, separate saved state.
- `tests/`: offline regression tests, excluded from deployment.

The pre-existing nested `pigem-system/` directory is not the tracked project root and is excluded from deployment.

## OpenAI configuration

OpenAI screening is off by default. On an isolated demo preview using fictional records, set `OPENAI_DEMO_SCREENING_ENABLED=true`, `OPENAI_API_KEY` and `OPENAI_MODEL` on the server. Choose an API-project model that supports images, Chat Completions and strict JSON Schema. Pending documents are checked automatically while an Agent or Manager portal is open. Unavailable evidence is shown for manual review. The recording script and screen list are in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

Keep the existing Supabase, SMTP, reCAPTCHA and `APP_BASE_URL` settings. Never put an OpenAI key or Supabase service-role key in browser code. Do not enable paid calls on an unrestricted public deployment before fixing authorization and abuse controls.

## Validation commands

```text
python -m unittest discover -s tests -v
node tests/frontend-regression.cjs
python -m compileall -q api
```

These checks do not establish live OCR accuracy, browser rendering, cross-device synchronization, email delivery or production security.

## Database setup

- `schema.sql` is the fresh-install baseline for a dedicated fictional-data demo project. It stops at the first existing PIGEM table and rolls back on error.
- `schema-upgrade.sql` is the additive upgrade for an existing database. It adds the cropped-image columns and enforces the single-Admin rule if the index is missing.
- The portal's legacy database permissions still require replacement before real customer use. Neither SQL file was executed against a cloud database.
