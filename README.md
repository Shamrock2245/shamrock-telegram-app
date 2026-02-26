# 🍀 Shamrock Bail Bonds — Telegram Mini Apps

**Live URL**: [shamrock-telegram.netlify.app](https://shamrock-telegram.netlify.app)

Four production Mini Apps for the Shamrock Bail Bonds Telegram bot (`@ShamrockBail_bot`), built for mobile-first crisis situations.

> **Last verified**: 2026-02-26 — All 7 backend handlers confirmed operational.

## Mini Apps

| App | Path | Status | Description |
|-----|------|--------|-------------|
| 🏠 Hub | `/` | ✅ Live | Central navigation to all Mini Apps |
| 📋 Intake | `/intake/` | ✅ Live | Quick bail intake form (defendant + indemnitor info, document uploads, GPS) |
| 💳 Payment | `/payment/` | ✅ Live | Make payments, check-ins with selfie + GPS logging |
| 📊 Status | `/status/` | ✅ Live | Case status lookup (court dates, payments, charges from real GAS data) |
| 📝 Updates | `/updates/` | ✅ Live | Update contact info, address, request payment extensions, anonymous tips |

## Architecture

```
shamrock-telegram-app/
├── index.html              # Hub / landing page
├── shared/
│   ├── theme.css           # Design tokens & CSS variables (dark/light themes)
│   └── brand.js            # Telegram SDK init, theme management, utilities
├── intake/
│   ├── index.html          # 5-step intake form
│   ├── app.js              # Multi-step intake → GAS doPost
│   └── styles.css          # Intake-specific styles
├── payment/
│   ├── index.html          # Payment & check-in flow
│   ├── app.js              # Dual payment/check-in flow → GAS
│   └── styles.css          # Payment-specific styles
├── status/
│   ├── index.html          # Case dashboard with court dates, payments, docs
│   ├── app.js              # Phone lookup → real case data from GAS
│   └── styles.css          # Status-specific styles
├── updates/
│   ├── index.html          # 5 update types + anonymous tips
│   ├── app.js              # Contact/address/extension/circumstances updates → GAS
│   └── styles.css          # Updates-specific styles
└── netlify.toml            # Hosting config, CORS, SPA redirects
```

## Backend Integration (GAS `doPost`)

All Mini Apps communicate with the Google Apps Script backend via `fetch` to the GAS web app endpoint. Actions bypass API key verification (Mini Apps use `no-cors`); security is via Telegram `initData`.

| Action | GAS Handler | Sheet | Slack Alert |
|--------|------------|-------|-------------|
| `telegram_mini_app_intake` | `saveTelegramIntakeToQueue()` | IntakeQueue | ✅ |
| `telegram_mini_app_upload` | Drive folder upload | — | — |
| `telegram_status_lookup` | Search IntakeQueue by phone | CaseStatusLookups | — |
| `telegram_payment_log` | Log payment initiation | PaymentLog | ✅ |
| `telegram_payment_lookup` | Search IntakeQueue + PaymentLog | — (read-only) | — |
| `telegram_checkin_log` | Log check-in + GPS + selfie | CheckInLog | ✅ |
| `telegram_client_update` | Log update/tip | ClientUpdates | ✅ |

## GAS Backend Files (in `shamrock-bail-portal-site/backend-gas/`)

| File | Lines | Purpose |
|------|-------|---------|
| `Telegram_API.js` | 576 | `TelegramBotAPI` class — send messages, photos, keyboards |
| `Telegram_Webhook.js` | 853 | Inbound message routing, command handling |
| `Telegram_IntakeFlow.js` | 1,258 | Conversational intake state machine (30+ steps) |
| `Telegram_IntakeQueue.js` | 645 | Save intakes to Dashboard queue, admin email alerts |
| `Telegram_Notifications.js` | 775 | All outbound notifications (court, payment, signing, etc.) |
| `Telegram_Auth.js` | 357 | OTP authentication for portal login via Telegram |

## Deployment

- **Frontend**: Hosted on **Netlify** — auto-deploys from `main` branch
  - Permissive framing headers (`X-Frame-Options: ALLOWALL`) for Telegram WebViews
  - Static asset caching (1 hour)
  - SPA-style redirects for all 4 Mini App paths
- **Backend**: Google Apps Script — deployed as web app
- **Webhook**: Registered via `registerWebhook.js` → Wix `telegram-webhook.jsw` → GAS `doPost`

## Testing

Open the bot in Telegram: [@ShamrockBail_bot](https://t.me/ShamrockBail_bot)

Or access Mini Apps directly:
- Hub: https://shamrock-telegram.netlify.app
- Intake: https://shamrock-telegram.netlify.app/intake/
- Payment: https://shamrock-telegram.netlify.app/payment/
- Status: https://shamrock-telegram.netlify.app/status/
- Updates: https://shamrock-telegram.netlify.app/updates/
