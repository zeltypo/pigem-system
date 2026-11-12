# PIGEM Web-Based Internet Service Application System - Cloud Capstone Study Guide

Gabay para sa **Capstone Oral Defense** at **Developer Maintenance**: nakalista rito kung paano gumagana ang live cloud system (`C:\pigem-system`), bakit ganito ang architecture ng bawat role at security rule, at paano sagutin ang posibleng tanong ng panel.

---

## 1. Buong Cloud Architecture Overview (Zero Localhost, 24/7 Live)

Ang buong system—kasama ang **Public Website**, **Customer Portal**, **Internal Staff Portals (Agent at Manager)**, **Technical Admin Console**, at **Python FastAPI Backend**—ay naka-host nang buo sa cloud gamit ang **Vercel** at **Supabase**:

1. **Frontend Web Portals (`web/html/*.html`, `web/style.css`, `web/js/*.js`):**
   - Purong **HTML5**, **CSS3**, at **Vanilla JavaScript** na may centralized shared dashboard UI shell (`web/js/dash-ui.js`), validators & popups (`web/js/config.js`), cloud database helpers (`web/js/db.js`), at serverless API wrapper (`web/js/api.js`).
   - Ang lahat ng UI icons (25 verified PNG files) at public images/logos/banners ay galing lamang sa **Supabase Storage** (`website-assets/icons/*.png` at `website-assets/`).
   - Gumagamit ng **Leaflet.js + OpenStreetMap + LocationIQ** (with Nominatim fallback) para sa interactive Cavite service-location map pinning, **Google reCAPTCHA v2** para sa anti-bot protection, at mobile QR capture link (`?qr_upload=1&sid=...`) sa Valid ID upload.
2. **Cloud Database, Auth, at Storage (`Supabase`):**
   - **PostgreSQL (13 Tables):** Nagtatago ng `users`, `plans`, `system_settings`, `website_content`, `agent_links`, `applications`, `documents`, `screenings`, `corrections`, `provider_updates`, `notifications`, `login_history`, at `system_logs`.
   - **Supabase Storage Buckets:** Dalawang buckets—`website-assets` para sa logos, 25 UI icons, hero banners, partner/client showcases, service vehicles, at permits; at `documents` para sa orihinal na Valid ID uploads (front/back), mobile QR captures (`documents/qr-sessions/`), at **OpenCV cropped working copies** (`documents/cropped/`).
3. **Serverless Python Backend (`api/index.py` at helper modules sa Vercel Python Runtime):**
   - **`api/_quality.py` (`OpenCV`)**: Sinusuri ang image sharpness (Laplacian variance), brightness, glare, at contrast, at gumagawa ng 4-corner perspective-cropped at CLAHE-enhanced working copy nang hindi binabago ang original uploaded ID ng customer.
   - **`api/_gemini.py` (`Google Gemini API` + `FieldComparisonEngine`)**: Gumagamit ng `gemini-flash-latest` multimodal Vision OCR para basahin ang document validity (`is_valid_government_id`), pangalan, petsa ng kapanganakan, at ID number sa Philippine Valid IDs. Pagkatapos, ang deterministic Python `FieldComparisonEngine` ang nagko-compare ng customer-entered fields laban sa nabasang text bago gumawa ang Gemini ng **preliminary findings** at **polite plain-language correction draft**.
   - **`api/_screening.py` (`CloudScreeningCoordinator`)**: Tinitiyak ang **Human-in-the-Loop** rule—ang AI findings ay **preliminary** lamang at laging dumadaan sa **Agent review at confirmation** bago ma-markahan ng `Needs Correction` ang application. Kapag naka-disable o unavailable ang AI, automatic ang fallback sa manual review gamit ang original uploaded ID photos.
   - **`api/_mailer.py` (`Gmail SMTP` over TLS/SSL)**: Gumagamit ng OOP `BaseEmailTemplateRenderer` at `CustomerEmailRenderer` (na naka-align ang `From` address sa authenticated `SMTP_USER` upang maiwasan ang bounce at spam filtering) upang magpadala ng malinis at propesyonal na HTML emails **eksklusibo sa `@gmail.com` Customer accounts lamang** (6-digit OTP verification/recovery codes, Reference Number + one-time activation link, RA 10173 privacy-safe correction notices na may 24-hour/72-hour follow-up notice, status updates, at opted-in promotional broadcasts). Automatic nitong ini-skip ang username-only internal accounts dahil **clickable in-system website notifications** (`public.notifications` na may `target_tab` at `target_id`) ang gamit ng Staff at Admin.

