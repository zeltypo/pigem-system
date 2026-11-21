# PIGEM dashboard and screening refinements

## Apply to your existing project

1. Back up the existing Windows project and database. Extract this update and copy the project files into C:\pigem-system, preserving your existing .env files and deployment settings.
2. In Supabase SQL Editor, run only **refinement-update.sql**. It updates the login lock and referral functions/policies, and assigns new valid referrals to the correct agent. It does not reset any tables or remove storage files. The exact sample REF-CAV01 is removed only if it has no associated application.
3. In Vercel, ensure LOCATIONIQ_API_KEY contains the full active LocationIQ public access token in the appropriate environment. A partial prefix is not enough. The map still uses the alternative geocoder when the primary service fails.
4. Push and deploy when you are ready. No live deployment or database changes were performed as part of preparing this package.

**Do not run schema.sql on your existing database.** It is a fresh installation script with destructive setup statements. You do not need to repeat the screening migration or cron schedule if these are already installed.

## Changes

- Overview: simple monthly calendar with previous/next. Detailed calendar reports, exports and charts are under Reports.
- Agent: Public Queue, My Queue, Claimed, Needs Correction, Encoding, Approved, Rejected. Personal application links are requested from My Queue and approved by a manager; the same link is reused. New submissions from an approved link are assigned to that agent. Existing links and applications are preserved.
- Manager: agent account/link screen replaces raw technical references; approve personal application links or create one-time registration links. Multiple promotional banners can be uploaded together.
- Agent and other staff: password confirmation field, explicit popup dismissal, no inactivity timeout. Session validity and online reconnection are still checked.
- Sign-in: five failed attempts trigger a 30-minute browser-persistent countdown; verified staff also have a database-enforced lock. Legacy and customer sign-in still use the original broader authentication architecture; the browser-side limit is not a substitute for server-side account rate limiting. Existing authentication/session expiry rules are retained.
- Gmail: complete a bare Gmail username in application, correction and recovery flows, while leaving login usernames distinct.
- Screening: Azure v4 reads a separate size-limited JPEG transport copy without replacing the original uploaded photos. Both sides are processed sequentially; errors include sanitized Azure codes and byte counts, and an unreadable back is not falsely represented as verified. Obvious defects retain the existing deterministic automatic-correction route. Other uncertain findings remain for agent review. A quality verdict of unfixable cannot carry an excellent score.

## Verification after your deployment

- Submit a normal public application and a new approved personal-link application. Verify the latter appears in My Queue for the right agent, never in Public Queue.
- Request a link twice, approve it as manager, and verify exactly one personal link is used. Check the link after refreshing.
- Verify both overview and reports calendars; test multiple banner selection and password confirmation.
- Attempt login with an incorrect password five times on a test account. Verify the 30-minute count and that a page refresh preserves it. Do not lock your only admin account during the demo.
- Submit valid ID data using test documents; inspect worker logs for Azure HTTP 202, successful extraction, then GPT-5.4 recommendation. A 400 response requires checking the new Azure error_code; configuration health alone does not prove that documents can be analyzed.
- Test an obvious duplicate front/back upload and confirm that correction occurs without relying on an uncertain AI judgment.

The scheduled worker claims jobs once per minute. A returned cron job ID (for example 2) is not proof that two schedules run. Use the existing job; there is no need to create another.
