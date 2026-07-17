# Ask Samin — Claude Club skill

Teaches Claude **how to answer** using the Ask Samin MCP: always open with the Skool lesson link, credit Samin, then summarize.

| Layer | Job |
|--------|-----|
| **MCP** | Retrieve lessons, URLs, timestamps from Claude Club |
| **Skill** | Gatekeep reply format (link first) + when to call tools |

---

## One-time setup

### A) Connect the MCP (required)

**Claude.ai / Claude Desktop**

1. Open **Customize → Connectors**
2. **+ → Add custom connector**
3. Name: `Ask Samin`
4. URL:

```text
https://ask-samin-ochre.vercel.app/mcp
```

5. **Add**, then in a chat: **+ → Connectors** → enable **Ask Samin**

Team / Enterprise: an Owner adds the connector in org settings first; members then enable it.

**Claude Code** (optional MCP config in `~/.claude.json` / project MCP settings):

```json
{
  "mcpServers": {
    "ask-samin": {
      "type": "http",
      "url": "https://ask-samin-ochre.vercel.app/mcp"
    }
  }
}
```

Exact file location depends on your Claude Code version — use the app’s “Add MCP server” UI if unsure.

### B) Install this skill

#### Option 1 — one command (Claude Code, Cursor, Codex)

```bash
npx skills add AI-Answer/ask-samin \
  --skill ask-samin-claude-club \
  -g \
  -a claude-code \
  -y
```

Also install for Cursor:

```bash
npx skills add AI-Answer/ask-samin \
  --skill ask-samin-claude-club \
  -g \
  -a cursor \
  -y
```

List what’s in the repo:

```bash
npx skills add AI-Answer/ask-samin --list
```

#### Option 2 — zip (Claude.ai Skills UI)

1. Download: [ask-samin-claude-club.zip](https://ask-samin-ochre.vercel.app/skills/ask-samin-claude-club.zip)
2. Claude → **Settings → Capabilities → Skills** → enable Skills
3. Add / upload the unzipped `ask-samin-claude-club` folder
4. Confirm the skill is enabled

---

## How to retrieve answers

1. Start a **new chat**
2. Enable **Ask Samin** (MCP) for that chat
3. Ask in plain language, for example:

| You ask | What should happen |
|---------|-------------------|
| “Where does Samin cover the trading use case?” | `search` → Skool link in sentence 1 → short summary |
| “How do I connect an MCP the way Samin teaches?” | Same, Masterclass lesson URL first |
| “Find the Alpaca paper trading lesson” | Link + Day path + summary |
| “Go deeper on that lesson” | `fetch` with `sourceId` → more body, still lead with URL |

### Expected reply shape

```text
[Skool URL as markdown link — FIRST sentence]

This is how Samin covers it in Claude Club (path…).

Short useful summary…

Watch around ~mm:ss if a timestamp was returned.
```

### Pass / fail check

- **Pass:** first sentence is markdown `[title](https://www.skool.com/claude/...)` with a real https URL
- **Fail:** title-only (“Here’s the lesson: 📝 … — Day 15”) with no `https://www.skool.com/...`

If Ask Samin tools are missing, Claude should tell you to connect the MCP — not invent Club content.

---

## Club ops: what to send members

**Minimum handoff**

1. MCP URL: `https://ask-samin-ochre.vercel.app/mcp`
2. Skill install:
   - Devs: the `npx skills add …` command above  
   - Claude.ai: the zip link  
3. Full guide: https://ask-samin-ochre.vercel.app/connect  

Do **not** ask members to paste long custom instructions — this skill is the playbook.

---

## Files in this folder

- `SKILL.md` — agent instructions (loaded by Claude / coding agents)
- `examples.md` — good vs bad replies
- `README.md` — this install + usage guide
