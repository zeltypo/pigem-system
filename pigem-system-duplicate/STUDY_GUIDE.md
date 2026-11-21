# PIGEM Defense Study Guide

## One sentence

PIGEM is a marketing website and fiber application management system that helps staff review application details and submitted documents before manually forwarding an application to the provider.

## Four roles

- Customer: selects a plan, submits details and photos, receives a reference, tracks progress and corrects requested details.
- Agent: claims a pending application, checks the saved findings and original document, requests corrections, registers the verified record in the actual provider portal separately, and records its status.
- Manager: monitors and assigns applications, checks team workload, records real validator outcomes, oversees reports and manages public website content.
- Admin: creates staff, changes system settings, controls maintenance and screening, and reviews logs and service status.

## Follow the code in this order

| File | What to learn |
| --- | --- |
| web/html/index.html and about.html | Public website layout, public navigation and login link. |
| web/html/apply.html | The visible application steps, form controls and document upload. |
| web/js/apply.js | Front-end validation, plan choice, map pin, application submission and reference number. |
| web/js/db.js | Data layer: reads and writes stored applications, staff, documents, notifications and settings. |
| web/js/config.js | Public runtime configuration, plan details, ID rules, status helpers and shared page functions. |
| schema.sql | Tables and triggers. The application row saves current data; original_copy preserves the initial submission; corrected_copy holds the latest correction and history. |
| api/index.py | API routes and worker endpoint. Browser reads public configuration but does not get server secrets. |
| api/_screening_queue.py | ScreeningWorker: reads one stored job, downloads photos, calls the screening pipeline, and saves results. |
| api/_quality.py | Checks objective photo defects, then GPT-6.2 Sol assesses quality and basic application checks. |
| api/_preprocess.py | Applies mathematical image adjustments to a separate reading copy. Does not generate content. |
| api/_idp.py | Azure Document Intelligence sends back extracted fields. |
| api/_ai.py | Compares printed fields and uses GPT-5.4 for preliminary summary and recommendations. |
| api/_openai_client.py | Structured JSON request, limits, model configuration and fallback. |
| web/js/agent.js | Queue, claim, copies, findings, status transitions and corrections. |
| web/js/customer.js | Customer status, correction submission and history. |
| web/js/manager.js | Manager assignment, monitoring, CMS, reports and calendar. |
| web/js/admin.js | Account management, service settings, logs and reports. |
| web/js/dash-ui.js | Shared dashboard interactions, charts, calendar and reports. |
| web/style.css | Shared brand, responsive layouts, status badges, focus styles and form design. |

## The important workflow

1. Customer uploads photos and saves application details.
2. Supabase triggers create a job for that application revision, in the same transaction.
3. The customer receives the reference number and leaves. No AI work makes them wait.
4. Cron calls the server-side worker. The job is claimed using a database lock.
5. The worker downloads the original photo, checks quality, conditionally prepares a reading copy, and sends the appropriate image to Azure.
6. Python compares the extracted fields and produces match/difference/unreadable findings. GPT-5.4 summarizes the statuses without receiving raw names or ID numbers.
7. Confirmed upload defects can trigger an automatic request without an Agent. Other findings are saved and wait for Agent review. If the model fails, review manually.
8. A correction creates a new revision with a new job. It does not replace the original evidence.
9. Encoding means the Agent has manually registered the verified details in Radius. The validator's real decision is external.
10. Staff record the actual decision in PIGEM. The Customer sees the updated state.

## OOP in the project

A class groups related methods and responsibilities. ScreeningWorker groups loading a photo, building findings, saving a preview and processing a job. FieldComparisonEngine contains text matching and rules; OpenAIScreeningService contains guidance and wording. SupabaseTokenVerifier inherits the interface of BaseTokenVerifier. Front-end functions keep DOM and database operations simple.

## Honest timer

A provider's actual processing time cannot be predicted. The queued/running timestamps come from the database. The countdown shows time until the job's retry lease expires. This is not a promise that an AI/IDP result will finish in that many seconds.

## Important questions

- Why use OpenCV? To make an existing picture more readable for OCR while keeping the original untouched. It adjusts contrast and orientation; it does not create a new ID.
- Why use Azure? To obtain the printed fields from an actual document. Python validates the fields; a language model cannot decide approval.
- Why limit the OpenAI prompt? To avoid passing whole application records, reduce costs, and prevent previous uploads from contaminating the current result.
- When is a customer notified of a correction? The system sends a request for an objectively confirmed photo defect. An Agent sends requests for uncertain issues.
- Does our system integrate with the validator database? No. The external provider result is entered manually. Do not claim a live integration.
- What if automatic screening fails? The agent inspects the original manually. Automated findings are advisory, not proof of identity.
- Is this secure and fully production-ready? Not yet. The inherited direct-browser database and public document access require a separate authorization redesign. Use fictional IDs for the evaluation. Manual and live testing remain your responsibility.

See the root README for setup, environment variables, deployment and the ten manual verification steps.
