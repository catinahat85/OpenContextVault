<p align="center">
  <img src="assets/brand/oc5-logo.svg" alt="OC5 — Open Context Vault logo" width="200">
</p>

# Open Context Vault (OC5)

An open-source, OKF-native knowledge vault. Plain markdown and YAML on disk, served over a REST API and an MCP server, with hybrid search. No app lock-in, no proprietary database, Apache-2.0.

> OC5 is a proof of concept for [Open Knowledge Format (OKF)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/), the open file format for agent-readable knowledge introduced by Google Cloud. See the [OKF spec](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) for the format this vault implements.

This is the open, standardized version of the thing Obsidian proved people want and Logseq is drifting away from. A vault is just a folder of markdown files. Agents read and write it through MCP. Humans read and write it in any editor. The file format is the contract, and the contract is [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf).

## Why it exists

The knowledge-for-agents layer has a proprietary leader (Obsidian), an open leader walking away from portable markdown (Logseq, now on a SQLite backend), and a pile of one-off MCP-over-vault connectors that each reinvent the schema. None of them is the open, neutral, standardized version. OC5 is a bet on that empty slot: take the OKF file format, wrap it in the read/write/link/search functions a knowledge tool needs, serve it to agents over MCP without restrictions, and define a small content profile so vaults are consistent across producers.

## What's in the box

- **`src/core/vault.js`** — the engine. OKF-conformant read, write, link, graph, keyword + hybrid search, backlinks. Single source of truth.
- **`src/core/embedder.js`** — pluggable embedder for hybrid search (OpenAI/OpenRouter-compatible, BGE-M3 by default).
- **`src/rest/server.js`** — REST API over the core.
- **`src/mcp/server.js`** — MCP server exposing the same functions as agent tools.
- **`src/core/import-obsidian.js`** — convert an existing Obsidian vault into OC5/OKF.
- **`src/core/sync.js`** — peer-to-peer vault reconciliation (content-hash, last-write-wins, backups).
- **`src/core/live-sync.js`** — real-time sync agent over SSE.
- **`src/core/watch.js`** — cross-platform file watcher.
- **`src/core/peers.js`** — peer registry and Git fallback.
- **`src/cli.js`** — seed a demo bundle, import an Obsidian vault, render a standalone graph viewer.
- **`PROFILE.md`** — the OC5 Profile: a content model layered on OKF.

REST and MCP both call the core, so the two surfaces can never drift.

## OKF conformance

- A vault is a directory of markdown files; each file is a **concept**.
- The file path (without `.md`) is the concept's **identity**.
- Frontmatter requires exactly one field: `type`. Reserved queryable fields: `type, title, description, resource, tags, timestamp`.
- Concepts cross-link with normal markdown links `[text](path)`, forming the graph.
- `index.md` and `log.md` are reserved filenames.

A vault written by OC5 is a valid OKF bundle. A valid OKF bundle from anywhere else can be read by OC5.

## Hybrid search

Search blends keyword scoring with vector similarity when an embedder is configured, and falls back to keyword-only when it isn't, so the vault always works.

Point it at any OpenAI-compatible embeddings endpoint:

```bash
export OCV_EMBED_URL=https://openrouter.ai/api/v1/embeddings   # or a local server
export OCV_EMBED_MODEL=baai/bge-m3
export OCV_EMBED_KEY=...                                        # if required
```

No `OCV_EMBED_URL` set means keyword-only mode. Tune the blend with the `alpha` option in `vault.search()` (0 = keyword only, 1 = vector only, default 0.5).

## Quick start

```bash
npm install
node src/cli.js seed ./vault     # write a small demo bundle
node src/cli.js viz  ./vault     # write vault/viz.html — open it, no backend

# REST API
node src/rest/server.js ./vault 8787
curl localhost:8787/concepts
curl "localhost:8787/search?q=knowledge%20format%20for%20agents"

# MCP server (stdio) — point any MCP client at this
OCV_PATH=./vault node src/mcp/server.js
```

### MCP tools

`vault_primer` (load first), `vault_list`, `vault_get`, `vault_put`, `vault_delete`, `vault_search`, `vault_graph`, `vault_backlinks`.

### Wiring into an MCP client

```json
{
  "mcpServers": {
    "open-context-vault": {
      "command": "node",
      "args": ["src/mcp/server.js", "/absolute/path/to/vault"],
      "env": {
        "OCV_EMBED_URL": "https://openrouter.ai/api/v1/embeddings",
        "OCV_EMBED_MODEL": "baai/bge-m3",
        "OCV_EMBED_KEY": "..."
      }
    }
  }
}
```

## Import from Obsidian

Bring an existing Obsidian vault in. Wikilinks, aliases, frontmatter, and tags convert to OC5/OKF concepts, with profile types inferred from your folder layout.

```bash
node src/cli.js import /path/to/obsidian-vault ./vault
```

