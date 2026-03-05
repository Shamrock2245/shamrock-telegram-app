# 🧠 MEMORY — The Status Quo

> **These are the rules. They exist because we learned them the hard way.  
> Do NOT deviate unless Brendan explicitly says otherwise.**

---

## 🏢 Company Identity — NEVER GUESS THESE

> [!CAUTION]
> **Do NOT fabricate, hallucinate, or guess company details.** If unsure, check `portal-config.js` in the portal site repo. These values are sacred.

| Field | Canonical Value |
|-------|----------------|
| **Company Name** | Shamrock Bail Bonds |
| **Street Address** | 1528 Broadway |
| **City, State, ZIP** | Fort Myers, FL 33901 |
| **Full Address** | 1528 Broadway, Fort Myers, FL 33901 |
| **Main Phone** | (239) 332-2245 |
| **Spanish Line** | (239) 955-0305 |
| **Email** | shamrockbailbonds1528@gmail.com |
| **Source of Truth** | `src/public/portal-config.js` in `shamrock-bail-portal-site` |

---

## 🚫 Never

| Rule | Why |
|------|-----|
| **Never migrate the DB from Google Sheets** | Sheets IS the database. GAS reads/writes it. Everything depends on it. |
| **Never use `mode: 'no-cors'`** | It returns opaque responses (fake 200s). We burned a week on this. Use `gasPost()`. |
| **Never hardcode API keys in frontend code** | Keys go in Netlify env vars or Wix Secrets Manager. Period. |
| **Never commit `.env` files** | `.env` is in `.gitignore`. Always. |
| **Never use `fetch()` directly to GAS** | Use `gasPost()` from `shared/brand.js`. It handles `text/plain` content type to avoid CORS preflight. |
| **Never load `app.js` before `brand.js`** | `brand.js` defines shared helpers (`gasPost`, `formatPhone`, `tg`). Loading order matters. |
| **Never use `'Loading...'` as a loading state** | Use skeleton shimmer animations (defined in `shared/theme.css`). |
| **Never log PII in production** | No full names + charges in the same log line. No SSNs. No booking photos. |

---

## ✅ Always

| Rule | Detail |
|------|--------|
| **Always use `gasPost(endpoint, payload)`** | Defined in `shared/brand.js`. Uses `Content-Type: text/plain` + `redirect: 'follow'`. Returns parsed JSON. |
| **Always debounce phone inputs** | `debounce(150ms)` on all phone `<input>` fields. Defined in `brand.js`. |
| **Always use ≥44px tap targets** | Mobile-first. 90% of users are on phones in crisis. |
| **Always persist form state** | Use `saveFormSession()` / `loadFormSession()` from `brand.js`. Users accidentally close apps. |
| **Always use edge functions for latency-critical paths** | Voice init, call routing, county/language detection — all edge. <50ms cold start. |
| **Always validate `tg.initData` for Telegram requests** | Security at the SDK level. Don't trust raw tokens. |
| **Always follow the SignNow naming convention** | `Shamrock_<docId>_signer<N>_<caseNumber>` — the webhook parser depends on it. |
| **Always send Slack alerts on client-facing actions** | New intakes, payments, check-ins, tips — staff must see them immediately. |

---

## 🏗 Architecture Rules

1. **GAS is the factory.** All heavy lifting (PDF generation, intake processing, risk analysis, notification dispatch) happens in Google Apps Script.
2. **Netlify is middleware.** Functions are thin proxies. They format requests, enforce rate limits, and pass through to GAS or AI APIs.
3. **Edge functions for the hot path.** Voice calls, ElevenLabs init, county detection, language detection — anything where latency = dropped calls.
4. **Wix is the clipboard.** The Wix portal collects data and passes it to GAS. It does not own logic.
5. **The pipeline is sacred.** `Collect → Normalize → Store → Trigger → AI Process → Handoff` — every feature follows this flow.

---

## 🔧 Technical Specifics

| Topic | Canonical Value |
|-------|----------------|
| GAS endpoint (env) | `GAS_WEB_APP_URL` (Netlify env var) |
| GAS endpoint (fallback) | Hardcoded in `shared/brand.js` and `shared/ai-client.mjs` |
| GAS POST content type | `text/plain` (avoids CORS preflight) |
| Shamrock phone | `(239) 332-2245` |
| Payment link | SwipeSimple `lnk_07a13eb404d7f3057a56d56d8bb488c8` |
| Module system | ESM (`"type": "module"` in `package.json`) |
| Node bundler | esbuild (Netlify functions) |
| Edge runtime | Deno (Netlify edge functions) |
| Rate limiter | `@netlify/blobs` — IP-based, per-function |
| Lighthouse thresholds | Perf: 0.6 · A11y: 0.8 · Best Practices: 0.8 · SEO: 0.7 |

---

## 📋 Resolved Issues (Don't Re-Fix)

These were fixed in the Feb 27 audit. If you see them, they're already handled:

- ✅ `idFront` required field removed — skip link works
- ✅ Tiered location fallback — no more GPS-only failures
- ✅ All `no-cors` replaced with `gasPost()`
- ✅ `tg.sendData()` waits for all uploads (`Promise.allSettled`)
- ✅ `formatPhone()` canonical in `brand.js` only
- ✅ Selfie confirm dialog before close
- ✅ Network error shows "Connection Error" (not "Pending")
- ✅ Skeleton shimmer loading states
- ✅ Session persistence with `saveFormSession()`
- ✅ Consent checkbox is 44x44 tap target

---

*See also: [TOOLS.md](./TOOLS.md) for the full API map, [AGENTS.md](./AGENTS.md) for who touches what.*
