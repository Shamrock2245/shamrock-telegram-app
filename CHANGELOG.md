# Changelog

All notable changes to the Shamrock Telegram channel are recorded here.

## 2026-10-08 — Mini-app intake auth and fallback

### Changed

- `POST /api/crm-intake` checks Telegram `initData` against `TELEGRAM_BOT_TOKEN` and refuses the request when that check fails. It also limits each Telegram user to 20 submits per 10 minutes.
- A CRM or network failure still posts the lead to the existing GAS queue, including when the server has no `GAS_WEB_APP_URL`. The server fallback uses `telegram_mini_app` and surety `osi`, the same payload the browser already sent. If both paths fail, the mini-app says the application was not saved.
- ID scan and CRM submit calls abort after 4 seconds. Shannon's notify-bondsman tool still forwards the callback and staff alert to GAS after a CRM success, and it reuses the call's case reference.

## 2026-10-07 — Canonical CRM intake

### Changed

- Telegram mini-app intake and Shannon's notify-bondsman tool now open a lead with `POST /api/intake/submit` on ShamrockLeads. Source tags are `telegram_miniapp` and `shannon_voice`.
- An uploaded ID is scanned first. The stated name, address, phone, and best email then fill that scan. Blank bond amounts and generated booking keys are not sent.
- The previous GAS queue runs only when the CRM call fails, and that failure is logged.

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
