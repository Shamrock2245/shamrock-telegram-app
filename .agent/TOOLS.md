# 🔧 TOOLS — API & Function Map

> Every external API, Netlify function, and edge function in this repo.  
> Use this as the single source of truth for "what can I call and how?"

---

## External APIs

| API | Purpose | Auth Env Var | Base URL |
|-----|---------|-------------|----------|
| **OpenAI** (GPT-4o-mini) | Chat, risk scores, charge analysis, translations, summaries | `OPENAI_API_KEY` | Default (or `OPENAI_BASE_URL` if AI Gateway) |
| **Grok / xAI** | Alternative AI model (OpenAI-compatible) | `GROK_API_KEY` | `https://api.x.ai/v1` |
| **ElevenLabs** | Shannon voice agent (Twilio ↔ ElevenLabs Conversational AI) | `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` | `https://api.elevenlabs.io/v1/` |
| **Twilio** | SMS sending + inbound voice routing | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` | `https://api.twilio.com/2010-04-01/` |
| **SignNow** | Document signing (proxied through GAS) | `SEND_PAPERWORK_SECRET` (shared secret for Netlify→GAS auth) | Via GAS — not called directly |
| **SwipeSimple** | One-click payment links | None (public link) | Direct embed |
| **Google Apps Script** | Core backend: intake, status, payments, notifications, signing | `GAS_WEB_APP_URL` | See `shared/ai-client.mjs` |

---

## Netlify Serverless Functions (`netlify/functions/`)

All functions use ESM (`.mjs`). Shared utilities in `./shared/ai-client.mjs`.

| Function | Route | Method | Rate Limit | Purpose |
|----------|-------|--------|-----------|---------|
| `ai-concierge.mjs` | `/api/chat` | POST | 10/min | 24/7 chat bot. GPT-4o-mini with Shannon persona. Streams via SSE. |
| `charge-analyzer.mjs` | `/api/charges` | POST | — | Analyzes criminal charges. Returns severity, explanation, bail range. |
| `checkin-geo-alert.mjs` | `/api/checkin-geo-alert` | POST | — | Geo-fence alert when check-in location is suspicious. |
| `compliance-digest.mjs` | `/api/compliance-digest` | POST | — | Scheduled digest of compliance metrics for staff. |
| `court-reminder.mjs` | `/api/court-reminder` | POST | — | Sends court date reminders via SMS. |
| `daily-briefing.mjs` | `/api/daily-briefing` | POST | — | Morning briefing: new cases, upcoming courts, overdue check-ins. |
| `document-explainer.mjs` | `/api/explain` | POST | — | Explains bail bond documents in plain English. |
| `elevenlabs-postcall.mjs` | `/api/elevenlabs-postcall` | POST | — | Webhook: ElevenLabs post-call data (transcript, summary) → GAS. |
| `engagement-watchdog.mjs` | `/api/engagement-watchdog` | POST | — | Flags defendants who stopped checking in. |
| `intake-summarizer.mjs` | `/api/summarize` | POST | — | Summarizes intake data for Slack alerts. |
| `notify-bondsman.mjs` | `/api/notify-bondsman` | POST | — | Multi-channel alert to bondsman (Slack + SMS). |
| `risk-score.mjs` | `/api/risk-score` | POST | — | AI risk assessment (0–100 flight risk score). |
| `send-paperwork.mjs` | `/api/send-paperwork` | POST | — | ElevenLabs tool → GAS → SignNow. Sends signing links via email + SMS. |
| `sentiment-watchdog.mjs` | `/api/sentiment-watchdog` | POST | — | Analyzes client communication sentiment for risk flags. |
| `smart-notify.mjs` | `/api/notify` | POST | — | Intelligent notification routing (SMS vs. Slack vs. email). |
| `status-proxy.mjs` | `/api/status` | POST | — | Proxy for case status lookup against GAS. |
| `translate.mjs` | `/api/translate` | POST | — | Real-time translation (primarily English ↔ Spanish). |

### Shared Modules (`netlify/functions/shared/`)