---

## 2. Account Identity, Security Sessions, Notifications, at Announcements Architecture

1. **Customers (`@gmail.com` Only + Sariling `username`):**
   - Tanging valid `@gmail.com` email address lamang ang tinatanggap sa Application Form (`web/html/apply.html`), kung saan vine-verify ito gamit ang **6-digit Gmail OTP modal/panel**.
   - Pagka-submit ng bagong application, ipinapadala ang Reference Number at **one-time activation link** (`web/html/activate.html`). Dito pipili ng sariling unique `username` at magse-set ng strong password ang Customer (nagiging hidden ang bawat password requirement rule habang natutupad, at inline na lumalabas ang errors sa ibaba ng bawat field).
   - Sa Customer Login (`web/html/login.html`), maaaring mag-sign in gamit ang `@gmail.com` o `username`, at may self-service **6-digit Gmail OTP Recovery** para sa parehong **Forgot Username** at **Forgot Password** (walang forgot-email self-service; may support contact fallback kung nakalimutan ang Gmail).
   - **Duplicate Application Guard (`dbFindDuplicateCustomerApplication`) & Separate Customer Accounts:** Kapag ang parehong Customer account/email ay nag-submit ng kaparehong plan/location application, automatic itong nire-reject ng system at malinaw na sinasabi ang dahilan. Samantala, ang mga magkaibang Customer `@gmail.com` accounts ay nananatiling magkahiwalay kahit pareho ang gamit na mobile number.
2. **Internal Staff at Single Provisioned Admin (`username`-Only Internal Accounts):**
   - Ang **Agent**, **Manager**, at **Admin** ay gumagamit ng **unique `username`-only credentials** (halimbawa `pigem_admin`, `manager_cavite`, `agent_juan`) na walang external email column sa `public.users`, pang-login lamang sa `/staff-login` at `/admin-login`.
   - **Isa (1) lang ang Admin sa buong system:** Sa unang bukas ng `/admin-login`, lalabas ang **First-Time System Setup** button papuntang `/setup-accounts` upang i-register nang isang beses ang sole Admin `username` account, at permanenteng naka-lock na ang `/setup-accounts` pagkatapos. Walang wrong-password attempt lockout sa `/admin-login` upang hindi ma-lockout ang nag-iisang Admin sa sariling recovery console.
   - **Role-Based Account Management & Access Help:** Ang **Admin** sa `/admin` (`Accounts` tab) ang namamahala ng Managers, Agents, at Customers at humahawak ng **Staff Password Reset Requests** (`Requests` sub-tab mula sa `Don't have access?` sa `/staff-login`). Ang **Manager** naman sa `/manager` ay may modal CRUD din para gumawa, mag-edit, mag-reset ng password, mag-toggle active, at mag-generate ng invite links (`agent-register.html`) para sa **Agents**.
3. **Single-Device Session Lock, 15-Minute Idle Timeout, at Password Reuse Check:**
   - Tinanggal ang cross-device `"Remember Me"` cookie/localStorage token upang hindi lumipat ang session sa ibang device. Gumagamit na ng per-tab **`sessionStorage`** na may DB-backed **`session_token`** (`public.users.session_token`)—kapag nag-login sa ibang device, automatic na mai-invalidate ang lumang session—at may **15-minute inactivity auto-logout** na naglo-logout at nagpapakita ng session-expired notice kapag hindi aktibo sa lahat ng portals (Customer, Agent, Manager, Admin).
   - Pinipigilan ng **`password_history` at `password_changed_at`** ang muling paggamit ng dating password sa Forgot Password at Change Password, at ipinapakita kung gaano katagal na ito huling pinalitan (months, days, o hours ago).
