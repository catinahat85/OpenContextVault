# AGENTS.md — Open Context Vault (OC5)

> **Load context first.** At the start of every session, call the OC5 MCP tool
> `vault_primer` before answering. It returns this vault's immediate context
> (the root index), recent history (the log tail), and a map of every concept
> (id, type, title). Read it, then proceed.

## How to use this vault

This directory is an OKF knowledge bundle served over an MCP server. Each markdown
file is a **concept**; its path is its id. Treat it as your working memory.

1. **Orient** — `vault_primer` once, at session start. Don't skip it. It is the
   cheapest way to know what exists and what changed recently.
2. **Read on demand** — `vault_get <id>` to pull a concept in full. The primer
   gives you titles and types, not bodies; fetch bodies only when the task needs them.
3. **Find by topic** — `vault_search <query>` when you don't know the id.
4. **Write back** — `vault_put <id>` to create or update a concept as you learn
   things worth keeping. Cross-link with `[text](other-id)` so the graph stays connected.
5. **Record** — append a line to history with the log when you make a meaningful
   change, so the next session's primer reflects it.

## What lives where

- `index.md` — immediate context and the map of the vault. Keep it current; it is
  the first thing every agent reads.
- `log.md` — chronological history. The primer surfaces its recent tail.
- everything else — concepts, grouped loosely by folder (`concepts/`, `notes/`,
  `entities/`, `sources/`, `runbooks/`, `decisions/`). The `type` field is
  authoritative, not the folder.

## Rules

- Prefer updating an existing concept over creating a near-duplicate; search first.
- Keep concept bodies focused — one idea per file. Link rather than inline.
- Never rename a concept id casually; it breaks backlinks. Add an `ocv.aliases`
  entry instead.
