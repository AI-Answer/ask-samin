# Install: Ask Samin Claude Club skill

This skill teaches Claude **how to answer** using the Ask Samin MCP: always open with the Skool lesson link, credit Samin, then summarize.

MCP = data. Skill = reply format + workflow.

## Member setup (once)

### 1) Connect the MCP

1. Claude → **Customize → Connectors**
2. **Add custom connector** → name `Ask Samin`
3. URL: `https://ask-samin-ochre.vercel.app/mcp`
4. In a chat: **+ → Connectors** → enable Ask Samin

Team/Enterprise: an Owner adds the connector org-wide first; members then enable it.

### 2) Install this skill

1. Enable Skills: Claude → **Settings → Capabilities → Skills**
2. Add / upload the `ask-samin-claude-club` skill folder (this directory), or paste `SKILL.md` per Claude’s skill import flow for your plan
3. Confirm the skill appears and is enabled

### 3) Use it

Ask naturally, e.g.:

- “Where does Samin cover the trading use case?”
- “How do I connect an MCP the way Samin teaches?”
- “Find the Alpaca paper trading lesson in Claude Club”

Expected: **first sentence = Skool link**, then Samin attribution + short summary.

## What Club ops distribute

Zip and share this folder:

```text
ask-samin-claude-club/
  SKILL.md
  README.md  (this file)
  examples.md
```

Do **not** ask members to paste long custom instructions. The skill is the installable playbook.

## Verify

1. Enable Ask Samin MCP + this skill in a **new** chat
2. Ask: “Find me the trading use case in Claude Club”
3. Pass if sentence one contains `skool.com/claude/...`
