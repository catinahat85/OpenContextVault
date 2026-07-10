# Open Context Vault Profile (OC5 Profile) v0.1

A content model for personal and team knowledge vaults, layered on the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf).

## Why a profile

OKF standardizes the *envelope*: a bundle is markdown files with YAML frontmatter, every concept carries a `type`, links form a graph. It deliberately stops there. It defines the interoperability surface, not the content model, so what `type` values exist and what fields they carry is left to the producer.

That openness is correct for a format and insufficient for a tool. If every vault invents its own types and fields, agents can read the markdown but can't reason about it consistently across vaults. A **profile** closes that gap for one use case without touching OKF itself. The OC5 Profile says: here is a small, agreed vocabulary for knowledge vaults, so that any OC5-aware agent can walk any OC5 vault and know what it's looking at.

A vault that follows this profile is still a fully valid OKF bundle. A consumer that only understands base OKF can still read it. The profile is additive.

## Conformance

An OC5 bundle MUST be a conformant OKF bundle, AND:

1. Every concept's `type` SHOULD be drawn from the **core type vocabulary** below, or be a producer-defined type documented in the bundle's `index.md`.
2. The bundle root MUST contain an `index.md` whose frontmatter `type` is `Index`.
3. Concept ids SHOULD be lowercase, hyphen-separated, and stable (renaming breaks backlinks, so prefer aliasing over renaming).
4. Cross-references between concepts MUST use relative markdown links to the target's id path. External references use absolute URLs in the `resource` field or inline.

"MUST" / "SHOULD" carry their usual RFC 2119 sense.

## Core type vocabulary

A small starter set. Producers may extend it; extensions are declared in `index.md`.

| `type`       | What it captures                                  |
|--------------|---------------------------------------------------|
| `Index`      | An entry/landing concept for a bundle or subtree  |
| `Note`       | A free-form idea, observation, or working note     |
| `Concept`    | A defined idea, term, or entity                    |
| `Entity`     | A person, org, project, or system                  |
| `Source`     | An external reference: article, paper, doc, link   |
| `Runbook`    | A procedure or how-to an agent can follow          |
| `Decision`   | A choice made, with context and rationale          |
| `Log`        | A dated record of events (see reserved `log.md`)   |

## Reserved frontmatter

OKF reserves: `type, title, description, resource, tags, timestamp`. The OC5 Profile adds the following OPTIONAL fields. All are namespaced under `ocv` to avoid colliding with future OKF fields.

```yaml
---
type: Concept
title: Open Knowledge Format
description: Vendor-neutral markdown format for agent knowledge.
tags: [standard, knowledge]
timestamp: 2026-06-28T03:00:00Z
ocv:
  aliases: [okf, open-knowledge-format]   # alternate ids that resolve here
  status: stable                          # draft | stable | deprecated
  source: https://github.com/...          # provenance, if derived
  related: [concepts/agents-md]           # soft links beyond inline markdown
---
```

- **`ocv.aliases`** — alternate ids that resolve to this concept. Lets you rename safely: keep the old id as an alias.
- **`ocv.status`** — lifecycle signal so agents can prefer `stable` over `draft` knowledge.
- **`ocv.source`** — provenance for derived or imported concepts.
- **`ocv.related`** — relationships that aren't natural inline links.

A consumer that ignores the `ocv` block still has a valid OKF concept. Nothing here is required to read the knowledge; it's there to let agents reason about it better.

## Bundle layout

```
vault/
├── index.md              # type: Index — the bundle entry point
├── log.md                # reserved: chronological change history
├── notes/                # type: Note
├── concepts/             # type: Concept
├── entities/             # type: Entity
├── sources/              # type: Source
└── runbooks/             # type: Runbook
```

Folders are a convention, not a requirement. The `type` field is authoritative; an agent groups by `type`, not by directory.

## What stays out of scope

The profile defines vocabulary and structure, not tooling. Search, embeddings, sync, auth, and rendering are implementation choices. Open Context Vault is one implementation; the profile is meant to outlive it and admit others.

## Versioning

This profile versions independently of OKF and of any implementation. Backward-compatible additions bump the minor version. The `ocv` namespace insulates the profile from OKF's own evolution.
