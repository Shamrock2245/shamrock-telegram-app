# Changelog

All notable changes to the Shamrock Telegram channel are recorded here.

## 2026-10-08 — Documents lookup refused cleanly in /api/miniapp

### Fixed
- GAS has no `handleTelegramDocumentLookup`, so `telegram_document_lookup` always failed with a server error. `/api/miniapp` now answers it with `503 document_lookup_unavailable` and a "please call (239) 332-2245" message, with no GAS call.
- The ownership check still runs first: initData, the Telegram-signed contact for the same user, and a typed phone must match the verified one (403/401 otherwise).
- `shared/brand.js` shows the same message on the documents page.

## 2026-10-08 — Shannon mid-call tool relay (/api/shannon-tool)

### Security
- New `POST /api/shannon-tool?tool=<name>` (`netlify/functions/shannon-tool.mjs`) relays the three Shannon tools that today hit GAS with no URL secret (`send_sms`, `schedule_callback`, `check_caller_history`).
- Requires `Authorization: Bearer` matching env `SHANNON_TOOL_SECRET` (timing-safe). Unset → 503 (fail closed). Wrong/missing → 401. Non-allowlisted tools (including the dead `evaluate_flight_risk` / `run_background_verification`) → 400. Body over 64 KB → 413. All refusals make zero outbound fetches.
- Forwards once to `GAS_WEB_APP_URL` as `?source=elevenlabs_tool&tool=<name>`. If Netlify env `ELEVENLABS_TOOL_SECRET` is set, appends `&secret=` server-side (never logged). If it is unset, forwards without `secret` (does not fail closed on that env).
- ElevenLabs tool URL/config changes are **not** in this PR. Brendan points the three tools here later (see PR body).

## 2026-10-08 — Mini App pages go through /api/miniapp (no more direct GAS calls)

### Security

- New `POST /api/miniapp` (`netlify/functions/miniapp-gas.mjs`) is now the only path from the Mini App pages to GAS. Every refusal happens before any outbound call. It works in four steps:
  - It verifies Telegram `initData` (HMAC-SHA256 with `TELEGRAM_BOT_TOKEN`, fresh `auth_date`), using the shared verifier `crm-intake` and `checkin-geo-alert` already use.
  - For lookups (`telegram_payment_lookup`, `telegram_status_lookup`, `telegram_document_lookup`) it also verifies the signed `Telegram.WebApp.requestContact` response. That response must belong to the same Telegram user. Only the phone Telegram verified is sent to GAS. A typed phone that differs, or a case-number lookup, gets `403`. GAS has no trustworthy Telegram-user-to-phone link today: its sheets store whatever phone the client typed, so they are not used for ownership.
  - Write actions (`telegram_mini_app_intake`, `telegram_mini_app_upload`, `telegram_payment_log`, `telegram_checkin_log`, `telegram_client_update`) get the verified Telegram id and username in place of what the client claimed. Anonymous tips are forwarded without the id.
  - It enforces a per-user limit (10 lookups or 30 writes per 10 minutes), then forwards once to GAS with `apiKey` = `GAS_API_KEY`, server-side.
- `intake`, `payment`, `updates`, `status`, `documents` and `defendant` now call `/api/miniapp` through `miniappPost` / `miniappLookup` in `shared/brand.js`. The GAS URL is removed from the pages.
  - `defendant` had its GAS URL set to `null`, so its lookup, uploads, check-in and updates all failed. Its lookup now uses the verified-phone status lookup.
  - Large photos are shrunk before upload so they fit the 6 MB function body limit.
- `/api/status` (`status-proxy.mjs`) is retired and returns `410`. It was an unauthenticated proxy that returned client data for any phone, and no page called it.
- `sw.js` cache bumped to `shamrock-v3` so cached pages that still call GAS directly are dropped.
- This change is safe live on its own: GAS still accepts these actions with or without the key until the portal GAS gate ships.

## 2026-10-08 — Caller auth on /api/checkin-geo-alert

### Security

- `POST /api/checkin-geo-alert` now requires caller auth, checked before any outbound call. Without it, anyone could push fake geo-fence alerts into Slack #alerts. A request must carry one of:
  - Server callers: an `X-GAS-API-Key` header equal to the Netlify env var `GAS_API_KEY`. That's the same shared secret GAS holds as its `GAS_API_KEY` Script Property, so no new secret is needed.
  - Telegram mini-app: `initData` (`Telegram.WebApp.initData`) in the body. It's verified with HMAC-SHA256 against the Netlify env var `TELEGRAM_BOT_TOKEN`, including the `auth_date` freshness check, by the shared `validateTelegramInitData` that `crm-intake` already uses.
  - Anything else gets `401`, and nothing is posted. If both env vars are unset, every request fails.
- No repo calls this endpoint today. The old header comment said GAS called it, but GAS has no such call. So no live caller breaks.
- Tests: an unauthenticated request, a bad or stale credential, or missing env vars each return `401` with zero outbound fetches. A valid signed `initData` or a valid server header passes. All fixtures are fake, and fetch is mocked.

## 2026-10-08 — GAS API key on risk-mitigation actions

### Changed

- The scheduled functions now send `apiKey` (Netlify env `GAS_API_KEY`, read server-side through `gasApiKey()`) on every GAS risk-mitigation action they call:
  - `court-reminder`: `get_upcoming_court_dates`, `send_court_reminders`
  - `engagement-watchdog`: `get_unacknowledged_reminders`, `escalate_to_cosigner`
  - `sentiment-watchdog`: `get_recent_client_messages`, `flag_high_stress_case`
  - `daily-briefing`: `get_daily_stats`, `get_forfeiture_cases`
  - This prepares for a GAS change (portal `backend-gas/Code.js`) that will require the key on these actions. Until that GAS change is pushed, GAS ignores the field. All four functions are scheduled, so Netlify does not expose them by URL in production.