4. **Clickable In-System Website Notifications, Correction Follow-Ups, at Reports:**
   - Gumagamit ang `public.notifications` ng `target_tab` at `target_id` upang kapag pinindot ang notification sa bell panel, automatic na bubukas ang kaukulang tab o modal (`Applications`, `Requests`, `AI/Maintenance`, atbp.).
   - Para sa **Needs Correction** applications, nakakakita ang Customer ng banner at once-per-session login reminder na nagpapaliwanag ng automated **24-hour** (initial) at **72-hour** (final) email reminders, plus `"I choose not to correct"` (`dbDeclineApplicationCorrection`) kung pipiliin ng customer na isara ang application.
   - May pare-parehong **Donut + Horizontal Bar Overview Analytics** at **Reports** tab (`Print`, `Download HTML Report`, `Export CSV`, Daily/Monthly + Date filters) sa **Agent**, **Manager**, at **Admin** consoles via `web/js/dash-ui.js`.
5. **Website Announcements, CMS Slides, at Promotional Offers (`web/html/manager.html` + `web/html/index.html`):**
   - Sa **Manager CMS**, maaaring itakda ng Manager ang **Hero Banner Slide Count (`1`–`4`, default `3`)** at mag-upload ng banner photos nang walang cluttered heading/subtitle inputs, mag-manage ng Plans, Service Vehicles, Permits, at Client/Partner showcases.
   - Kapag nag-publish ng **Announcement / Promo Broadcast**, maaaring i-enable sa homepage banner (`index.html`), mag-send ng HTML promo email sa opted-in `@gmail.com` Customers (`promo_opt_in = true`), at mag-save ng indibidwal na Customer notifications (nang walang shared `role="customer"` leakage).

---

## 3. Folder at File Structure ng System (`C:\pigem-system`)

- **Database & Deployment Config:**
  - `schema.sql` — Fresh PostgreSQL schema (13 `CREATE TABLE` tables, indexes, constraints, seed settings/plans, zero `ALTER TABLE`)
  - `vercel.json` — Cloud static/HTML rewrites (`/`, `/about`, `/apply`, `/login`, `/activate`, `/customer`, `/staff-login`, `/agent-register`, `/agent`, `/manager`, `/admin-login`, `/admin`, `/setup-accounts`) + FastAPI routing (`/api/*`)
- **Frontend Stylesheet (`web/style.css`)** — Unified responsive layout, light/dark mode, accessible contrast, centered security modals, report & chart layouts
- **Frontend Portals (`web/html/` — 14 Pages):**
  - `index.html`, `about.html`, `privacy.html` (Public website)
  - `apply.html` (Guided 18+ application wizard, inline Email OTP modal, map pinning, direct mobile QR capture `?qr_upload=1&sid=...`, pre-submit AI ID screening, duplicate check)
  - `activate.html` (One-time Customer username choice + strong password setup)
  - `login.html` (Customer `@gmail.com`/`username` sign-in + OTP Forgot Username/Password)
  - `customer.html` (3 main statuses, 24h/72h correction banner/modal + `"I choose not to correct"`, clickable notifications)
  - `staff-login.html` & `agent-register.html` (Internal `username`-only login + `Don't have access?` Admin reset request + invite registration)
  - `agent.html` (Overview Donut/Bar analytics, `All`/`Available Queue`/`My Claimed` queues, screening & encoding workflow, `Reports`)
  - `manager.html` (Collapsed-by-default nav, `Manager Overview` charts + recent activities, Application queues, Agent CRUD modals, Plans/CMS with Hero Slide Count `1`–`4`, Broadcasts, `Reports`)
  - `setup-accounts.html`, `admin-login.html`, `admin.html` (Sole Admin provisioning, lockout-free Admin login, Overview + live API health cards + Donut/Bar analytics, modal Staff/Customer CRUD, Staff Reset `Requests` sub-tab, categorized Logs, Maintenance/AI Settings, `Reports`)
