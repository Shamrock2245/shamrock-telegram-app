# 🤖 AI Agent Netlify Guide: Telegram App

Welcome, AI Agent (Manus, Cline, or Antigravity). This is your specific context guide for building, maintaining, and extending the **Shamrock Telegraph App** on Netlify.

## 🏗 Infrastructure Context
This project (`shamrock-telegram-app`) is hosted on **Netlify**. Its primary purpose is to serve as the Frontend and Edge Middleware for the Shamrock Telegram bot operations.

### Key Rules for AI Agents:
1. **The Backend is Google Apps Script (GAS)**: 
   - This app *submits* data to GAS. It does *not* replace GAS. 
   - Never attempt to migrate the core database away from Google Sheets.
2. **Follow the `netlify.toml`**:
   - All redirects, headers, and build commands are defined in `netlify.toml`. Do not create a separate `.htaccess` or try to configure server rules outside of the TOML.
3. **Secrets Manager vs. Environment Variables**:
   - For Netlify-specific secrets (like an AI model API key used in a serverless function), use **Netlify Environment Variables**.
   - Do not commit `.env` files. Ensure `.env` is in the Gitignore.

---

## 🚀 Integrating Netlify Best Practices
Based on the Shamrock Ecosystem Standards, here is how you should implement new features in this repository:

### 1. Edge Functions (`netlify/edge-functions/`)
- Use for intercepting Telegram webhooks if immediate validation is required before passing the payload to GAS.
- Use for returning localized UI versions based on the user's geographic location.

### 2. Blobs (`@netlify/blobs`)
- Use for caching user session states locally at the edge. 
- Example: If the user is halfway through an intake form on the Telegram Mini App, cache their answers in a Netlify Blob so that if they close the app, they can resume instantly without waiting for a GAS read operation.

### 3. Serverless Functions (`netlify/functions/`)
- This is where you should build proxies for external APIs (OpenAI, Grok, ElevenLabs) to keep API keys secure and reduce latency.
- Example: `netlify/functions/analyze_risk.js` queries OpenAI and returns a risk score to the frontend, bypassing GAS for the AI generation step to ensure immediate feedback to the user.

---

## 🛠 Development Workflow
If the user asks you to test changes:
1. Ensure you are using `netlify dev` to spin up the local server.
2. Remember that Serverless functions are available at `/.netlify/functions/function-name`. Do not try to access them via an `/api/` path unless a redirect is explicitly set up in `netlify.toml`.
3. Check the `package.json` for custom build scripts before running a standard deployment.
