# Contributing

OC5 is early and open to contribution. This guide covers how to get set up, what the bar for a change is, and where help is most useful right now.

## Setup

```bash
git clone https://github.com/catinahat85/OpenContextVault.git
cd OpenContextVault
npm install
node test/selftest.js     # must print: 21 passed, 0 failed
```

Requires Node.js 20+. No native dependencies, so setup is the same on macOS, Windows, and Linux.

## The one hard rule: the self-test stays green

`test/selftest.js` is the contract. It runs the full stack — core, search, import, watcher, sync, live sync, and the primer — with no network and no external services, on any OS. Every change must keep it at 21/21 (or add checks and raise the number). If you fix a bug, add a check that would have caught it.

```bash
node test/selftest.js
```

A change that breaks the self-test does not merge.

## Where the code lives

- `src/core/vault.js` — the engine. Everything else calls this. Changes here are the highest-stakes.
- `src/core/` — supporting modules: embedder, watcher, sync, live-sync, importer, peers.
- `src/rest/server.js`, `src/mcp/server.js` — thin surfaces over the core. Keep them thin; logic belongs in the core.
- `src/cli.js` — command-line entry.
- `test/selftest.js` — the cross-platform test suite.
- `PROFILE.md`, `ARCHITECTURE.md`, `ROADMAP.md` — the content profile, the design, and the plan.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before making structural changes. The core-plus-thin-surfaces shape is deliberate, and PRs that put logic in a surface instead of the core will be asked to move it.

## Guidelines

- **Match the format.** OC5 is an OKF implementation. Changes to how concepts are read or written should keep vaults OKF-conformant. If a change affects conformance, say so in the PR.
- **Be honest in code and docs.** OC5's credibility rests on not overclaiming. Sync is last-write-wins and the docs say so; keep that standard. Don't describe something as done that isn't.
- **Small, focused PRs.** One concern per pull request. Easier to review, easier to revert.
- **No new runtime dependencies without discussion.** Part of OC5's portability is a tiny dependency surface. Adding one is a real decision — open an issue first.

## Where help is most useful

The [roadmap](./ROADMAP.md) is the priority list. Near-term items are the best entry points because they extend working code rather than building new subsystems:

- The live one-way Obsidian mirror (watcher + importer already exist).
- OKF spec-alignment fixes (link form, index handling, `okf_version`).
- Cross-platform CI (GitHub Actions running the self-test on all three OSes).
- Real two-machine sync testing across a network, and reporting what breaks.

Larger roadmap items — secure transport, the tenancy foundation, identity — are worth an issue and a design discussion before code.

## Reporting issues

Open a GitHub issue. For bugs, include your OS, Node version, and the output of `node test/selftest.js`. For a sync or import problem, a minimal vault or note that reproduces it is worth more than a description.
