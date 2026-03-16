# 🍀 Shamrock Bail Bonds — Telegram Mini Apps

> **Mobile-first bail bond client experience — right inside Telegram.**

[![Netlify Status](https://api.netlify.com/api/v1/badges/shamrock-telegram/deploy-status)](https://shamrock-telegram.netlify.app)
[![Status](https://img.shields.io/badge/Status-🟢_Production-brightgreen)]()

**Live URL**: [shamrock-telegram.netlify.app](https://shamrock-telegram.netlify.app)  
**Bot**: [@ShamrockBail_bot](https://t.me/ShamrockBail_bot)  
**Last Updated**: March 16, 2026

---

## What This Is

Seven production **Telegram Mini Apps** for the Shamrock Bail Bonds bot, plus **17 Netlify serverless functions** and **3 edge functions** for AI, compliance, and voice integration. These are PWA-optimized web apps that run inside the Telegram chat window — zero app install required.

---

## 📱 Mini Apps

| App | Path | Status | Description |
|-----|------|--------|-------------|
| 🏠 **Hub** | `/` | ✅ Live | Central navigation — premium dark glassmorphism UI |
| 📋 **Intake** | `/intake/` | ✅ Live | 5-step bail intake form (defendant + indemnitor info, document uploads, GPS) |
| 👤 **Defendant** | `/defendant/` | ✅ Live | Defendant self-service portal (appearance calendar, check-in, court dates) |
| 📄 **Documents** | `/documents/` | ✅ Live | View, sign, and download case documents via SignNow |
| 💳 **Payment** | `/payment/` | ✅ Live | Make payments, check-ins with selfie + GPS logging |
| 📊 **Status** | `/status/` | ✅ Live | Case status lookup (court dates, payments, charges from real GAS data) |
| 📝 **Updates** | `/updates/` | ✅ Live | Update contact info, address, request payment extensions, anonymous tips |

### Direct Links
- Hub: https://shamrock-telegram.netlify.app
- Intake: https://shamrock-telegram.netlify.app/intake/
- Defendant: https://shamrock-telegram.netlify.app/defendant/
- Documents: https://shamrock-telegram.netlify.app/documents/
- Payment: https://shamrock-telegram.netlify.app/payment/
- Status: https://shamrock-telegram.netlify.app/status/
- Updates: https://shamrock-telegram.netlify.app/updates/

---

## 🏗 Architecture

```
shamrock-telegram-app/
├── index.html              # Hub / landing page
├── shared/
│   ├── theme.css           # Design tokens & CSS variables (dark/light themes)
│   └── brand.js            # Telegram SDK init, theme management, utilities
├── intake/                 # 5-step intake form → GAS doPost
├── defendant/              # Defendant self-service portal
├── documents/              # Document viewer + SignNow signing
├── payment/                # Payment & check-in flow
├── status/                 # Case dashboard with court dates
├── updates/                # Contact info updates + anonymous tips
├── netlify/
│   ├── edge-functions/     # 3 edge functions
│   └── functions/          # 17 serverless functions
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (offline support)
└── netlify.toml            # Hosting config, CORS, SPA redirects
```

Each Mini App follows the same pattern:
```
{app}/
├── index.html   # Layout + structure
├── app.js       # Logic → fetch() to GAS doPost
└── styles.css   # App-specific styles (imports shared/theme.css)
```

---

## 🔗 Backend Integration (GAS `doPost`)

All Mini Apps communicate with the Google Apps Script backend via `fetch()` to the GAS web app endpoint. Security is handled via Telegram `initData` validation.

| Action | GAS Handler | Sheet/Store | Slack Alert |
|--------|-------------|-------------|-------------|
| `telegram_mini_app_intake` | `saveTelegramIntakeToQueue()` | IntakeQueue | ✅ `#intake` |
| `telegram_mini_app_upload` | Drive folder upload | Google Drive | — |
| `telegram_status_lookup` | Search IntakeQueue by phone | CaseStatusLookups | — |
| `telegram_payment_log` | Log payment initiation | PaymentLog | ✅ `#payments` |
| `telegram_payment_lookup` | Search IntakeQueue + PaymentLog | — (read-only) | — |
| `telegram_checkin_log` | Log check-in + GPS + selfie | CheckInLog + MongoDB | ✅ `#check-ins` |
| `telegram_client_update` | Log update/tip | ClientUpdates + MongoDB | ✅ `#updates` |

---

## ⚡ Netlify Serverless Functions (17)

| Function | Purpose |
|----------|---------|
| `ai-concierge.mjs` | AI chat assistant (GPT-4o via GAS) |
| `charge-analyzer.mjs` | Criminal charge analysis + bail estimates |
| `checkin-geo-alert.mjs` | Geo-fenced check-in validation |
| `compliance-digest.mjs` | Automated compliance reports → Slack |
| `court-reminder.mjs` | Court date reminders (48h lookahead) |
| `daily-briefing.mjs` | Daily ops stats + forfeiture report → Slack |
| `document-explainer.mjs` | AI document explanation for clients |
| `elevenlabs-postcall.mjs` | Post-call transcript processing |
| `engagement-watchdog.mjs` | Escalate unacknowledged court reminders |
| `intake-summarizer.mjs` | Summarize intake submissions |
| `notify-bondsman.mjs` | Priority notifications to bondsmen |
| `risk-score.mjs` | Real-time risk scoring |
| `send-paperwork.mjs` | Trigger SignNow packet from Shannon calls |
| `sentiment-watchdog.mjs` | Client sentiment analysis → flag stress |
| `smart-notify.mjs` | Intelligent notification routing |
| `status-proxy.mjs` | Cached status lookups via GAS |
| `translate.mjs` | Multi-language translation |

---

## 🌐 Netlify Edge Functions (3)

| Function | Purpose |
|----------|---------|
| `elevenlabs-init.js` | Shannon voice AI session init (avoids GAS 302 redirect, near-zero cold start) |
| `county-detect.js` | Client IP → county geolocation for office routing |
| `twilio-voice-inbound.js` | Inbound voice call routing to Shannon or human |

---

## 🎨 Design System

All Mini Apps share a unified design system via `shared/theme.css` and `shared/brand.js`:

- **Dark mode by default** with Telegram theme auto-detection
- **Glassmorphism** (`backdrop-filter: blur()`, translucent surfaces)
- **Premium animations** — smooth transitions, loading spinners (never "Loading..." text)
- **Mobile-first** — thumb-friendly buttons (>44px touch targets), ≥16px inputs (no iOS zoom)
- **Shamrock green** accent palette with dark backgrounds
- **PWA-ready** — service worker, offline page, manifest.json

---

## 🚀 Deployment

- **Hosting**: Netlify — auto-deploys from `main` branch on push
- **Headers**: Permissive framing (`X-Frame-Options: ALLOWALL`) for Telegram WebViews
- **Caching**: Static assets cached 1 hour
- **Routing**: SPA-style redirects for all 7 Mini App paths via `netlify.toml`
- **Edge**: 3 edge functions deployed globally (Deno runtime)

### Environment Variables (Netlify Dashboard)
```
GAS_WEBHOOK_URL       # Google Apps Script web app URL
ELEVENLABS_API_KEY    # For Shannon voice init
ELEVENLABS_AGENT_ID   # Shannon agent ID
TWILIO_ACCOUNT_SID    # Voice routing
TWILIO_AUTH_TOKEN      # Voice routing
OPENAI_API_KEY        # AI functions
SLACK_WEBHOOK_URL     # Alert delivery
```

---

## 📦 GAS Backend Files

These files in `shamrock-bail-portal-site/backend-gas/` power the Mini Apps:

| File | Lines | Purpose |
|------|-------|---------|
| `Telegram_API.js` | 576 | `TelegramBotAPI` class — send messages, photos, keyboards |
| `Telegram_Webhook.js` | 853 | Inbound message routing, command handling |
| `Telegram_IntakeFlow.js` | 1,258 | Conversational intake state machine (30+ steps) |
| `Telegram_IntakeQueue.js` | 645 | Save intakes to Dashboard queue, admin email alerts |
| `Telegram_Notifications.js` | 775 | All outbound notifications (court, payment, signing, etc.) |
| `Telegram_Auth.js` | 357 | OTP authentication for portal login via Telegram |

---

## 🔗 Related Repos

| Repo | Purpose |
|------|---------|
| [shamrock-bail-portal-site](https://github.com/Shamrock2245/shamrock-bail-portal-site) | Wix website + GAS backend |
| [shamrock-node-red](https://github.com/Shamrock2245/shamrock-node-red) | Node-RED automation engine |
| [swfl-arrest-scrapers](https://github.com/Shamrock2245/swfl-arrest-scrapers) | 19-county scraper fleet |
| **shamrock-telegram-app** (this repo) | Telegram Mini-Apps (Netlify) |

---

*Maintained by Shamrock Engineering & AI Agents · March 2026*