| Module | Purpose |
|--------|---------|
| `ai-client.mjs` | OpenAI/Grok client factory, `GAS_ENDPOINT`, CORS headers, `jsonResponse()`, `errorResponse()`, `parseBody()`, `checkRateLimit()` |
| `rate-limiter.mjs` | IP-based rate limiting using `@netlify/blobs`. Per-function limits. |

---

## Netlify Edge Functions (`netlify/edge-functions/`)

Edge functions run on **Deno** at the CDN edge. Near-zero cold start (<50ms). Used for latency-critical paths.

| Function | Route | Purpose |
|----------|-------|---------|
| `elevenlabs-init.js` | `/api/elevenlabs-init` | Conversation initiation webhook. Returns caller ID + personalized first message for Shannon. |
| `twilio-voice-inbound.js` | `/api/twilio-voice` | **Smart Call Router.** Whitelist check → office phones or ElevenLabs AI. Sequential ring with AI fallback. |
| `county-detect.js` | `/*` (middleware) | Detects user's county from IP/geo. Injects `x-detected-county` header. |
| `language-detect.js` | `/*` (middleware) | Detects user's preferred language from `Accept-Language` header. |

---

## Frontend Shared Utilities (`shared/brand.js`)

| Function | Purpose |
|----------|---------|
| `initTelegram()` | SDK init: `tg.expand()`, `enableClosingConfirmation()`, `tg.ready()` |
| `initTheme()` | Apply saved theme (dark/light) from localStorage |
| `toggleTheme()` | Swap themes + haptic feedback |
| `formatPhone(value)` | Format digits → `(XXX) XXX-XXXX` |
| `isValidEmail(email)` | Regex email validation |
| `isValidPhone(phone)` | 10-digit check |
| `gasPost(endpoint, payload)` | **The canonical GAS fetch helper.** `text/plain`, `redirect: 'follow'`, JSON parsed. |
| `captureLocationTiered(opts)` | Race Telegram SDK, coarse, and GPS. First valid result wins. Manual fallback. |
| `saveFormSession(key, data)` | Persist form state to `sessionStorage` |
| `loadFormSession(key)` | Restore form state |
| `clearFormSession(key)` | Remove stored form state |
| `debounce(fn, delay)` | Standard debounce (default 300ms) |

### Constants

| Constant | Value |
|----------|-------|
| `SHAMROCK_GAS_ENDPOINT` | `https://script.google.com/macros/s/AKfycby.../exec` |
| `SHAMROCK_PHONE` | `(239) 332-2245` |
| `SHAMROCK_PAYMENT_LINK` | `https://swipesimple.com/links/lnk_07a13e...` |

---

## Environment Variables (Netlify Dashboard)

| Variable | Used By |
|----------|---------|
| `OPENAI_API_KEY` | `ai-concierge`, `charge-analyzer`, `risk-score`, `translate`, etc. |
| `OPENAI_BASE_URL` | Optional — set if using Netlify AI Gateway |
| `GROK_API_KEY` | `sentiment-watchdog`, alternative AI calls |
| `GAS_WEB_APP_URL` | All functions that proxy to GAS |
| `ELEVENLABS_API_KEY` | `twilio-voice-inbound` (edge), `elevenlabs-postcall` |
| `ELEVENLABS_AGENT_ID` | `twilio-voice-inbound` (edge) |
| `ELEVENLABS_TOOL_SECRET` | Auth for ElevenLabs→Netlify tool calls |
| `TWILIO_ACCOUNT_SID` | `send-paperwork` SMS sending |
| `TWILIO_AUTH_TOKEN` | `send-paperwork` SMS sending |
| `TWILIO_PHONE_NUMBER` | `send-paperwork` SMS from number |
| `SEND_PAPERWORK_SECRET` | `send-paperwork` shared secret auth |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API (used in GAS, referenced in Netlify) |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook verification |

---

*See also: [MEMORY.md](./MEMORY.md) for rules about how to use these tools, [AGENTS.md](./AGENTS.md) for who owns what.*
