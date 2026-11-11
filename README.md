# PIGEM Web-Based Internet Service Application System

Cloud-hosted Web-Based Internet Service Application System with AI-Assisted Requirements Screening developed for **PIGEM Combined Facilities Support Services** (Dasmariñas City, Cavite).

## Live Cloud Architecture

- **Frontend Portals (`web/html/*.html`, `web/style.css`, `web/js/*.js`)**: Plain HTML5, CSS3 (Grid/Flexbox responsive layout), and Vanilla JavaScript (OOP validators, Leaflet.js + OpenStreetMap + LocationIQ map pinning, mobile QR ID capture, and Google reCAPTCHA v2).
- **Cloud Database, Auth & Storage (`Supabase`)**: 13 PostgreSQL tables (`schema.sql`), strict identity separation (`@gmail.com` Customer accounts vs. username-only internal accounts without email for Admin/Manager/Agent), and two cloud storage buckets (`website-assets` and `documents`).
- **Serverless Python Backend (`api/index.py`)**: FastAPI serverless endpoints hosted on Vercel (`/api/health`, `/api/verify-captcha`, `/api/screen-async`, `/api/screen`, `/api/notify`, `/api/polite-remark`) powered by **OpenCV** (`opencv-python-headless`), **Google Gemini API** (`gemini-flash-latest`), and **Gmail SMTP** (STARTTLS port 587 delivering clean HTML emails exclusively to `@gmail.com` Customer accounts).

## Portal Routes on Vercel

- `/` or `/index` (`web/html/index.html`) — Public Home, Announcements Banner & Fiber Plans
- `/about` — Company Profile, Fleet & Permits
- `/apply` — Guided 6-Panel Online Application Form (`@gmail.com` OTP verified + QR mobile ID upload + pre-submit ID screening)
- `/activate` — One-time Customer Password Setup & Account Activation link
- `/login` & `/customer` — Customer Login (`@gmail.com` or username + 6-Digit OTP Recovery) & Application Monitoring Portal
- `/staff-login`, `/agent`, `/manager` — Internal Agent Workspace & Manager Operations / CMS (`username`-only credentials)
- `/setup-accounts` — One-Time Single System Administrator Provisioning (locks permanently once 1 Admin exists)
- `/admin-login` & `/admin` — Technical Management System, Staff Account Provisioning (`username`-only) & Reports Console

## Required Vercel Environment Variables

Configure these keys in **Vercel Project Settings -> Environment Variables**:
- **Type = `Secret`**: `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `RECAPTCHA_SECRET_KEY`, `SMTP_PASSWORD`
- **Type = `Config`**: `APP_BASE_URL`, `SUPABASE_URL`, `GEMINI_MODEL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (`gemini-flash-latest`)
- `RECAPTCHA_SECRET_KEY`
- `SMTP_HOST` (`smtp.gmail.com`)
- `SMTP_PORT` (`587`)
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `APP_BASE_URL` (`https://pigem-system-web.vercel.app`)
