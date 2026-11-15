# Third-test handoff — 15 November 2026

For the current screening flow, fresh schema and demo steps, see [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md). The notes below record the earlier workspace state.

## Current status

These are local changes, not a deployed release. They have not been tested with a paid OpenAI request or real user accounts. Do not describe this build as error-free or production-ready.

The tracked project is the repository root. `pigem-system-duplicate` is the commented learning copy. The pre-existing untracked nested `pigem-system/` directory was left untouched and excluded from deployment to avoid shipping a stale third copy.

## Simple screening flow

1. `_quality.py` measures image quality and prepares preview crops.
2. `_openai_client.py` sends the original front/back images to OpenAI once. It requests strict JSON and does not switch providers.
3. `_ai.py` checks the returned structure, compares printed details against the form, and builds factual guidance. Form names and numbers are not passed to the image reader, reducing confirmation bias.
4. `_screening.py` saves the evidence and comparisons. A failed save returns failure. Missing or unreadable fields require manual review, including an unprinted student-ID birth date.
5. `agent.js` displays the latest result. The Agent remains responsible for correction requests and recording provider decisions.

Set `OPENAI_API_KEY` and `OPENAI_MODEL` only on the server. Choose an available model supporting image input, Chat Completions and strict JSON Schema. No model is silently selected or escalated. A configured key is not proof of available credit, model access or OCR accuracy. The health response explicitly reports configuration only.

The old Gemini/OpenRouter module and provider fallback chain were removed. Existing SMTP, Supabase and reCAPTCHA settings still apply. The standard-library OpenAI client adds no dependency. No credentials are saved in this repository.

## Fixed or changed locally

- Customer correction inputs survive background polling.
- Agent review forms are no longer rebuilt by polling or closed after status updates.
- Notifications remain unread until individually viewed or explicitly marked all read.
- Report and ID print previews wait for a user click instead of opening a blocking print dialog automatically.
- Separate Front and Back download buttons provide an alternative when browsers block the second automatic download.
- Internal logos no longer navigate to the public website; the account drawer retains Back to Website.
- Screening cards wrap long text. Actual responsive layout still needs browser testing.
- Latest screening overrides cached badges. Unchecked or partial fields do not default to matched.
- Unavailable screening does not report an overall match. Duplicate clicks are guarded. Fake progress percentages were removed.
- Document fetches are restricted to the configured Supabase storage origin.
- Unused tester endpoints were removed from the application API. `test.html` remains self-contained and uses its existing QA storage. `test3.html` uses a separate round ID and storage object, preserving previous results.

## Release blockers discovered

Live read-only inspection found `Allow all` public policies on account/application tables and both storage buckets. This allows access beyond the portal's visible role controls. The Python authentication helper also accepts missing/invalid credentials as public, and the frontend uses custom account/session records. Replacing only the policies would break the existing workflow; a coordinated Supabase Auth and authorization migration is required before real customer use.

The apparent home-page CAPTCHA is a timed client interaction, not proof of server-verified reCAPTCHA. The API no longer reports CAPTCHA success after a network failure, but the full CAPTCHA flow still requires replacement and end-to-end tests.

Do not add a paid API key to an unrestricted public deployment until server authentication, endpoint authorization and abuse controls are in place. Do not use real ID documents for evaluation under the current policies.

`schema.sql` begins with destructive DROP TABLE statements. It is a reset script, not a safe migration. It was not run. No live accounts, applications, policies, buckets or QA results were deleted or changed.

Supabase's advisor also reported leaked-password protection disabled. Its limited advisory output did not establish that the existing permissive policies were secure.

## Validation

- `python -m unittest discover -s tests -v`: nine offline regression cases passed.
- `node tests/frontend-regression.cjs`: correction preservation, notification opening, non-automatic printing, stale-badge replacement, unknown-field handling and actual agent template rendering passed.
- `python -m compileall -q api`: passed.
- `node --check` on all main frontend scripts: passed.
- Browser visual preview was denied by the browser permission gate. No visual/mobile verification is claimed.
- Installing missing Python runtime dependencies was blocked by network DNS access. Full FastAPI/OpenCV runtime integration was not run locally.
- OpenAI live OCR accuracy, Vercel runtime, email delivery, cross-device QA synchronization and the full account/correction workflow remain unverified.

Use `/test3` for the sixteen manual third-test cases after deploying to an appropriate test environment. A checked item must mean actually tested, not simply changed in code.

## Manuscript reconciliation

The proposal's scope keeps screening advisory and actual provider encoding/approval outside the system. Preserve that boundary.

Replace outdated references to local PaddleOCR, Ollama and Qwen2.5 with the implemented OpenAI vision extraction, Python comparison/guidance and Vercel-hosted FastAPI workflow once deployed and tested. Retain OpenCV as image processing. Explain the network/API-credit dependency and manual fallback. Describe current authentication shortcomings rather than claiming Supabase Auth already protects every role. Area-keyword screening is an advisory, not actual provider facility confirmation.

Do not claim PDF/video ratings demonstrate source-code maintainability or database security. IT experts need the relevant technical evidence and access tests. Use the approved respondent definitions; do not relabel faculty as customers just to fill quotas.
