# Changelog

All notable changes to the Shamrock Telegram channel are recorded here.

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
