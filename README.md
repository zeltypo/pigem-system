# PIGEM Internet Service Application System

Plain HTML, CSS and JavaScript frontend; Python FastAPI backend on Vercel; Supabase database/storage; manual document review.

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
- `tests/`: offline regression tests, excluded from deployment.

## OpenAI configuration

Staff compare ID photos with the application by hand. The browser still checks photo quality during uploads. The Agent can also read ID text in the browser with Tesseract.js. The text stays in the review window and staff confirm the details. OpenAI GPT-6 Luna is used only to help rewrite staff correction messages.

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
