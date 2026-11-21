# PIGEM — Fiber Application and Document Review

This is the replacement source copy for the existing PIGEM system. The stack stays the same: HTML, CSS, vanilla JavaScript, Supabase (Postgres and Storage), Python FastAPI on Vercel, OpenCV, Azure Document Intelligence, OpenAI and Gmail SMTP. It does not connect to Radius/RED Fiber; staff manually record the real validator's decisions.

**Read this first:** see REFINEMENT_NOTES.md for this update. JavaScript/Python syntax and local calendar rendering checks passed. No full functional testing, deployment, live database execution, or live provider calls were performed. The existing direct-browser database architecture uses broad access policies and public document URLs. It is not appropriate for real customer identification documents or production use without an authorization/storage redesign. Use fictional IDs and test data for the defense.

## 1. What to copy

```
pigem/
  web/                         HTML, JavaScript and CSS
  api/                         FastAPI and screening services
  pigem-system-duplicate/       commented study copy (ignored)
  .env.example
  .gitignore
  .vercelignore
  vercel.json
  schema.sql
  schema-drop.sql
  screening-update.sql
  schedule-background-screening.sql
  README.md
```

The archive has no Git history, actual .env file, installed packages, build cache or test folders. Extract to Downloads. Back up C:\\pigem-system before replacing anything. Copy the *contents* of pigem into C:\\pigem-system, including hidden configuration files. Keep your original .git folder and existing local .env.local. A normal copy does not delete files absent from the new archive: manually review old files and remove only obsolete tracked files you intended to replace. Do not use a mirror/delete command on your original repository.

Then review changes in the original repository yourself:

```powershell
cd C:\pigem-system
git status
git add .
git commit -m "Rebuild PIGEM application workflow and screening queue"
git push origin main
```

The study duplicate is ignored by the new .gitignore. If it was already tracked, adding an ignore rule alone will not untrack it. After reviewing, you may use `git rm -r --cached pigem-system-duplicate` to untrack only that copy (it remains on your machine). Do not run that command unless the directory was already tracked.

## 2. Existing account, domain and environment variables

You can reuse the existing GitHub repository, Vercel project, Supabase project, Azure resource, OpenAI key, Gmail app password, CAPTCHA site and secret, and worker secret. Copying this source does not revoke them. **Do not create new accounts or regenerate credentials merely because the code changed.** Do not copy a real .env file into GitHub.

The browser obtains public project settings from /api/config.js. It no longer contains the previous project URL or public key. Existing public graphics are loaded from the configured website-assets bucket. On the same Supabase project, those files can remain.

| Variable | Purpose | Action |
| --- | --- | --- |
| SUPABASE_URL | Existing project URL | Keep |
| SUPABASE_ANON_KEY | Existing legacy public anon key | Keep |
| SUPABASE_SERVICE_ROLE_KEY | Server-only worker and QR storage access | Keep secret |
| AZURE_DI_ENDPOINT | Azure Document Intelligence resource | Keep |
| AZURE_DI_KEY | Azure credential | Keep secret |
| OPENAI_API_KEY | Required for the complete two-model screening pipeline | Keep secret |
| OPENAI_MODEL | Recommendation model | gpt-5.4 |
| OPENAI_QUALITY_MODEL | Image and application quality model | gpt-6.2-sol (the account must have access to this exact API model ID) |
| OPENAI_REASONING_EFFORT / OPENAI_QUALITY_EFFORT | Reasoning setting | medium |
| OPENAI_TIMEOUT_SECONDS | Optional model request limit | 45 |
| SMTP_HOST / SMTP_PORT | Gmail SMTP settings | smtp.gmail.com / 465 |
| SMTP_USER / SMTP_PASSWORD / SMTP_FROM_NAME | Gmail sender | Keep, password secret |
| RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET_KEY | Application and login verification | Keep |
| APP_BASE_URL | Existing deployment URL | Keep |
| SCREENING_WORKER_SECRET | Scheduler and phone transfer authentication | Keep exactly the old value |
| LOCATIONIQ_API_KEY | Optional public geocoding token (previously embedded in code) | Add existing value if desired; otherwise map uses its existing fallback |

SCREENING_WORKER_CONCURRENCY, SCREENING_AUTO_CORRECTION and OPENAI_QUALITY_IMAGE_ENABLED are no longer used. The worker claims one job at a time. Azure Document Intelligence alone reads the ID; the two configured OpenAI models assess image quality and produce recommendations. If a required model is unavailable, the Agent reviews manually rather than silently using another model. Existing API keys are reusable.

## 3. Database setup (manual)

