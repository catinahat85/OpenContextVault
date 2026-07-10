# Roadmap

A 12-month plan, organized by quarter. The ordering is the commitment. Near-term work is a small extension of what already runs today; the enterprise tier is a separate implementation that shares the OKF format, and it is framed as *underway*, not finished, because doing multi-tenant identity and federation well takes longer than a year and is worth doing right.

Today OC5 is a working, Apache-2.0 reference implementation of the Open Knowledge Format: a plain-markdown knowledge vault you own, read and written by agents over MCP, synced across your own machines peer-to-peer or over Git. Everything below builds from there.

## Q1 — Foundations and adopter polish

Make the tool genuinely adoptable and prove the multi-node claim on real hardware.

- **Live one-way Obsidian mirror.** Watch an Obsidian vault and mirror changes into the OC5 vault automatically. Writes stay on the OC5 side, so your Obsidian originals are never touched. Closes the "edit in Obsidian, see it in OC5" gap.
- **OKF spec alignment.** Adopt the spec's recommended conventions: absolute `/path.md` link form, frontmatter-less index files, and an `okf_version` declaration. Takes OC5 from passing the conformance test to following the spec's recommendations, for clean interop with other OKF tooling.
- **One-command install.** `npx`-style entry so adopters run OC5 without cloning.
- **Cross-platform CI.** GitHub Actions running the full self-test suite on macOS, Windows, and Linux per commit, so the cross-platform guarantee is continuously proven.
- **Verified multi-machine sync.** Run a node on a real remote host and join it from a laptop across the open internet. Turns "written to work across machines" into "proven across machines."

## Q2 — Hardening sync

Turn "sync across your machines" into "sync *securely* across your machines," and make search scale.

- **Secure transport.** TLS and a real token/key model to replace the single shared bearer token. The first honest step toward secure nodes.
- **Persisted vector index.** A stored embedding index so semantic search doesn't re-embed the vault on every query. The fix for scaling past thousands of notes.
- **Conflict handling improvements.** Move beyond last-write-wins toward real merge semantics. Groundwork for the CRDT work that continues later.

## Q3 — The tenancy foundation

Begin the separate enterprise implementation, built against the same OKF format. Not the full platform — the core access-control primitive everything else depends on.

- **Sector permissions.** Labeled subtrees of a vault with least-privilege, role-based read/write policy, enforced in the server, not encoded in the files.
- **Permission-aware primer.** The session-start context load returns only the sectors a principal's role grants. Least privilege enforced at the load step, which is both a security property and a performance one.

## Q4 — Identity and federation groundwork

Stand up the pieces that make OC5 a real multi-tenant platform. Underway and partially working by year end, with the heaviest items explicitly continuing into year two.

- **Enterprise identity.** OIDC / SSO integration — the layer that gates everything above it.
- **Federated vaults.** The sub-vault-into-master model: department vaults that start from their own index and pull in shared knowledge read-only, with curated promotion upward.
- **Audit logging.** Who-changed-what records for compliance. *Continues into year two.*
- **CRDT conflict resolution.** True merge of simultaneous edits across nodes. *Continues into year two.*

---

The enterprise capabilities in Q3–Q4 are where OC5 becomes a supported, pilotable offering. If your team needs data-sovereign agent knowledge at scale — owned, role-scoped, and free of lock-in — this is the conversation worth starting early, while the foundation is being laid rather than after.