- `npm test` fails if any server-side call to a keyed GAS action lacks `apiKey: gasApiKey()`, or if a browser mini-app starts calling a keyed action. Runtime tests run each function against mocked GAS and OpenAI and check that every GAS call carries the key.

## 2026-10-08 — GAS API key on Slack posts

### Changed

- Every `post_slack_message` call to GAS now sends `apiKey` from the Netlify env var `GAS_API_KEY`. That's the same variable `shared/crm-intake.mjs` and the edge functions already read. There are four callers: `checkin-geo-alert`, `sentiment-watchdog`, `daily-briefing` and `compliance-digest`. The key is read server-side through `gasApiKey()` in `shared/ai-client.mjs` and is never returned to the caller.
  - This prepares for a GAS change that will require the key on `post_slack_message`. Until that GAS change is pushed, GAS ignores the field.
- `npm test` fails if any `post_slack_message` body lacks `apiKey: gasApiKey()`, or if a new caller appears.

## 2026-10-08 — Compliance digest unscheduled

### Changed

- `compliance-digest.mjs` no longer runs on a schedule. It used to run daily at `0 13 * * *` (9:00 AM EDT / 8:00 AM EST). Its `export const config` held only `schedule`, so the export is removed, and Netlify will not run the function on a cron after this deploy. The handler is unchanged.
  - Reason: GAS has no `get_compliance_report` action yet. Each run sent an "Unauthorized" error response to OpenAI and posted the resulting "digest" to Slack.
  - `netlify.toml` has no schedule entry for it, and Netlify deploy settings are untouched.
- `npm test` now checks that `compliance-digest` still loads and has a handler. It fails if the function exports a schedule or if `netlify.toml` schedules it.
- `compliance-digest` is now **disabled by default**. Without a schedule it is an ordinary function anyone could call at `/.netlify/functions/compliance-digest`, which would trigger GAS, OpenAI and a Slack post on demand. The handler now returns `410` with a `disabled` body before any GAS, OpenAI or other outbound call, unless the Netlify env var `COMPLIANCE_DIGEST_ENABLED` is exactly `true`. That flag is not set in Netlify, so the function stays off. Netlify env and deploy settings are untouched.
- `npm test` checks that a plain request with the flag unset (or set to anything other than `true`) returns `410 disabled` and makes zero outbound calls (fetch, http/https and OpenAI are all stubbed).

## 2026-10-08 — Compliance digest loads again

### Fixed

- `compliance-digest.mjs` no longer imports `Config` from `@netlify/functions`. That name is a TypeScript type, not a runtime export, so the module failed to load. The daily `0 13 * * *` schedule is still declared with `export const config`.
- `npm test` now imports every Netlify function module and fails if one cannot load.

## 2026-10-08 — Mini-app intake auth and fallback

### Changed

- `POST /api/crm-intake` checks Telegram `initData` against `TELEGRAM_BOT_TOKEN` and refuses the request when that check fails. It also limits each Telegram user to 20 submits per 10 minutes.
- The mini-app posts intake to `/api/crm-intake`, the path the function declares. A custom function path replaces the default `/.netlify/functions/` address.
- When the CRM call fails, the function returns JSON `crm_failed` and does not call GAS. The mini-app then posts the lead once, including ID images, through the browser's GAS queue. The page says the application was not saved only when that browser save fails.
- ID scan and CRM submit each abort after 3.5 seconds, so the two calls stay near 7 seconds and under Netlify's 10 second limit. Shannon's notify-bondsman tool still forwards the callback and staff alert to GAS after a CRM success, and it reuses the call's case reference.

## 2026-10-07 — Canonical CRM intake

### Changed

- Telegram mini-app intake and Shannon's notify-bondsman tool now open a lead with `POST /api/intake/submit` on ShamrockLeads. Source tags are `telegram_miniapp` and `shannon_voice`.
- An uploaded ID is scanned first. The stated name, address, phone, and best email then fill that scan. Blank bond amounts and generated booking keys are not sent.
- The browser's GAS queue runs only when the CRM call fails, and that failure is logged. The Netlify function itself does not post to GAS.

## 2026-08-16 — Direct paperwork retirement and authoritative-path alignment

### Changed

- Retired the public `/api/send-paperwork` execution path. It now returns a non-sending `409 DIRECT_PAPERWORK_RETIRED` response and cannot forward intake data, create a packet, send a signing link, or send SMS/email.
- Removed Telegram embedded-signing behavior from the documents and defendant surfaces. Both now direct users to the staff-reviewed **DocuSeal** workflow in Super CRM.
- Removed the retired client factory deployment fallback. Mini-apps use the shared approved factory endpoint or fail closed; the ElevenLabs edge runtime uses `GAS_WEB_APP_URL` configuration only.
- Removed client request-body logging from the ElevenLabs initializer and bondsman notification handler.
- Updated README, STATUS, and the Shannon tool schema to describe the authoritative path: validated Match → BondCase → explicit surety → assigned POA → staff approval → DocuSeal.

### Verified

- Commit `098fd1e` is on `main`.
- Public `POST https://shamrock-telegram.netlify.app/api/send-paperwork` returned the non-sending retirement response with HTTP `409` on 2026-08-16.

### Still human-gated

- Remove or disable the corresponding direct-paperwork tool in the ElevenLabs Conversational AI UI.
- Verify the live OSI and Palmetto DocuSeal templates from Super CRM before any staff-approved packet is sent.
- Do not enable direct outbound signing links, SMS, or email from Telegram.
