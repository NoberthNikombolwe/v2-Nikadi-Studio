# Nikadi Studio — MCP Connections

**Last updated:** 2026-11-16

---

## 1. What is MCP?

MCP (Model Context Protocol) is an open protocol that lets Claude Code connect to external tools, services and data sources. MCP servers expose resources (data to read), tools (actions to call), and prompts (pre-built templates) that Claude Code can use during development.

For Nikadi Studio development, MCP servers provide Claude Code with direct access to the Supabase project, file system search, and potentially the messaging provider.

---

## 2. Current MCP Setup

### 2.1 Configuration Location

MCP servers are configured in Claude Code settings:
- **User-level:** `~/.claude/settings.json` (applies to all projects)
- **Project-level:** `v1-Nikadi-Studio/.claude/settings.json` (applies to this project only)

Check your current configuration:
```bash
# In a Claude Code session
/mcp
```

### 2.2 Recommended MCP Servers for This Project

#### Supabase MCP Server

Gives Claude Code direct read access to the database schema, table data, and can run SQL queries.

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest"],
      "env": {
        "SUPABASE_URL": "https://xxxxxxxxxxx.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your_service_role_key_here"
      }
    }
  }
}
```

**What this enables:**
- Claude Code can inspect actual table data to understand real-world usage
- SQL queries can be run directly during debugging
- Schema inspection without reading SQL files

**Security note:** The service role key bypasses RLS. Only add this to your local user settings — never commit it to the repo.

#### Filesystem MCP Server (built-in)

Claude Code has built-in file read/write/search capabilities. No MCP server needed.

#### GitHub MCP Server

For PR creation, issue tracking, and CI status checks during development.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    }
  }
}
```

---

## 3. Setting Up MCP Servers

### 3.1 Add to User Settings

```bash
# Open Claude Code settings
claude config
# Or edit directly:
# ~/.claude/settings.json
```

Add the `mcpServers` block to `settings.json`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest"],
      "env": {
        "SUPABASE_URL": "https://xxxxxxxxxxx.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOi..."
      }
    }
  }
}
```

### 3.2 Verify Connection

```bash
# In a Claude Code session in the project directory
/mcp
# Should list connected servers

# Test by asking Claude to query the database
# "How many events are in the database?"
```

### 3.3 Authorise an MCP Server (OAuth)

Some servers (Slack, Linear, Figma) require OAuth. Run in an interactive session:

```bash
claude
/mcp
# Select the server → Authorise
```

---

## 4. MCP Usage in This Project

### 4.1 Database Inspection

With Supabase MCP connected, Claude Code can:

```
"How many event_cards have no card_code set?"
"Show me the latest 10 event_logs entries"
"What events have guest_link_enabled = true?"
"Check if the event_pages table was created correctly"
```

This is much faster than reading SQL files and cross-referencing.

### 4.2 Schema Validation

After running `supabase-schema.sql`:
```
"Verify that event_pages table exists with all the expected columns"
"Check that the public_event_page_data function exists and has the correct signature"
```

### 4.3 Debugging Live Issues

```
"The guest microsite is returning null — check if any events have guest_link_enabled = true and a matching event_pages row"
"Check the last 20 event_logs entries for event ID X"
```

---

## 5. MCP Security for This Project

### 5.1 Service Role Key

The Supabase service role key bypasses all RLS policies. It should:
- Only be in your local `~/.claude/settings.json` (not in the project `.claude/settings.json`)
- Never be committed to the repository
- Never be shared

### 5.2 Read-Only Usage

When using MCP for database inspection, prefer SELECT queries. Avoid INSERT/UPDATE/DELETE via MCP unless actively debugging a data issue.

### 5.3 Sensitive Data

The database contains phone numbers and event details. When Claude Code reads live data via MCP:
- It is processing real customer data
- Do not share MCP query results externally
- Use the development/staging Supabase project for most debugging, not production

---

## 6. MCP for the Messaging Provider

The messaging-service.co.tz API does not have a public MCP server. Use the Supabase MCP server to inspect `message_deliveries`, `event_logs`, and scheduled messages instead.

If you need to test provider API calls directly, use the Vite dev server proxy:
```bash
# Start dev server and use the SMS tab to test sends
npm run dev
```

---

## 7. Planned MCP Integrations

| Integration | Purpose | Status |
|-------------|---------|--------|
| Supabase MCP | Database inspection, schema validation | Recommended |
| GitHub MCP | PR creation, CI monitoring | Optional |
| Browser MCP | Test the UI in a real browser from Claude Code | Optional |

---

## 8. MCP Troubleshooting

| Issue | Fix |
|-------|-----|
| Server not appearing in `/mcp` | Check JSON syntax in `settings.json`; restart Claude Code |
| Auth required error | Run `claude` interactively and use `/mcp` to authorise |
| Supabase query fails | Check the service role key is correct and the project URL matches |
| npx times out | Run `npx @supabase/mcp-server-supabase@latest` manually first to install |
