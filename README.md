# PIGEM Internet Service Application System

Public application website and Customer, Agent, Manager, and Admin portals.

## Project Structure
- `web/html`: Public pages and Customer, Agent, Manager, and Admin portals.
- `web/js`: Frontend logic, OpenCV.js pre-processing, sessions, reports, and data access.
- `web/style.css`: Shared styles.
- `api`: FastAPI serverless routes (`index.py`), Azure AI Document Intelligence IDP (`_idp.py`), NLP validation & GPT-5.4 reasoning (`_ai.py`, `_openai_client.py`), authentication (`_auth.py`, `_access.py`), and SMTP notifications (`_mailer.py`).
- `schema.sql`: Complete fresh database setup.
- `schema-drop.sql`: Removes the PIGEM tables when explicitly run.

## 4-Step IDP Screening Architecture
1. **Step 1 (Pre-processing — Browser OpenCV.js):** Runs the uploaded ID images through OpenCV (`enhanceAgentIdPhoto` in `web/js/agent.js`) to detect card corners, auto-crop, perspective-straighten (deskew), and enhance contrast (CLAHE + unsharp mask) before upload.
2. **Step 2 (IDP Extraction — Azure AI Document Intelligence):** Sends the cleaned images to `/api/screen` (`api/_idp.py`), which calls Azure Document Intelligence (`prebuilt-idDocument`, or optional Nanonets OCR-3) to extract structured JSON fields, confidence scores, MRZ data, and authenticity signals.
3. **Step 3 (NLP Validation — `api/_ai.py`):** Applies lightweight deterministic regex/NLP rules to compare applicant fields (including Filipino compound surnames and Tagalog/English dates) and validate ID number format/checksums (including ICAO 9303 MRZ check digits), 18+ age eligibility, and expiration dates.
4. **Step 4 (LLM Reasoning — OpenAI GPT-5.4):** Passes the validated JSON with sensitive ID numbers masked (`********3456`) to `gpt-5.4` (`api/_openai_client.py`) via strict JSON schema to generate clear Findings, Tampering Flags, Recommendations (`approve`, `reject`, or `manual_review`), and polite customer correction messages.

## Environment Variables (Vercel)
Configure the following in Vercel Project Settings → Environment Variables:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_BASE_URL`
- `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY` (Azure AI Document Intelligence `prebuilt-idDocument`)
- `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5.4`, `OPENAI_REASONING_EFFORT=low`
- `RECAPTCHA_SECRET_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`