**WARNING: schema.sql and schema-drop.sql delete PIGEM tables, application records, staff profiles, notifications and saved screening jobs. Do not run them against production or any database containing needed records.** Export/back up the database and storage first. A clean test database is recommended. No SQL was executed by the author of this copy.

- In a new Supabase project, run root schema.sql in SQL Editor.
- If the previous rebuilt schema is already installed and has records you need, run screening-update.sql instead. It replaces only the screening functions and status validation; it does not drop application data. Back up first and apply before deploying the matching source.
- If you already applied the previous screening update, run only refinement-update.sql before deploying this version. It preserves applications and documents.
- To deliberately reset the old project, optionally run schema-drop.sql first, then run schema.sql. The full schema already includes its own reset.
- Save the one-time admin_setup_code returned by the SQL editor. Open /setup-accounts.html on the deployed site and create the Admin with a username and password. Alternatively use the SQL function pigem_provision_admin with the code and your chosen account details from the SQL editor. The code is a bootstrap safeguard, not a customer activation or employee enrollment. It expires in 24 hours, is consumed on success, and does not require email.
- Admin creates an Agent and a Manager using the Admin portal. They immediately sign in with their assigned username and password. They should not need a separate screening enrollment.
- Customer account activation is separate. For an empty evaluation environment, previous Supabase Auth test users may need to be removed through the Auth dashboard if they conflict with recreated application profiles. Do not delete real users or records.
- Schema creates three plans, a system settings row, default CMS metadata, website-assets and documents buckets. Phone transfer makes its own private temporary bucket on first use.
- Existing website-assets graphics are **not contained in the supplied archive**. Preserve that bucket if staying in the same project. In a new project upload your own original assets using the same paths, including logo and icons, through the Manager CMS or Storage dashboard.
- Remove legacy documents-1 through documents-10 buckets **manually** only after backing up required files and confirming they are no longer needed. Empty and delete via Storage dashboard, not via SQL DELETE on storage.objects. The new code only uses documents. Reset SQL deliberately does not delete storage objects.

Document file names are flat and unique, e.g. PIGEM-12345678-ABCD1234_original_id-front_<uuid>.jpg. The original file is never overwritten. Resubmitted photos use a corrected label with a fresh UUID; enhanced reading previews use the queue job ID. The bucket's 50 MiB limit is per file, not 50 MiB per bucket. The app uses a stricter 12 MB screening limit per photo for predictable processing and transfer.

## 4. Worker setup — essential for automatic screening

The customer saves data and references to Storage images in Supabase. Database triggers prepare or supersede a screening job transactionally when a new application or corrected copy is saved. No browser runs the screening pipeline.

If the old scheduler is still active, inspect its destination and authorization in Supabase Cron. It can continue using the same /api/screen/worker endpoint and worker secret. If not, create/reuse the Supabase Vault secret named pigem_screening_worker_secret with the exact value already set in SCREENING_WORKER_SECRET. Update the placeholder URL in schedule-background-screening.sql and run it manually. The script schedules the worker once per minute; check that only one schedule calls this endpoint. Supabase Cron and pg_net are required. No Vercel cron key is required.

- Each application revision has at most one queue job.
- A claim uses a database lock. Its payload is built from the saved database row, not a browser copy.
- The queue worker reads stored ID photos, performs checks, saves preliminary results, and records completion/failure. A result for an older revision must not overwrite a new revision.
- Exact duplicate front/back photos, blank files, unreadable image files, and objectively tiny images receive an automatic correction in My Account with an in-app notification; Gmail delivery is best effort if configured. All uncertain issues require an Agent. No model can approve, reject or encode service.
- There is no honest way to predict the exact time an external OCR request will complete. Staff see elapsed or queued time and the countdown until the six-minute retry lease expires, not a fabricated completion timer. A failed or expired check switches to manual review. Jobs waiting over 20 minutes are marked for manual review by an active worker. If Cron itself is stopped, restore it or turn screening off for manual operation.
- The worker allows one active job at a time and retries expired claims once. Stage updates are saved to the application; the countdown tracks the real retry deadline, not an estimated AI completion time.

## 5. How the system should be demonstrated

### Customer
Home → select plan → complete the form → save photos and details → receive a reference. Photo quality warnings are advisory, including identical photos; customers can submit or replace them. Track the application in My Account, not the technical screening queue. If the system confirms an obvious upload defect or an Agent requests a correction, update the requested items and resubmit the same application. The original submission remains in its history.

### Agent
Shared Queue → wait for preliminary findings or use manual review when unavailable → claim application → compare the actual original ID image and details → request an exact correction if needed → review the new submission → enter the verified record in the actual Radius portal separately → set Encoding in PIGEM. Encoding means the external validator is still deciding; do not mark Approved yet. Record a returned validator decision after encoding, not before. A rejected submission must have a clear reason. The original/previous/latest copy selector can switch all sections or change only the image or personal detail section.