- **Frontend JavaScript (`web/js/` — 11 Modules):**
  - `config.js`, `db.js`, `api.js`, `dash-ui.js`, `home.js`, `apply.js`, `login.js`, `customer.js`, `agent.js`, `manager.js`, `admin.js`
- **Serverless Python Backend (`api/`):**
  - `index.py`, `_auth.py`, `_quality.py`, `_gemini.py`, `_screening.py`, `_mailer.py`, `requirements.txt`, `.env.example`

---

## 4. Paano Gumagana ang Programming Concepts sa Code (OOP, Regex, Nested Logic)

### A. Object-Oriented Programming (Abstraction, Inheritance, Encapsulation)
- **Abstract Base & Subclasses sa Email Rendering (`api/_mailer.py`)**: `BaseEmailTemplateRenderer` (shared HTML/button/ref-tag shell) ay mana ng `CustomerEmailRenderer` (OTP, Activation, Correction, Status, Promo).
- **Abstract Base & Encapsulated Engines sa Screening (`api/_quality.py`, `api/_gemini.py`, `api/_screening.py`)**: `BaseVisionProcessor`, `IDImageQualityAnalyzer` (private `__score_quality` / `__crop_card_contour`), `GeminiVisionClient`, `FieldComparisonEngine`, at `CloudScreeningCoordinator`.
- **OOP Validator Hierarchy sa Frontend (`web/js/config.js`)**: Shared input rules (`validatePersonName`, `validateAdultBirthDate` para sa 18+, `validateStrongPassword`, `attachEnterKeyNavigation`) na ginagamit pare-pareho sa Apply, Activate, Login, Customer, Agent, Manager, at Admin forms.

### B. Regular Expressions (Regex)
- **18+ Birthdate & Letters-Only Name (`web/js/config.js`)**: Unicode/ASCII letter check (walang numbers/symbols sa First/Middle/Last name; optional Middle Name nang walang forced `"N/A"`) at 18+ age boundary calculation.
- **Username (`^[a-zA-Z0-9._]{3,30}$`), Customer `@gmail.com` Check (`@gmail.com` strict), at PH Mobile (`^09\d{9}$`)**: Pare-pareho sa SQL `CHECK`, JavaScript inline validation, at Python verification.
- **Plain-Language Sanitization (`api/_gemini.py` & `web/js/agent.js`)**: Tinatanggal ng `_TECH_TERMS_REGEX` ang mga technical terms (`OpenCV`, `Gemini`, `OCR`, `LLM`, `AI`) bago makita ng Applicant/Customer/Staff UI.

### C. Nested Loops at Nested Conditionals
- **Nested Contour Scoring (`api/_quality.py`)** para piliin ang pinaka-malinaw na 4-corner card contour sa cropped ID working copy.
- **Nested Field Comparison & Duplicate Check (`api/_gemini.py`, `web/js/db.js`)**: Multi-token comparison ng Customer name/birthdate/ID laban sa extracted ID text, at plan + coordinate/address comparison sa `dbFindDuplicateCustomerApplication` para i-auto-reject ang same-account duplicate nang hindi pinaghahalo ang magkaibang Customer `@gmail.com` accounts.

---

## 5. End-to-End Application at Screening Flow

