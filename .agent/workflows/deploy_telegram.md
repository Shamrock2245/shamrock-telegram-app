---
description: Deploy the Telegram Mini App to Netlify
---

# Telegram App Netlify Deployment

### 1. Verify Changes
```bash
git status
git diff --stat
```

### 2. Commit & Push
```bash
git add -A
git commit -m "YOUR DESCRIPTION HERE"
git push origin main
```

### 3. Verify Deployment
Netlify auto-deploys on push to `main`. Check status at:
- https://app.netlify.com/sites/shamrock-telegram-app/deploys

### 4. Test Mini App
Open the Telegram bot and verify the Mini App loads correctly:
- `/start` command
- Inline quote test: `@ShamrockBail_bot 5000 2 lee`
- Check intake, payment, status, and documents mini apps