### Manager
Monitor submissions, workload, agent assignments, status counts, calendars, reports and exports. The Manager may record a real validator decision after an application reaches Encoding or assign/reassign it. The Agent selects specific correction fields. Manage the public site through CMS (banners, assets, about, plans, FAQs, promotion). The system does not automatically obtain decisions from Radius.

### Admin
Create staff, manage availability and maintenance, inspect screening backlog, operational logs, accounts and reports. Admin does not replace the validator or make automatic customer decisions.

## 6. Screening design and cost

The worker first checks objective file defects, then GPT-6.2 Sol assesses actual photo quality and basic application completeness indicators. Sol selects only actual needed operations from an allowlist; OpenCV performs those operations on a separate reading copy. Originals never change. Azure DI reads the original or enhanced photo, Python compares the extracted fields, and GPT-5.4 receives comparison statuses and quality evidence for a summary and recommendation, optionally a suggested remark. If a model fails, manual review remains possible. Red means a confirmed upload defect; yellow means ask an Agent to review; green is preliminary matching evidence, not approval. No generative image editing is used. OpenAI vision receives the ID photo (with EXIF removed); Azure receives the document for extraction. GPT-5.4 receives no raw ID number or ID image. Use fictional IDs until access controls and consent for external processing are reviewed: the inherited public documents bucket and broad database policies are not suitable for real sensitive customer IDs.

The OpenAI wording call receives a compact structured payload of comparison statuses, flags and target field names—not the applicant's name, birth date, ID number, raw OCR text or full image by default. It requests structured JSON, limits output, uses low reasoning effort, and does not chain previous applicant responses. Deterministic findings remain the source of truth; the model's draft message is optional and editable. If OpenAI is not configured, fails or exceeds its budget, the system still has deterministic review guidance. If Azure is unavailable, use manual review.

Original photos remain the evidence. The image-enhancement code does not synthesize or replace printed text, fill missing pixels with generative AI, authenticate an ID or decide it is counterfeit. Use the original for comparison. Independent cropping/contrast adjustments may still affect readability, so an agent must review both.

## 7. Manual verification checklist (you will run these)

1. Setup: schema runs successfully; the three plans exist; only expected buckets exist; the one-time admin code works.
2. Configuration: open /api/health, verify database configuration, Azure, worker, CAPTCHA, SMTP and optional OpenAI indicators. Confirm /api/config.js contains public values only.
3. Public pages: Home, About Us, Customer Login before sign-in; Home, About Us, My Account after sign-in. Check mobile menu and page images.
4. Customer: submit a fictional application, check reference appears without waiting for OCR, confirm both saved original images and application record, activate account, sign in and track.
5. Queue: watch the Agent/Admin job change queued → running → completed/failed. Refresh/opening the same application should not start another request to Azure/OpenAI.
6. Agent: test clear, blurry, duplicate and unreadable fictional ID pictures. Confirm exact duplicate photos trigger a correction without opening an Agent dashboard. Uncertain findings must wait for human review; inspect original vs enhanced images.
7. Correction: update only requested fields, resubmit, verify the same reference, original and previous copies remain intact, and new findings replace only the current revision.
8. Provider: claim and review, mark Encoding after the simulated manual portal registration, record Approved or Rejected with reason from Encoding. Confirm customer notification and status.
9. Manager/Admin: verify workloads, assignment, CMS edits, plans, maintenance, reports, charts, calendar navigation, account creation and notifications. Test desktop, tablet, mobile and keyboard focus.
10. Error paths: disable screening or leave Azure temporarily unavailable; ensure original documents can be reviewed manually. Check duplicate submissions, refresh during screening, two agents claiming at once, stale edits, upload failure, and invalid env settings.

Do not present the application as verified, production-ready, legally compliant, or error-free until the appropriate checks have actually been completed. For local development, install Python and Node and use the existing project environment values in .env.local; run npx vercel dev from the repository root yourself. No local tests are included or executed in this handoff.

## 8. Deployment checklist for your existing project

Review changes first. Push only when you are ready. Keep Vercel root as the repository root; the existing vercel.json routes static pages, JS, CSS and the Python API. Keep the existing environment variables, set the new optional flags, and redeploy. If running a brand-new project instead, configure its own URL/key/secret, upload website assets, add allowed CAPTCHA hostnames, bootstrap admin and install the worker schedule. Reusing the old project requires no new keys.

See the duplicate folder for the study version. Production source is under web and api; do not deploy the duplicate.
