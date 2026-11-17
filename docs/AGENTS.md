# Nikadi Studio — AI Agents

**Last updated:** 2026-11-16

---

## 1. Overview

Nikadi Studio has one integrated AI agent: the **Data Clean Chat** feature. It is a Gemini-powered assistant that helps staff clean and format guest import data before it is used.

A Claude Code agent (this tooling) is used for development — it is not a runtime agent in the product.

---

## 2. Data Clean Chat Agent

### 2.1 Purpose

Guest lists are often imported from Excel/CSV files produced by clients. Data quality issues are common:
- Mixed phone formats (`0712345678`, `+255712345678`, `712 345 678`)
- Missing card types
- Duplicate names
- Names in wrong order (family name first)
- Mixed English/Swahili column headers
- Photos pasted into the spreadsheet instead of text

The agent helps staff correct these issues conversationally before the import proceeds.

### 2.2 UI

Located in the **Contacts** tab → "Clean data" button. Opens `<CleanDataChat>` in `src/CleanDataChat.jsx`.

The staff member can:
1. Paste raw data from a spreadsheet (or type a question)
2. Receive cleaned/reformatted data with an explanation
3. Ask follow-up questions ("make all names Title Case", "remove duplicates", "add card type VIP to everyone")
4. Copy the cleaned output

### 2.3 Technical Flow

```
User message
  │
  ├── Dev:  Vite plugin handles POST /ai-clean
  │            (uses GEMINI_API_KEY, never reaches browser)
  │
  └── Prod: Supabase Edge Function /functions/v1/ai-clean
               verifies Supabase session
               → calls Gemini API with provider key

Response: cleaned data + explanation
```

### 2.4 Shared Logic: `dataClean.js`

`supabase/functions/_shared/dataClean.js` contains:
- `runCleanChat(messages, options)` — the main agent function
- System prompt instructions for the agent
- Input validation and size limits (`CLEAN_LIMITS`)
- Provider call logic (Gemini `generateContent` API)

This same file is imported by both the Vite dev plugin (in `vite.config.js`) and the production Edge Function (`ai-clean/index.ts`), ensuring identical behaviour in both environments.

### 2.5 System Prompt Guidelines

The agent is instructed to:
- Treat input as Tanzanian event guest data
- Normalise phone numbers to `2557XXXXXXXX` format
- Standardise card types to common values (SINGLE, DOUBLE, VIP, FAMILY)
- Output cleaned data in the same format as the input
- Explain what was changed and why
- Never invent data — only clean what is given

### 2.6 Limits

| Limit | Value |
|-------|-------|
| Max request body | `CLEAN_LIMITS.bodyBytes` |
| Conversation history sent per request | Last N turns (rolling window) |
| Gemini model | `GEMINI_MODEL` env var, falls back to a default |

### 2.7 Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | `.env.development.local` | Dev only — not `VITE_`, never reaches browser |
| `GEMINI_MODEL` | `.env.development.local` | Optional model override |
| Supabase Vault secret | Production Edge Function environment | Gemini API key in production |

---

## 3. Claude Code (Development Agent)

Claude Code is the AI coding assistant used for developing Nikadi Studio. It is not embedded in the product but is used extensively in the development workflow.

### 3.1 Memory System

Claude Code's project memory lives in:
```
.claude/projects/c--Users-nnikombolwe-Documents-git-v1-Nikadi-Studio/memory/
```

Memory types:
- `user/` — developer preferences and context
- `feedback/` — corrections and confirmed approaches
- `project/` — ongoing work, decisions, deadlines
- `reference/` — pointers to external resources

### 3.2 Established Rules for Claude Code in This Repo

These rules are remembered across sessions (see `MEMORY.md` in the memory folder):

| Rule | Rationale |
|------|-----------|
| No emoji in UI — use inline SVG icons from `src/Icon.jsx` | Consistency, accessibility |
| Modals close only via ✕ / Cancel button — no backdrop click, no Esc | Prevents accidental close mid-form |
| Never add `anon` policies for data tables or buckets | Security — anon key is public |
| Never hard-code root-absolute URLs — use `import.meta.env.BASE_URL` | Heroku sub-path compatibility |
| Do NOT split `App.jsx` unless asked | Architecture decision |
| `App.jsx` uses CRLF line endings | Windows repo convention |
| Never append hex alpha to `N.*` tokens — use `alpha(N.sky, "44")` | CSS variables cannot have hex suffix |
| Super Admin only can delete — wrap delete buttons in `{canDelete && (...)}` | RBAC enforcement in UI |

### 3.3 How to Use Claude Code Effectively in This Repo

```
# Start a session
claude

# Check what changed on the dev branch
/code-review

# Run a thorough multi-agent review
/code-review ultra

# Apply a fix
# 1. Read the relevant file first
# 2. Make targeted edits
# 3. Run npm run build to verify
# 4. Commit
```

---

## 4. Future Agent Opportunities

The following AI features are not yet implemented but are natural extensions:

### 4.1 Smart SMS Template Generator

An agent that takes the event details (name, date, venue, type) and auto-drafts an SMS message in English and Swahili.

### 4.2 Lead Follow-up Suggester

An agent that reads the lead's history and suggests the next follow-up action and message.

### 4.3 Card Layout Recommender

An agent that looks at the event type and template and suggests optimal element positioning.

### 4.4 Delivery Anomaly Detector

An agent that monitors delivery report patterns and flags events where many numbers are invalid or undelivered.

---

## 5. Agent Integration Checklist

When adding a new AI agent to the product:

- [ ] Logic lives in `supabase/functions/_shared/` (shared with Vite dev plugin)
- [ ] Dev version runs in Vite plugin (no browser-exposed secrets)
- [ ] Prod version runs in Edge Function (session verified, key from Vault)
- [ ] Input size limits enforced before the API call
- [ ] System prompt reviewed for data handling of Tanzanian PII (names, phones)
- [ ] Output is treated as untrusted until validated
- [ ] No hardcoded API keys in browser-bundled code