1. **Customer Application (`apply.html` + `apply.js`):**
   - Sasagutan ang reCAPTCHA modal (`PIGEM Security Verification`), pipiliin ang Plan, ilalagay ang pangalan (optional Middle Name), 18+ birthdate, OTP-verified `@gmail.com` (sa loob ng inline modal), at mobile numbers, ita-tap ang lokasyon sa map, at mag-a-upload ng Front/Back Valid ID (o mag-s-scan ng QR na diretsong magbubukas ng mobile ID capture screen).
   - Bago i-save, susuriin ng `/api/screen` kung tunay na Philippine government ID ang larawan (`is_valid_government_id`) at kung may same-account duplicate (`dbFindDuplicateCustomerApplication`); kung duplicate ng parehong account, automatic itong mare-reject at ipapaliwanag agad ang dahilan.
   - Kapag valid, mase-save ang application at ma-e-email sa Customer Gmail ang Reference Number + **one-time activation link** patungong `/activate` kung saan pipili ang customer ng sariling `username` at strong password.
2. **Two-Stage Cloud Screening (`api/_screening.py`):**
   - **Stage 1 (`_quality.py`):** Susuriin ang kalinawan at gagawa ng cropped/CLAHE working copy sa `documents/cropped/`.
   - **Stage 2 (`_gemini.py`):** Kukuhanin ng Gemini Vision ang printed text -> iko-compare sa `FieldComparisonEngine` -> gagawa ng preliminary findings at polite correction draft.
3. **Human-in-the-Loop Agent Confirmation (`agent.html` + `agent.js`):**
   - Magki-claim ang Agent gamit ang `@username`, ikukumpara ang extracted fields sa parehong original at cropped ID photos, at magko-confirm ng **Needs Correction** (plain-language email + clickable in-system notification) o mag-e-encode sa ISP portal at magre-record ng provider reference/proof/status (`Approved` / `Rejected`).
4. **Customer Portal Monitoring (`customer.html` + `customer.js`):**
   - Tatlong main status lang ang nakikita: **Processing**, **Approved**, at **Rejected**. Kapag `Needs Correction` (nasa ilalim ng **Processing**), nakakakita ng banner/modal na may paliwanag ng **24h / 72h** email reminders, form para mag-submit ng update, at button na **"I choose not to correct"**.

---

## 6. Separate SQL Reset Query (13 Tables) at Full Database Setup

Kung nais i-reset nang buo ang PostgreSQL schema bago i-paste ang laman ng `schema.sql`, patakbuhin muna ito sa Supabase SQL Editor:

```sql
DROP TABLE IF EXISTS
  public.system_logs,
  public.login_history,
  public.notifications,
  public.provider_updates,
  public.corrections,
  public.screenings,
  public.documents,
  public.applications,
  public.agent_links,
  public.website_content,
  public.system_settings,
  public.plans,
  public.users
CASCADE;
```

Pagkatapos i-run ang reset query, i-run nang buo ang `schema.sql` sa Supabase SQL Editor. Pagkatapos, buksan ang `/admin-login` -> **Provision Admin Account** (`/setup-accounts`) para irehistro ang nag-iisang Admin `username` account, at mag-sign in sa `/admin` upang buuin ang Manager at Agent `username`-only accounts.

---

## 7. Self-Practice Oral Defense Questions and Answers

1. **Tanong ng Panel: "Ang AI ba ninyo ang nag-a-approve o nagre-reject ng internet application ng customer?"**  
   **Sagot:** Hindi po. **Human-in-the-Loop** ang aming architecture. Preliminary screening lamang ang ginagawa ng OpenCV at Google Gemini (tinutukoy ang malabong ID o posibleng discrepancy sa pangalan/birthdate/ID number), at palaging **Agent** ang nagsu-suri at nagko-confirm bago magpadala ng correction request. Samantala, ang final approval o rejection ay mula sa actual encoding result sa existing system ng Internet Service Provider.

