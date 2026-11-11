# PIGEM Web-Based Internet Service Application System - Cloud Capstone Study Guide

Ang study guide na ito ay ginawa para sa buong Capstone team upang madaling maintindihan, ma-navigate, at maipaliwanag sa Oral Defense ang bawat bahagi ng **Web-Based Internet Service Application System with AI-Assisted Requirements Screening** para sa **PIGEM Combined Facilities Support Services** (`https://pigem-system-web.vercel.app`).

---

## 1. Buong Cloud Architecture Overview (Zero Localhost, 24/7 Live)

Ang buong system—kasama ang **Public Website**, **Customer Portal**, **Internal Staff Portals (Agent at Manager)**, **Technical Admin Console**, at **Python FastAPI Backend**—ay naka-host nang buo sa cloud gamit ang **Vercel** at **Supabase**:

1. **Frontend Web Portals (`web/html/*.html`, `web/style.css`, `web/js/*.js`):**
   - Purong **HTML5**, **CSS3** (clean minimalist UI na may kumpletong smooth UX animations at responsive Grid/Flexbox), at **Vanilla JavaScript** na may **OOP Validator at Guide Classes**.
   - **Leaflet.js + OpenStreetMap + LocationIQ API**: Ginagamit sa `web/html/apply.html` para sa interactive map pinning at reverse geocoding, na may automatic fallback sa OpenStreetMap Nominatim.
   - **Google reCAPTCHA v2 ("I'm not a robot" Checkbox)**: Pinoprotektahan ang application form at login pages laban sa bots, na bini-verify sa server-side gamit ang `/api/verify-captcha` (`SiteVerify`).
2. **Cloud Database, Auth, at Storage (`Supabase`):**
   - **PostgreSQL (13 Tables)**: Nagtatago ng `users`, `plans`, `system_settings`, `website_content`, `agent_links`, `applications`, `documents`, `screenings`, `corrections`, `notifications`, `login_history`, `system_logs`, at `popup_guides`.
   - **Supabase Storage Buckets**: Dalawang buckets—`website-assets` para sa banners/logos/icons/permits/vehicles, at `documents` para sa in-upload na Valid IDs (front at back), mobile QR scan uploads (`documents/qr-sessions/`), at ang **OpenCV cropped working copies** (`documents/cropped/`).
3. **Serverless Python Backend (`api/index.py` at helper modules sa Vercel Python Runtime):**
   - **`api/index.py`**: Ang FastAPI entrypoint na nagbibigay ng cloud REST endpoints (`/api/health`, `/api/verify-captcha`, `/api/screen-async`, `/api/screen`, `/api/notify`, `/api/polite-remark`).
   - **`api/_quality.py` (`OpenCV`)**: Sinusuri ang image sharpness (Laplacian variance), brightness, glare, at contrast, at gumagawa ng 4-corner perspective-cropped at CLAHE-enhanced working copy nang hindi binabago ang original uploaded ID ng customer.
   - **`api/_gemini.py` (`Google Gemini API` + `FieldComparisonEngine`)**: Gumagamit ng `gemini-flash-latest` multimodal Vision OCR para basahin ang document validity (`is_valid_government_id`), pangalan, petsa ng kapanganakan, at ID number sa Philippine Valid IDs. Pagkatapos, ang deterministic Python `FieldComparisonEngine` ang nagko-compare ng customer-entered fields laban sa nabasang text bago gumawa ang Gemini ng **preliminary findings** at **polite plain-language correction draft**.
   - **`api/_screening.py` (`CloudScreeningCoordinator`)**: Tinitiyak ang **Human-in-the-Loop** rule ng manuscript—ang AI findings ay **preliminary** lamang at laging dumadaan sa **Agent review at confirmation** bago ma-markahan ng `Needs Correction` ang application. Kapag naka-disable o unavailable ang AI, automatic ang fallback sa manual review gamit ang original uploaded ID photos.
   - **`api/_mailer.py` (`Gmail SMTP` over TLS Port 587)**: Gumagamit ng OOP `BaseEmailTemplateRenderer` at `CustomerEmailRenderer` upang magpadala ng simple, malinis, at propesyonal na HTML emails **eksklusibo sa `@gmail.com` Customer accounts lamang** (6-digit OTP codes, application confirmation na may Reference Number at one-time activation link, RA 10173 privacy-safe correction notices, status updates, at opted-in promotional broadcasts). Automatic nitong ini-skip ang username-only internal accounts dahil **in-system website notifications** (`public.notifications`) ang gamit ng Agents at Manager.

