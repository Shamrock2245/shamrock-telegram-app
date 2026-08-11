# shamrock-telegram-app — STATUS

> **Last verified:** 2026-07-10
> **Repo:** `Shamrock2245/shamrock-telegram-app` · branch `main`
> **Hosting:** Netlify (static mini-apps + serverless functions)
> **Role:** Telegram channel of **Shamrock’s Platform** (intake, signing, Shannon paperwork)
> **Prod checklist:** `shamrock-leads/docs/ECOSYSTEM_PROD_CHECKLIST.md` §E

---

## What this repo is

Three Telegram mini-app surfaces that feed data into the GAS/SignNow/Drive pipeline:

| Mini-App | Path | User | Purpose |
|----------|------|------|---------|
| **Intake** | `/intake/` | Indemnitor (self-serve) | 5-step intake form → GAS IntakeQueue → MongoDB |
| **Documents** | `/documents/` | Indemnitor / Defendant | Case lookup → document packet → SignNow signing links |
| **Send Paperwork** | `/api/send-paperwork` (Netlify fn) | Shannon AI (mid-call) | ElevenLabs tool → GAS → SignNow Phase 1 packet → SMS link |

**Not** the student LMS (that is `shamrock-bail-school`).
**Not** the Super CRM dashboard (that is `shamrock-leads`).

---

## Code on `main` (implemented)

| Area | Status |
|------|--------|
| 5-step Telegram intake form (personal, defendant, bond, employment, references) | ✅ |
| GAS `telegram_intake_submit` → IntakeQueue sheet + MongoDB | ✅ |
| Session persistence (localStorage) across intake steps | ✅ |
| Document lookup by case number or phone | ✅ |
| Document packet rendering with per-role status (indemnitor / defendant) | ✅ |
| SignNow embedded signing link via `telegram_get_signing_url` | ✅ |
| Supporting document upload via `telegram_mini_app_upload` | ✅ |
| Shannon mid-call `send-paperwork` Netlify function | ✅ |
| Twilio SMS signing link delivery in `send-paperwork` | ✅ |
| **Surety realignment (July 2026)** | ✅ |
| &nbsp;&nbsp;`intake/app.js` — `surety_id` field added to step 2 (bond info) and persisted to session + GAS payload | ✅ |
| &nbsp;&nbsp;`documents/app.js` — `surety_id` read from case lookup response; forwarded in `telegram_get_signing_url` request | ✅ |
| &nbsp;&nbsp;`send-paperwork.mjs` — `surety_id` extracted from ElevenLabs body and forwarded to GAS | ✅ |

---

## Ops still required (not proven by git alone)

| Item | Notes |
|------|-------|
| Netlify deploy | ✅ 2026-08-11 — SEND_PAPERWORK_SECRET, ELEVENLABS_*, TWILIO_*, GAS_WEB_APP_URL set (production All) |
| GAS endpoint URL | ✅ stable factory `…CvP-Z/exec` in brand.js + documents/app.js + Netlify env |
| Palmetto SignNow template IDs | ✅ Aligned with leads `SignNowPacketService.TEMPLATE_MAP` (2026-07-10); verify live SignNow if templates move |
| ElevenLabs tool definition | ✅ schema `docs/SHANNON_SEND_PAPERWORK_TOOL.json` — confirm optional `surety_id` applied in ElevenLabs UI |

---

## Related repos

| Repo | Role |
|------|------|
| `shamrock-bail-portal-site` | GAS backend that receives all Telegram mini-app actions |
| `shamrock-leads` | MongoDB intake_queue; Super CRM that processes queued intakes |
| `shamrock-node-red` | Receives `/webhook/telegram-miniapp`; routes to GAS; monitors signing status |

---

## Data flow summary

```
Telegram Mini-App (Netlify)
    │  surety_id captured at intake or read from case record
    ▼
GAS (shamrock-bail-portal-site/backend-gas/)
    │  Telegram_IntakeQueue.js  →  IntakeQueue sheet + Wix sync
    │  Telegram_Documents.js   →  _resolveTemplateId(docKey, surety_id)
    │  SignNow_SendPaperwork.js →  Phase 1 / Phase 2 packet (surety-routed)
    ▼
SignNow (correct OSI or Palmetto template)
    ▼
Google Drive  →  Completed Bonds / OSI|PALMETTO / LastName, F_YYYYMMDD /
```
