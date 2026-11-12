# PIGEM Web-Based Internet Service Application System

Cloud-hosted Web-Based Internet Service Application System with AI-Assisted Requirements Screening developed for **PIGEM Combined Facilities Support Services** (Dasmariñas City, Cavite).

## Live Cloud Architecture

- **Frontend Portals (`web/html/*.html`, `web/style.css`, `web/js/*.js`)**: Plain HTML5, CSS3 (Grid/Flexbox responsive layout), and Vanilla JavaScript (OOP validators, inline field errors, Leaflet.js + OpenStreetMap + LocationIQ map pinning, direct mobile QR ID capture, unified `dash-ui.js` Donut/Bar analytics & CSV/HTML Reports, 15-minute idle auto-logout + single-device `session_token` session guard, Google reCAPTCHA v2, and 25 Supabase Storage `website-assets/icons/*.png` UI icons).
- **Cloud Database, Auth & Storage (`Supabase`)**: 13 fresh PostgreSQL tables (`schema.sql`), strict identity separation (`@gmail.com` Customer accounts + self-chosen `username` on `/activate` vs. `username`-only internal accounts without email for Admin/Manager/Agent), `password_history` reuse protection, `target_tab`/`target_id` clickable notifications, and two cloud storage buckets (`website-assets` and `documents`).
- **Serverless Python Backend (`api/index.py`)**: FastAPI serverless endpoints hosted on Vercel (`/api/health`, `/api/verify-captcha`, `/api/screen-async`, `/api/screen`, `/api/notify`, `/api/polite-remark`) powered by **OpenCV** (`opencv-python-headless`), **Google Gemini API** (`gemini-flash-latest`), and **Gmail SMTP** (aligned with `SMTP_USER` delivering clean HTML emails exclusively to `@gmail.com` Customer accounts).

## Portal Routes on Vercel

- `/` or `/index` (`web/html/index.html`) — Public Home, Announcements Banner & Fiber Plans
- `/about` — Company Profile, Fleet & Permits
- `/apply` — Guided Online Application Form (`@gmail.com` inline OTP modal + duplicate check + direct mobile QR ID capture + pre-submit ID screening)
- `/activate` — One-time Customer Username Selection, Password Setup & Account Activation link
- `/login` & `/customer` — Customer Login (`@gmail.com` or `username` + 6-Digit OTP Forgot Username/Password) & Application Tracking / 24h-72h Correction Portal
- `/staff-login`, `/agent-register`, `/agent`, `/manager` — Internal Agent Workspace (Queues, Screening Review & Reports) & Manager Operations / CMS / Agent Provisioning (`username`-only credentials)
- `/setup-accounts` — One-Time Single System Administrator Provisioning (locks permanently once 1 Admin exists)
- `/admin-login` & `/admin` — Technical Management System (Staff & Customer CRUD, Staff Password Reset Requests, Logs & Printable/CSV/HTML Reports)

## Required Vercel Environment Variables

Configure these keys in **Vercel Project Settings -> Environment Variables**:
- **Type = `Secret`**: `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `RECAPTCHA_SECRET_KEY`, `SMTP_PASSWORD`
- **Type = `Config`**: `APP_BASE_URL`, `SUPABASE_URL`, `GEMINI_MODEL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (`gemini-flash-latest`)
- `RECAPTCHA_SECRET_KEY`
- `SMTP_HOST` (`smtp.gmail.com`)
- `SMTP_PORT` (`465` for SSL, or `587` for STARTTLS)
- `SMTP_USER` (authenticated Gmail sender address)
- `SMTP_PASSWORD` (Gmail App Password)
- `SMTP_FROM_NAME` (`PIGEM Combined Facilities Support Services`)
- `SMTP_FROM_EMAIL` (optional override; leave blank to align sender with `SMTP_USER` and prevent bounce/spam filtering)
- `APP_BASE_URL` (`https://pigem-system-web.vercel.app`)