---

## 2. Account Identity, Notifications, at Announcements Architecture

1. **Customers (`@gmail.com` Only):**
   - Tanging valid `@gmail.com` email address lamang ang tinatanggap sa Application Form (`web/html/apply.html`), One-Time Account Activation (`web/html/activate.html`), at Customer Login (`web/html/login.html` gamit ang Gmail o username).
   - Sa Customer Login lang may **6-digit Gmail OTP Forgot Password** recovery.
2. **Internal Staff at Single Provisioned Admin (`username`-Only Internal Accounts):**
   - Ang **Agent**, **Manager**, at **Admin** ay gumagamit ng **unique username only** (halimbawa `@pigem_admin`, `@manager_cavite`, `@agent_juan`) na walang external email column sa `public.users`, pang-login lamang sa `/staff-login` at `/admin-login`.
   - **Isa (1) lang ang Admin sa buong system:** Sa unang bukas ng `/admin-login` (kapag wala pang Admin sa `public.users`), lalabas ang **First-Time System Setup** button papuntang `/setup-accounts` upang i-register nang isang beses ang sole Admin username account. Pagkatapos ma-provision ang 1 Admin, permanenteng naka-lock na ang `/setup-accounts`.
   - **Admin at Manager Staff Provisioning:** Ang Admin sa `/admin` (`Accounts` tab) ang gumagawa, nag-e-edit, nag-e-enable/disable, nagde-delete, at nagre-reset ng password ng Manager, Agent, at Customer accounts, at may access din ang Manager sa `/manager` upang gumawa at mag-manage ng Agent accounts. Kung makalimutan ng Agent o Manager ang password, pwedeng mag-submit ng **Forgot Password Request** papunta sa Admin mula sa `/staff-login`.
3. **In-System Website Notifications vs. Customer Emails:**
   - Walang external email na ipinapadala sa Agent, Manager, o Admin dahil username-only internal accounts ang gamit nila.
   - Kapag may bagong application o customer update, o kapag in-off/in-on ng Admin ang **AI Screening** o **Website Maintenance Mode**, lumalabas agad ito bilang **in-system website notification** at status banner sa Agent Workspace at Manager Dashboard.
4. **Website Announcements at Promotional Offers (`web/html/manager.html` + `web/html/index.html`):**
   - Sa Manager CMS (`Announcements & Promos`), pwedeng i-publish ng Manager ang isang **Public Website Announcement Banner** na makikita agad sa tuktok ng `web/html/index.html` at sa Customer Portal notifications, at sabay na magpadala ng malinis na promo email mula sa official PIGEM Gmail SMTP sender (`SMTP_FROM`) **para lamang sa `@gmail.com` Customers na nag-check ng marketing consent (`promo_opt_in`)**.

---

## 3. Folder at File Structure ng System (`C:\pigem-system`)

- `vercel.json` — Cloud routing configuration na nagko-connect sa lahat ng HTML portals at `/api/*` FastAPI serverless routes.
- `requirements.txt` at `api/requirements.txt` — Lightweight Python dependencies (`fastapi`, `python-multipart`, `httpx`, `numpy`, `opencv-python-headless`) para sa Vercel Serverless.
- `schema.sql` — Kumpletong PostgreSQL table definitions, Row-Level Security policies, storage buckets, at seed data (walang `DROP` statements sa loob).
- `api/`
  - `index.py` — Main FastAPI cloud router.
  - `_auth.py` — OOP `BaseTokenVerifier` at `SupabaseTokenVerifier` para sa Bearer JWT validation at Google reCAPTCHA v2 `SiteVerify`.
  - `_quality.py` — OOP `BaseImageProcessor`, `FastQualityScanner`, at `DocumentCropEnhancer` gamit ang OpenCV.
  - `_gemini.py` — OOP `BaseTextMatcher`, `FieldComparisonEngine`, `BaseLanguageClient`, at `GeminiScreeningService`.
  - `_screening.py` — OOP `BaseCloudGateway`, `SupabaseApplicationGateway`, at `CloudScreeningCoordinator`.
  - `_mailer.py` — Transactional HTML email builder at Gmail SMTP TLS sender.