- `[[Note]]` and `[[Note|alias]]` become markdown links to resolved concept ids (name-based, cross-folder, like Obsidian).
- `[[Note#heading]]` links to the note; the heading is dropped.
- Folder names map to profile types: `People/` to `Entity`, `Concepts/` to `Concept`, `Sources/` to `Source`, `Runbooks/` to `Runbook`, and so on. Override per-note with a `type` in frontmatter.
- Frontmatter `tags` and inline `#tags` merge into the tags field. `aliases` carry over under `ocv.aliases`.
- Unresolved wikilinks are kept as plain text and reported, not silently dropped.

## Auth

The REST API is open by default for local use. Set a token to require bearer auth on every route except `/health`:

```bash
export OCV_TOKEN=your-long-random-token
node src/rest/server.js ./vault 8787
curl -H "authorization: Bearer your-long-random-token" localhost:8787/concepts
```

Comparison is constant-time. No token set means no auth, which is the right default for a vault running on your own machine.

## The OC5 Profile

OKF leaves the content model open on purpose. The [OC5 Profile](./PROFILE.md) fills it for the knowledge-vault use case: a small type vocabulary (`Note`, `Concept`, `Entity`, `Source`, `Runbook`, `Decision`, ...), an `ocv` frontmatter namespace for aliases/status/provenance, and a conformance checklist. A profile-conformant vault is still plain OKF; the profile is additive, and it's the part a community can standardize around.

## Test against your own vault

Dry-run an import without writing anything to your source vault:

```bash
node src/cli.js check "/path/to/your/obsidian-vault"
```

It reports how many notes would import, the type breakdown, and any unresolved wikilinks, then cleans up. When it looks right, run the real `import`.

## Live updates

Edit vault files in any editor and OC5 reflects them. The REST server exposes a Server-Sent Events stream:

```bash
curl -N localhost:8787/events    # event: change per debounced on-disk edit
```

Or watch from the CLI: `node src/cli.js watch ./vault`. Recursive watch is used on macOS and Windows, with a portable poller fallback on Linux.

## Verify on your OS

OC5 is pure Node with no native dependencies, so it runs on macOS, Windows, and Linux. Confirm on yours:

```bash
node test/selftest.js
```

13 checks covering core, importer, search, and the watcher. Exit 0 means all green. Run this on Windows before trusting it there.

## Loading context first (the primer)

Every vault ships with an `AGENTS.md` whose first instruction tells the agent to call `vault_primer` at session start. That one MCP call returns the whole "brain" in a bounded payload:

- **immediate context** — the root `index.md` body and its map
- **recent history** — the tail of `log.md`, newest first
- **a concept map** — every concept as `{id, type, title}`, no bodies

The agent reads bodies on demand with `vault_get` after it knows what exists. This is deliberate: orientation loads eagerly and cheaply in one round-trip, detail loads lazily only when the task needs it. Pinning the load step in the server (not in prompt instructions) means every session gets the same complete context regardless of model or sampling, and you evolve what counts as "the brain" in one place.

REST equivalent: `GET /primer`.

## Sync across devices

OC5 vaults sync peer-to-peer, joined the way a Kubernetes node joins a cluster: address plus token. A vault is plain files, so there are two transports.

### Native peer sync

One install runs as a reachable join target (its REST server, ideally with `OCV_TOKEN` set). Another install joins it:

```bash
# on the target device
OCV_TOKEN=your-token node src/rest/server.js ./vault 8787

# on the joining device (any network, any provider)
node src/cli.js join ./vault http://target-host:8787 your-token
```

`join` reconciles once and remembers the peer. After that, `oc5 sync ./vault` reconciles against every saved peer.

How reconciliation works: each concept is content-hashed, the two vaults diff manifests, and only differing concepts transfer. When both sides changed the same concept, the newer timestamp wins and the losing version is written next to it as `<id>.<side>.bak.md`, so nothing is ever silently lost. Sync is idempotent: run it twice and the second run is a clean no-op.

### Real-time sync

Once peers are joined, run the live agent and edits propagate the moment they hit disk, no manual `sync`:

```bash
node src/cli.js live-sync ./vault
```

The agent holds a persistent SSE connection to each peer's `/events` stream and reconciles on every change, debounced, with auto-reconnect if a peer drops. Edit a file in any editor on one device and it lands on the others within a second. Your own local edits push out the same way via the file watcher.

This is real-time pull/push reconciliation, still last-write-wins per concept. Going live shrinks the window for conflicts but does not merge truly simultaneous edits to the same concept; that remains a future CRDT upgrade.

### Git fallback

Because the vault is just markdown, Git syncs it too. Good for anyone who wants history and a familiar remote:

```bash
node src/cli.js git-sync ./vault git@github.com:you/your-vault.git
```

It pulls, commits, and pushes. Conflicts surface as ordinary Git conflicts.

## License

Apache-2.0. Chosen deliberately. Permissive licensing is what makes this embeddable and, if the community wants it, foundation-donatable, unlike AGPL alternatives.

## Status

v0.1, working but minimal. Hybrid search needs a real embedding endpoint to shine. No auth on the REST layer yet. The format and profile are the stable parts; everything around them is meant to be replaced and extended.
