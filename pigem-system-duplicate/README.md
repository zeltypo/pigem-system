# PIGEM Internet Service Application System

Public application website and Customer, Agent, Manager, and Admin portals.

## Project
- web/html contains the pages and portals.
- web/js contains forms, document checks, sessions, reports, and data access.
- web/style.css contains shared styles.
- api contains FastAPI routes, access checks, email, and OpenAI integration.
- pigem-system-duplicate contains a reference source copy with comments, excluded from deployment.
- schema.sql contains the complete fresh database setup.
- schema-drop.sql removes the PIGEM tables when explicitly run.

## Screening
The Agent browser uses OpenCV and Tesseract to prepare and read each application's photos. OpenAI helps rewrite staff correction messages. Incomplete checks require a retry. Offline events stop active checks. Online events retry open applications. Browser connection indicators cannot guarantee that a remote service is reachable.

## Setup
Use the Vercel routes in vercel.json. Python dependencies are in api/requirements.txt.
Configure Supabase, SMTP, reCAPTCHA, APP_BASE_URL, and OpenAI variables in hosting settings. Keep secret keys out of frontend files.

## Database
Run schema.sql for a fresh setup. For an intentional reset, change pigem.reset_demo from off to on and run the full file once. This deletes PIGEM records. Auth users and Storage files are managed separately.
The schema uses broad demo access policies and is intended for fictional evaluation data.

## Deployment
Production uses zeltypo/pigem-system, main. The backup and backup-2026-11-17-before-cleanup branches preserve main before cleanup. Update backup only when requested.

## Verification limits
Actual ID accuracy and weak-network behavior still require live checks.
Public-submission email needs a verified authentication path.
A saved application remains saved if a later notification fails.