- `web/`
  - **HTML Portals (`web/html/`)**:
    - **Public at Customer Pages**: `index.html`, `about.html`, `apply.html`, `privacy.html`, `login.html`, `activate.html`, `customer.html`
    - **Internal Staff at Admin Pages**: `staff-login.html`, `agent.html`, `agent-register.html`, `manager.html`, `admin-login.html`, `admin.html`, `setup-accounts.html`
  - **Shared Stylesheet**: `web/style.css` (all icons & images fetched from Supabase Storage `website-assets`)
  - **JavaScript Modules (`web/js/`)**: `config.js`, `db.js`, `api.js`, `home.js`, `apply.js`, `login.js`, `customer.js`, `agent.js`, `manager.js`, `admin.js`, `dash-ui.js`

---

## 4. Paano Gumagana ang Programming Concepts sa Code (OOP, Regex, Nested Logic)

### A. Object-Oriented Programming (Abstraction, Inheritance, Encapsulation)
- **Sa Python (`api/_quality.py`, `api/_gemini.py`, `api/_screening.py`, `api/_auth.py`):**
  - **Abstraction at Inheritance**: Ang `BaseImageProcessor` ay may abstract method na `analyze(image_bytes)` na minana ng `FastQualityScanner` (Stage 1) at `DocumentCropEnhancer` (Stage 2). Ganoon din ang `BaseTextMatcher` -> `FieldComparisonEngine` at `BaseCloudGateway` -> `SupabaseApplicationGateway`.
  - **Encapsulation**: Ang internal helper methods at private Regex patterns ay naka-prefix ng underscore (halimbawa `_decode_bytes`, `_order_corners`, `_sanitize_plain_text`, `_TECH_TERMS_REGEX`) upang nakatago ang internal implementation details.
- **Sa JavaScript (`web/js/config.js`):**
  - Ang `BaseFieldValidator` ay minana ng `ApplicantFormValidator` para sa email, Philippine mobile number, at 25 government/company ID formats, habang ang `PopupGuideManager` ang humahawak sa role-appropriate pop-up guides.

