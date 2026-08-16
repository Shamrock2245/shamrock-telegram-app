# shamrock-telegram-app — STATUS

> **Last verified:** 2026-08-16
> **Repo:** `Shamrock2245/shamrock-telegram-app` · branch `main`
> **Hosting:** Netlify (static mini-apps + serverless functions)
> **Role:** Telegram channel of **Shamrock’s Platform** (intake, document review, staff-reviewed paperwork handoff)
> **Prod checklist:** `shamrock-leads/docs/ECOSYSTEM_PROD_CHECKLIST.md` §E

---

## What this repo is

Three Telegram mini-app surfaces that feed intake and document-review data into the approved Shamrock workflow:

| Mini-App | Path | User | Purpose |
|----------|------|------|---------|
| **Intake** | `/intake/` | Indemnitor (self-serve) | 5-step intake form → GAS IntakeQueue → MongoDB |
| **Documents** | `/documents/` | Indemnitor / Defendant | Case lookup and document status; staff-reviewed DocuSeal handoff only |
| **Send Paperwork** | `/api/send-paperwork` (Netlify fn) | Legacy callers | Retired; returns a non-sending Super CRM handoff |

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
| Embedded signing-link generation | ✅ Retired; Telegram never creates or opens signing sessions |
| Supporting document upload via `telegram_mini_app_upload` | ✅ |
| Shannon mid-call `send-paperwork` Netlify function | ✅ Retired direct route; returns HTTP 409 and sends no packet, email, or SMS |
| Twilio SMS signing-link delivery in `send-paperwork` | ✅ Retired; outbound client contact remains staff-approved only |
| **Surety handling** | ✅ Intake may collect `surety_id`, but only Super CRM can validate/assign it for a packet |

---

## Ops still required (not proven by git alone)

| Item | Notes |
|------|-------|
| Netlify deploy | ✅ 2026-08-11 — SEND_PAPERWORK_SECRET, ELEVENLABS_*, TWILIO_*, GAS_WEB_APP_URL set (production All) |
| GAS endpoint URL | ✅ One approved stable factory URL is defined in `shared/brand.js`; Netlify/edge runtime uses `GAS_WEB_APP_URL` and fails closed when absent. Human confirmation of the configured value remains required. |
| Palmetto DocuSeal template ID | ☐ Verify against the active DocuSeal templates account from Super CRM. |
| ElevenLabs tool definition | ☐ Update/retire the direct paperwork tool in ElevenLabs UI; it must not promise or send signing links. |

---

## Related repos

| Repo | Role |
|------|------|
| `shamrock-bail-portal-site` | GAS backend that receives all Telegram mini-app actions |
| `shamrock-leads` | MongoDB intake_queue; Super CRM that processes queued intakes |
| `shamrock-node-red` | Receives approved automation events; does not generate or deliver signing links |

---

## Data flow summary

```
Telegram Mini-App (Netlify)
    │  intake and read-only case/document review
    ▼
GAS (shamrock-bail-portal-site/backend-gas/)
    │  Telegram_IntakeQueue.js → IntakeQueue sheet + Wix sync
    ▼
Super CRM
    │  validated Match → BondCase → explicit surety → assigned POA → staff approval
    ▼
DocuSeal (verified OSI or Palmetto template)
    ▼
Signature → Payment → Active Bond
```
