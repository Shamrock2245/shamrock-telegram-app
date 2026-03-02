---
name: Netlify Best Practices
description: AI Agent guide on using Netlify Edge Functions, Blobs, and Serverless Functions in the Shamrock Telegram App.
---

# Netlify Best Practices — Telegram App

## 🏛 Architecture
*   **Wix** = Clipboard (main site UI)
*   **GAS** = Factory (heavy backend logic, PDF, Sheets)
*   **Netlify** = Edge & Middleware (this repo — low-latency routing, API proxying, caching)

## 🚀 Edge Functions (`netlify/edge-functions/`)
Use for intercepting Telegram webhooks that need immediate validation, and for geo-routing users to localized UI.

**Rule:** Do NOT use for heavy processing (>10s). Route to GAS instead.

## 📦 Blobs (`@netlify/blobs`)
Use for caching user session state mid-intake. Keyed by `chat_id`. Ephemeral only — permanent records go to Google Drive/Sheets.

## 🤖 Serverless Functions (`netlify/functions/`)
Use for proxying OpenAI/Grok/ElevenLabs API calls. Keep API keys in Netlify Environment Variables, never in frontend code.

## 🛠 Dev Workflow
1. `netlify dev` for local testing
2. All config in `netlify.toml` (no hardcoded redirects in JS)
3. Functions accessible at `/.netlify/functions/<name>`
