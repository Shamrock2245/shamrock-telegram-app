# 🤝 AGENTS — Multi-Agent Coordination

> Multiple AI agents work on this system. This document defines who does what,  
> how handoffs work, and how conflicts are resolved.

---

## The Agents

### 🪐 Antigravity (Google Gemini)
| Field | Value |
|-------|-------|
| Specialty | Architecture, security, backend wiring, deployments, system-wide audits |
| Repos | `shamrock-telegram-app`, `shamrock-bail-portal-site` (full access) |
| Strengths | Deep codebase analysis, multi-file refactors, GAS↔Netlify bridge work |
| Tools | MCP servers (ElevenLabs, SignNow, Slack, GitHub, Filesystem) |

**Antigravity owns:**
- Netlify function architecture and security hardening
- GAS backend integration and deployment (`clasp push`)
- Webhook wiring (ElevenLabs, Twilio, Telegram)
- Knowledge base curation (Shannon's county data, agent prompts)
- These `.agent/` context files

### 🦾 Manus
| Field | Value |
|-------|-------|
| Specialty | UI/UX polish, frontend fixes, mini app hardening, visual QA |
| Repos | `shamrock-telegram-app` (primary), `shamrock-bail-portal-site` |
| Strengths | HTML/CSS/JS fixes, accessibility, mobile responsiveness |

**Manus owns:**
- Mini app UI (intake, payment, status, updates, documents, defendant)
- `shared/theme.css` design tokens
- Lighthouse score improvements
- Frontend bug fixes (tap targets, loading states, form persistence)

### 🎙 Shannon (Not a Dev Agent)
| Field | Value |
|-------|-------|
| Role | The AI persona (see [IDENTITY.md](./IDENTITY.md)) |
| Platform | ElevenLabs Conversational AI + AI Concierge chat |
| Note | Shannon is the product, not a developer. |

Shannon doesn't write code. She IS the code. Changes to Shannon's behavior are made by updating:
- ElevenLabs agent system prompt (via MCP or dashboard)
- `ai-concierge.mjs` `SYSTEM_PROMPT` constant
- `elevenlabs-init.js` greeting logic

---

## Handoff Protocol

At the end of every work session, the active agent **MUST**:

0. **Before writing ANY company contact info** (address, phone, email): read `MEMORY.md` → Company Identity section. Never generate these from memory.

1. **Create/update `YYYY-MM-DD.md`** in `.agent/` with:
   - What was done this session
   - What's still open
   - Any gotchas the next agent needs to know
   - Relevant commit hashes

2. **Update `MEMORY.md`** if any new "never/always" rules were discovered.

3. **Leave the repo in a deployable state.** If a change is half-done, either finish it or revert it. No broken deploys.

### Log File Format

```
.agent/
├── 2026-02-27.md    ← Manus: 12-issue audit
├── 2026-03-04.md    ← Antigravity: context files + smart routing
├── 2026-03-05.md    ← (next session)
```

---

## Conflict Resolution

| Scenario | Resolution |
|----------|------------|
| Two agents edit the same file | Later commit must reference the earlier commit in the log. If logic conflicts, ask Brendan. |
| Agent A disagrees with Agent B's approach | Document both approaches in the session log. Brendan decides. |
| Agent discovers a bug from a previous session | Fix it, note it in the log, don't blame the other agent. We're a team. |
| Unclear ownership | Check this file. If still unclear, ask Brendan. |

---

## Quick Reference: Who Touches What

| File/Directory | Primary Owner |
|----------------|---------------|
| `netlify/functions/` | Antigravity |
| `netlify/edge-functions/` | Antigravity |
| `shared/brand.js` | Shared (both) |
| `shared/theme.css` | Manus |
| `intake/`, `payment/`, `status/`, `updates/` | Manus |
| `netlify.toml` | Antigravity |
| `.agent/` | Antigravity |
| `AI_AGENT_NETLIFY_GUIDE.md` | Antigravity |

---

*See also: [TOOLS.md](./TOOLS.md) for what's available, [MEMORY.md](./MEMORY.md) for rules that apply to all agents.*