### B. Regular Expressions (Regex)
- **ID at Date Normalization (`api/_gemini.py`)**: Gumagamit ng `_ISO_DATE_REGEX`, `_MDY_DATE_REGEX`, at `_WORD_DATE_1_REGEX` upang ma-normalize ang iba't ibang date formats sa Philippine IDs (halimbawa `May 12, 1999` o `05/12/1999` papuntang `1999-05-12`).
- **Plain-Language Sanitization (`api/_gemini.py` at `web/js/agent.js`)**: Tinatanggal ng `_TECH_TERMS_REGEX` ang anumang technical terms (`OpenCV`, `Gemini`, `OCR`, `LLM`, `AI`) upang plain English lang ang nakikita ng Customer, Agent, at Manager.
- **Philippine ID Validation (`web/js/config.js`)**: Bawat ID type sa `CONFIG.ID_TYPES` ay may sariling Regex pattern (halimbawa `/^(\d{12}|\d{16})$/` para sa National ID at `/^[A-Z]\d{10}$/` para sa Driver's License).

### C. Nested Loops at Nested Conditionals
- **Fuzzy Token at Sliding-Window ID Matching (`FieldComparisonEngine.compare` sa `api/_gemini.py`)**:
  - Sa pangalan: Ang outer loop ay umiikot sa bawat word ng customer name (`JUAN`, `DELA`, `CRUZ`), at ang inner loop ay nagche-check ng `SequenceMatcher` similarity (`>= 0.80`) laban sa bawat word na nabasa sa ID kahit baliktad ang ayos (`DELA CRUZ, JUAN`).
  - Sa ID number: Gumagamit ng sliding-window loop sa compact alphanumeric string upang ma-detect kung tumutugma ang ID number kahit may sobrang characters sa paligid ng card text.

---

## 5. End-to-End Application at Screening Flow

1. **Customer Application (`apply.html` + `apply.js`):**
   - Sasagutan ng applicant ang Google reCAPTCHA v2 -> pipili ng Red Fiber Plan -> ilalagay ang pangalan at birth date -> magpapa-verify ng 6-digit Gmail OTP -> magpi-pin ng bahay sa Leaflet/LocationIQ/OpenStreetMap map -> mag-a-upload ng Front at Back Valid ID photos sa Supabase `documents` bucket.
   - Pag-submit, agad na ise-save ang record sa `public.applications`, ipapakita agad ang **Reference Number** (`PF-...`), at ipapadala ang Confirmation at Activation Email habang tumatakbo sa background (`keepalive: true`) ang `POST /api/screen-async`.
2. **Two-Stage Cloud Screening (`api/_screening.py`):**
   - **Stage 1 (`FastQualityScanner`)**: Iche-check ng OpenCV kung malabo, madilim, o may flash glare ang ID.
   - **Stage 2 (`DocumentCropEnhancer` + `GeminiScreeningService` + `FieldComparisonEngine`)**: Iko-crop ng OpenCV ang 4 corners ng ID at ia-upload sa `documents/cropped/`. Babasahin ng Google Gemini Vision ang text sa ID, ikukumpara ng `FieldComparisonEngine` ang Name, Birth Date, at ID Number, at gagawa ng **preliminary findings** (`review_recommended`, `suggested_fields`, `suggested_polite_message`).
3. **Human-in-the-Loop Agent Confirmation (`agent.html` + `agent.js`):**
   - Makikita ng Agent ang **Cropped & Enhanced Copy** katabi ng **Original Uploaded Photo**.
   - Kung may flag ang screening, naka-pre-fill na sa Section 4 ang target field at polite message, pero **ang Agent pa rin ang magre-review at pipindot ng Confirm** bago maging `Needs Correction` at ma-email ang customer.
   - Kapag kumpleto na, ie-encode ng Agent sa portal ng provider (`Encoding`) at ire-record ang final Validator decision (`Approved` o `Rejected`).
4. **Customer View (`customer.html` + `customer.js`):**
   - Tatlong main statuses lang ang nakikita ng customer: **Processing**, **Approved**, at **Rejected**. Kapag `Needs Correction`, lumalabas lang ang update form sa loob ng **Processing** status nang walang anumang salitang "AI" o technical jargon.

---

## 6. Separate SQL Reset Query (13 Tables) at Full Database Setup

Kung kailangang i-reset nang malinis ang Supabase database bago patakbuhin ang `schema.sql`, patakbuhin muna itong hiwalay na `DROP` script sa Supabase SQL Editor:

```sql
DROP TABLE IF EXISTS public.popup_guides CASCADE;
DROP TABLE IF EXISTS public.system_logs CASCADE;
DROP TABLE IF EXISTS public.login_history CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.corrections CASCADE;
DROP TABLE IF EXISTS public.screenings CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.applications CASCADE;
DROP TABLE IF EXISTS public.agent_links CASCADE;
DROP TABLE IF EXISTS public.website_content CASCADE;
DROP TABLE IF EXISTS public.system_settings CASCADE;
DROP TABLE IF EXISTS public.plans CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

DROP FUNCTION IF EXISTS public.set_updated_at_timestamp() CASCADE;

DROP POLICY IF EXISTS "Allow public access to website-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow access to documents" ON storage.objects;
```

Pagkatapos patakbuhin ang reset script sa itaas, kopyahin at i-run nang buo ang laman ng `schema.sql` sa Supabase SQL Editor. Pagkatapos, buksan ang `/admin-login` -> pindutin ang **Provision Admin Account** (`/setup-accounts`) upang i-register ang nag-iisang Admin username account (halimbawa `pigem_admin`), at mag-sign in sa `/admin` upang gawin ang Manager at Agent accounts gamit ang kani-kanilang username.

---

## 7. Self-Practice Oral Defense Questions and Answers

1. **Tanong ng Panel: "Ang AI ba ninyo ang nag-a-approve o nagre-reject ng internet application ng customer?"**  
   **Sagot:** Hindi po. Alinsunod sa aming Objectives at Scope and Limitations, ang AI-assisted requirements screening ay nagbibigay lamang ng **preliminary findings** at draft correction guidance. Hindi ito nagpapatunay ng legal authenticity ng ID at hindi nag-a-approve o nagre-reject. Ang aming PIGEM Agent pa rin ang nagre-review at nagko-confirm kung kailangan ng `Needs Correction`, at ang Red Fiber Validator pa rin sa provider portal ang nagbibigay ng final `Approved` o `Rejected` decision.

2. **Tanong ng Panel: "Paano ninyo pinagsama ang OpenCV, Google Gemini API, at Python rules sa screening process?"**  
   **Sagot:** Hinati po namin sa malinaw na stages upang hindi umaasa sa hula ng AI. Una, ginagamit ang **OpenCV** para sukatin ang sharpness, brightness, glare, at contrast ng ID image at gumawa ng hiwalay na 4-corner cropped working copy habang pinapanatili ang original file ng customer. Pangalawa, ginagamit ang **Google Gemini Vision OCR** para basahin lamang ang nakasulat na pangalan, birth date, at ID number sa card. Pangatlo, **deterministic Python logic (`FieldComparisonEngine`)** ang nagno-normalize ng dates at nagko-compare ng customer form entries laban sa extracted text. Pang-apat, ginagamit ang Gemini para isalin ang resulta sa magalang at simpleng lengguwahe para sa review ng Agent.

3. **Tanong ng Panel: "Ano ang mangyayari kapag nag-down ang AI API o pinatay ng Admin ang AI Screening sa gitna ng operasyon?"**  
   **Sagot:** May built-in **Fail-Safe Manual Fallback** po ang system. Kapag pinause ng Admin ang `ai_enabled` sa Technical Management Console o hindi available ang external API, tuloy-tuloy pa ring makakapag-submit ng application ang Customer at makakatanggap agad ng Reference Number. Automatic na minamarkahan ang application bilang ready for manual review gamit ang original uploaded ID photos sa Supabase Storage, at automatic na nagpo-post ng in-system website notification sa Agent Workspace at Manager Dashboard.

4. **Tanong ng Panel: "Paano ninyo pinoprotektahan ang data privacy ng Customer sa email notifications?"**  
   **Sagot:** Sumusunod po ang aming Email Notification Module sa **Data Privacy Act of 2012 (RA 10173)** data minimization principle. Gumagamit kami ng simple at malinis na HTML email card kung saan sa `Needs Correction` notice ay hindi inilalantad sa email body ang ID images o maseselang personal details ng applicant; sa halip, ipinapaalam lang na may kailangang i-update at pinapapasok ang customer sa authenticated Customer Portal nila upang doon ligtas na mag-edit o mag-upload ng bagong ID.

5. **Tanong ng Panel: "Bakit tatlong statuses lang (Processing, Approved, Rejected) ang nakikita ng Customer samantalang mas marami sa Agent at Manager?"**  
   **Sagot:** Upang mapanatiling simple at hindi nakakalito ang user experience (UX) ng Customer. Ang internal workflow statuses gaya ng `Pending Review`, `Under Agent Review`, at `Encoding` ay internal operational tracking lamang ng PIGEM staff kaya lumalabas ito bilang **Processing** sa Customer. Kapag may kailangang ipabago ang Agent, lumalabas ang `Needs Correction` update box sa loob mismo ng **Processing** stage hanggang sa ma-finalize ng Validator ang **Approved** o **Rejected**.

6. **Tanong ng Panel: "Paano gumagana ang map pinning sa Application Form?"**  
   **Sagot:** Gumagamit po kami ng **Leaflet.js** na nagre-render ng **OpenStreetMap** tiles, at konektado ito sa **LocationIQ Geocoding API** bilang primary reverse-geocoding service na may automatic fallback sa OpenStreetMap Nominatim. Kapag nag-drag ng pin o gumamit ng GPS ang customer, automatic na napupunan ang street, barangay, city, at province habang nase-save ang eksaktong latitude at longitude coordinates para sa installation team ng PIGEM.

7. **Tanong ng Panel: "Bakit `@gmail.com` lang ang sa Customer habang username-only internal credentials naman ang sa Agent, Manager, at Admin?"**  
   **Sagot:** Upang magkaroon ng malinaw na **role-based identity separation**. Ang Customers ay kailangang may tunay at aktibong `@gmail.com` inbox para matanggap ang 6-digit OTP verification, Reference Number, one-time account activation link, RA 10173 privacy-safe correction alerts, at opted-in promos. Samantala, ang Agents, Manager, at ang nag-iisang System Administrator ay gumagamit ng unique username-only internal credentials na walang naka-store na external email address—ang sole Admin ay nagrerehistro nang isang beses sa One-Time Admin Provisioning (`/setup-accounts`) at humahawak sa Manager, Agent, at Customer accounts (habang ang Manager ay nakakagawa rin ng Agents), at ang lahat ng internal status alerts ay lumalabas nang direkta bilang in-system notifications sa website dashboards.
