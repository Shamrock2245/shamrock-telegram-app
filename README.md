# 🍀 Shamrock Bail Bonds — Telegram Mini App

A premium, mobile-first bail intake form that runs inside Telegram's WebView.

## Architecture

```
Telegram Bot  →  Mini App (this repo)  →  GAS Backend (doPost)
     ↕                                         ↕
  @BotFather                            Google Sheets / Drive
```

- **Frontend**: Static HTML/CSS/JS (no framework, fast load)
- **Hosting**: Netlify (auto-deploy from `main`)
- **Backend**: Google Apps Script (in `shamrock-bail-portal-site/backend-gas/`)
- **SDK**: [Telegram WebApp API](https://core.telegram.org/bots/webapps)

## Features

- 5-step intake wizard (defendant → indemnitor → references → docs → review)
- Dark/light mode toggle with localStorage persistence
- Telegram user pre-fill, haptic feedback, native back button
- GPS capture via Telegram LocationManager or browser geolocation
- Photo ID upload with base64 encoding
- Phone number auto-formatting
- Submits to GAS `doPost()` endpoint

## Setup

1. Deploy to Netlify (connect this repo)
2. Set Mini App URL in BotFather: `/newapp` or `/setmenubutton`
3. Update `CONFIG.GAS_ENDPOINT` in `app.js` with your GAS deployment URL

## Local Development

```bash
# Just open index.html in a browser, or:
npx serve .
```
