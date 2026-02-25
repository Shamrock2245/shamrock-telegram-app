# Shamrock Bail Bonds — Telegram Mini Apps

> **One repo. Multiple Mini Apps. Shared design system.**

## Structure

```
├── index.html          ← App directory (root landing)
├── intake/             ← Quick Bail Intake (LIVE)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── payment/            ← Make a Payment (placeholder)
│   └── index.html
├── status/             ← My Case Status (placeholder)
│   └── index.html
├── shared/             ← Common design tokens & utilities
│   ├── theme.css       ← Brand colors, typography, components
│   ├── brand.js        ← Telegram SDK, theme toggle, helpers
│   └── botfather_photo.png
├── netlify.toml
└── README.md
```

## Mini Apps

| App | Path | Status | BotFather URL |
|-----|------|--------|---------------|
| Quick Bail Intake | `/intake/` | 🟢 Live | Set via `/newapp` |
| Make a Payment | `/payment/` | 🟡 Placeholder | — |
| My Case Status | `/status/` | 🟡 Placeholder | — |

## Backend

All Mini Apps post to the same GAS `doPost()` endpoint using action-based routing:
- `telegram_mini_app_intake` → `saveTelegramIntakeToQueue()`
- `telegram_mini_app_upload` → Google Drive file save

## Deploy

Netlify auto-deploys on push to `main`. The publish directory is `.` (root).
