# Architecture

OC5's design rests on one decision, from which everything else follows: **the file format is the contract, and everything else is a replaceable implementation detail.**

## The format is the contract

A vault is a directory of plain markdown files with YAML frontmatter, conformant to the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf). Each file is a concept; its path is its identity; frontmatter carries a required `type`; markdown links between files form a directed graph; `index.md` and `log.md` are reserved.

Because the durable artifact is just files on disk in a published format, the data outlives any particular tool. You can read a vault with `cat`, edit it in any editor, sync it with Git, or hand it to a different OKF implementation entirely. OC5 is one way to work with an OKF vault, not a container your data lives inside.

This is the core anti-lock-in property, and it is architectural, not a promise.

## One core, two surfaces

```
          ┌───────────────┐        ┌──────────────┐
          │  REST server  │        │  MCP server  │
          └───────┬───────┘        └──────┬───────┘
                  │                        │
                  └───────────┬────────────┘
                              ▼
                     ┌─────────────────┐
                     │   Vault core    │  read / write / link /
                     │  (vault.js)     │  graph / search / primer
                     └────────┬────────┘
                              ▼
                     markdown + YAML on disk
                        (the OKF bundle)
```

The **vault core** is the single source of truth. It implements every operation — reading and writing concepts, resolving the link graph, keyword and hybrid search, backlinks, and the session-start primer — directly against the files.

The **REST server** and the **MCP server** are thin surfaces over that core. They add no logic of their own; they translate HTTP requests and MCP tool calls into core method calls. Because both go through one core, the two surfaces can never drift apart, and adding a third surface later is cheap.

Supporting modules follow the same pattern: the **embedder** (pluggable, any OpenAI-compatible endpoint), the **file watcher** (recursive on macOS/Windows, polling fallback on Linux), the **sync** and **live-sync** engines, and the **Obsidian importer** all sit beside the core and call into it.

## The primer: load context first

An agent's first move in a session should be one call — `vault_primer` — that returns a bounded orientation payload: the root index (immediate context), a capped tail of the log (recent history), and a lightweight map of every concept (id, type, title, no bodies). The agent reads bodies on demand afterward with `vault_get`.

This is deliberate. Orientation loads eagerly and cheaply in one round-trip; detail loads lazily only when a task needs it. Keeping "what counts as context" in the server rather than in prompt instructions means every session gets the same complete orientation regardless of model or sampling, and the definition can evolve in one place. It is determinism over agent discretion, at the step where that matters most.

## Sync

Sync is peer-to-peer reconciliation with a join handshake, modelled loosely on how a node joins a cluster: address plus token. Each concept is content-hashed; two vaults diff manifests and transfer only what differs. Conflicts resolve by last-write-wins with the losing version preserved as a backup, and reconciliation is idempotent. A live-sync agent holds an SSE connection to each peer and reconciles on every change, for real-time propagation. A Git-based fallback exists because the vault is plain files.

This is honest about its limits: it is real-time last-write-wins, not multi-master consensus. It shrinks the window for conflicts without merging truly simultaneous edits. Real merge semantics (CRDTs) are roadmap, not present.

## Why the enterprise version is a separate implementation

The multi-tenant, role-scoped, federated platform on the [roadmap](./ROADMAP.md) is intentionally **not** a refactor of this codebase. It is a separate, heavier implementation that speaks the same OKF format.

The reason is that the properties that make OC5 elegant at personal scale — files on a filesystem, one writer, a shared token, last-write-wins — are exactly the properties that break at enterprise scale, where you need per-user identity, role-based access to slices of the graph, concurrency control, real merge, and audit trails. Bolting those onto the file-first personal core would compromise both.

Keeping them separate but format-compatible means the two implementations interoperate through the vault format, the personal tool stays light, and the enterprise engineering is quarantined where it belongs. This mirrors the pattern the surrounding ecosystem already follows: a lightweight open format wins adoption, and heavier serving layers get built on top of it.

## Design principles, in short

- The OKF format is the contract; implementations are replaceable.
- One core; surfaces are thin translators over it.
- Orient eagerly and cheaply; load detail lazily.
- Be honest about limits in code and docs — sync is last-write-wins, and it says so.
- Personal scale and enterprise scale are different implementations sharing a format, not one codebase stretched across both.
