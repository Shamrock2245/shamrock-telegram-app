# 👤 USER — Who Uses This System?

---

## The Architect

| Field | Value |
|-------|-------|
| Name | Brendan |
| Role | Owner / Operator / Builder |
| Focus | System architecture, AI integration, business growth |
| Style | Moves fast. Hates manual work. Wants "The Uber of Bail Bonds." |

Brendan reviews all code changes, sets priorities, and is the final decision-maker. He uses multiple AI agents (Antigravity, Manus) as his engineering team. He expects premium aesthetics, zero manual data entry, and mobile-first everything.

**When Brendan says:**
- *"Ship it"* → Deploy immediately.
- *"Finish the factory"* → Connect existing pipes, don't redesign.
- *"One thumb, one eye"* → The user should never have to think.

---

## End Users

### 1. 👨‍👩‍👧 The Indemnitor (Co-Signer)
> *A mother at 2 AM trying to bail out her son.*

| Trait | Detail |
|-------|--------|
| Emotional state | **Terrified, confused, exhausted** |
| Device | Phone (90%+), often Android |
| Tech literacy | Low to medium |
| Time pressure | Extreme — every minute feels like an hour |
| What they need | Speed, reassurance, clear next steps |
| Touchpoints | Shannon (voice/chat), Intake mini app, Payment mini app, signing links |

**Design for them:** Giant buttons (≥44px). No jargon. Progress indicators. Session persistence so they don't lose data if they close the app.

### 2. 🔒 The Defendant
> *Sitting in a holding cell, limited phone access.*

| Trait | Detail |
|-------|--------|
| Access | Jail phone (collect calls via GTL/Securus/ICSolutions) or family's phone |
| Emotional state | Anxious, disoriented, scared |
| What they need | To know someone is working on getting them out |
| Touchpoints | Defendant info collected by indemnitor, Status mini app (via family) |

**Design for them:** They rarely interact with our system directly. Their family does. Make the family's experience seamless so the defendant benefits.

### 3. 🏢 Bondsman / Staff
> *In the office or in the field, managing active cases.*

| Trait | Detail |
|-------|--------|
| Access | Desktop (Dashboard) + Mobile (Slack alerts) |
| What they need | Instant visibility into new intakes, signing status, payments |
| Touchpoints | Slack alerts, Google Sheets Dashboard, SignNow packet generation |

**Design for them:** Slack alerts with one-click links. Dashboard that auto-hydrates — zero re-entry.

### 4. 📞 Jail / Sheriff Callers
> *Collect calls from inmates or calls from law enforcement.*

| Trait | Detail |
|-------|--------|
| Why they call | Inmates calling Shamrock directly, or jail staff with booking info |
| Routing | **Whitelisted** in `twilio-voice-inbound.js` → ring office phones directly |
| Pattern matching | Exact numbers (GTL, Securus, ICSolutions) + prefix match (`239-477-****` = Lee County Sheriff) |

**Design for them:** They bypass Shannon entirely. Direct-to-office routing with sequential ring and fallback.

---

*See also: [IDENTITY.md](./IDENTITY.md) for Shannon's persona, [SOUL.md](./SOUL.md) for ethical guardrails.*