2. **Tanong ng Panel: "Paano ninyo pinagsama ang OpenCV, Google Gemini API, at Python rules sa screening process?"**  
   **Sagot:** May dalawang malinaw na stage: unang sinusuri ng **OpenCV** ang image quality (sharpness, glare, brightness) at gumagawa ng 4-corner perspective-cropped working copy nang hindi ginagalaw ang original photo ng customer; pangalawa, **Google Gemini Flash Vision** ang nagbabasa ng visible text at tumutukoy kung valid government ID (`is_valid_government_id`) ito, habang ang deterministic Python **`FieldComparisonEngine`** ang nagko-compare laban sa Customer inputs bago mag-draft ng polite plain-language remarks.

3. **Tanong ng Panel: "Ano ang mangyayari kapag nag-down ang AI API o pinatay ng Admin ang AI Screening sa gitna ng operasyon?"**  
   **Sagot:** May built-in **Fail-Safe Manual Fallback** ang system. Kapag pinause ng Admin ang `ai_enabled` o hindi maabot ang external API, makakapag-submit pa rin ng application ang Customer at tatanggap agad ng Reference Number; nagpo-post ng clickable in-system notification sa Agent/Manager dashboards at diretsong mare-review nang manual gamit ang original uploaded ID photos.

4. **Tanong ng Panel: "Paano ninyo pinoprotektahan ang data privacy ng Customer sa email notifications?"**  
   **Sagot:** Alinsunod sa **Data Privacy Act of 2012 (RA 10173)**, walang sensitibong ID numbers, birthdate, o personal photos na inilalagay sa body ng email. Dinadala ng malinis na card email (sent via `SMTP_USER`-aligned Gmail SMTP) ang Customer patungo sa authenticated **Customer Portal** (`/login` -> `/customer`) upang doon tingnan ang detalye at mag-upload ng corrections.

5. **Tanong ng Panel: "Bakit tatlong statuses lang (Processing, Approved, Rejected) ang nakikita ng Customer samantalang mas marami sa Agent at Manager?"**  
   **Sagot:** Para manatiling simple at hindi nakakalito ang user experience ng Customer—habang nasa Agent/Manager workflow ang `Pending Review`, `Needs Correction`, at `Ready for Provider Encoding`, lahat ng iyon ay pinagsama sa malinaw na **Processing** view para sa Customer (at kapag `Needs Correction`, lumalabas lang ang edit/correction card + 24h/72h reminder notice + `"I choose not to correct"` option sa loob mismo ng Processing status).

6. **Tanong ng Panel: "Paano ninyo ginawang mas ligtas ang authentication at sessions laban sa password reuse, idle abandonment, at shared devices?"**  
   **Sagot:** Tatlong security controls ang naka-integrate: (1) **`sessionStorage` + DB `session_token`**, kaya isang active device session lang ang gumagana bawat login at walang `"Remember Me"` cross-device leak; (2) **15-minute idle auto-logout**, na awtomatikong nagsa-sign out sa hindi aktibong Customer, Agent, Manager, o Admin sessions; at (3) **`password_history` + `password_changed_at`**, na nagbabawal sa muling paggamit ng lumang password at nagsasabi kung ilang buwan, araw, o oras na ang nakalipas mula nang huling palitan.

7. **Tanong ng Panel: "Bakit `@gmail.com` lang ang sa Customer habang `username`-only internal credentials naman ang sa Agent, Manager, at Admin?"**  
   **Sagot:** Upang magkaroon ng malinaw na **role-based identity separation** at maiwasan ang email bounce sa mga internal accounts na walang external mailbox. Kailangan ng Customers ng active `@gmail.com` inbox para sa 6-digit OTP verification, Reference Number, one-time `/activate` link (kung saan pinipili rin nila ang sariling `username`), 24h/72h correction reminders, at opted-in promos. Samantala, ang Agents, Manager, at ang nag-iisang System Administrator ay gumagamit ng `username`-only internal credentials na may clickable **in-system notifications** (`target_tab` / `target_id`), Admin-resolved **Staff Password Reset Requests** para sa staff, at lockout-free `/admin-login` recovery access para sa sole Admin.
