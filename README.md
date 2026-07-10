<p align="center">
  <img src="assets/brand/oc5-logo.svg" alt="OC5 — Open Context Vault logo" width="200">
</p>

# Open Context Vault (OC5)

The idea has been in the air for a while. Andrej Karpathy sketched it: a wiki for your agents, knowledge written in plain markdown, the way you'd write it for a person. Google gave the pattern a shape and called it the Open Knowledge Format. OC5 is the open form, the part you can hold. Your knowledge, as files you own. Synced across your own machines, as many as you like, with no service in the middle and no fee at the door. Brought in from the tools you already write in, and handed to any agent that speaks MCP.

This is what works today. Markdown you control, a format the field already agreed on, and an open implementation with nothing between you and your own context.

Apache-2.0. No database, no cloud, no account.

> OC5 is a proof of concept for [Open Knowledge Format (OKF)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/), the open file format for agent-readable knowledge introduced by Google Cloud. See the [OKF spec](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) for the format this vault implements.

---

## What works today

**Data sovereignty.** Your knowledge is plain markdown files on your own disk. No database, no cloud, no account. The format is a published spec ([OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)), so nothing about your data is captive to this tool or any tool. You can read it with `cat`, edit it in any editor, and walk away with it whenever you like.

**Sync your own nodes.** Add machines to your vault the way you'd add nodes to a cluster, peer-to-peer or over Git. Self-hosted, free, no service in the middle. Nodes reconcile automatically, with live updates as files change.

**Bring your Obsidian vault.** One command, a safe dry-run that never touches your originals, and your existing markdown becomes an OKF vault agents can read.

Plus: agents read and write the vault over **MCP** (works with Goose, BrowserOS, Claude Desktop, any MCP client); a `vault_primer` call that loads your whole context at session start; **hybrid search** (keyword built in, semantic via any OpenAI-compatible embedder such as BGE-M3); live file-watching; and a 21-check self-test that runs on macOS, Windows, and Linux.

## Install

```bash
git clone https://github.com/catinahat85/OpenContextVault.git
cd OpenContextVault
npm install
node test/selftest.js          # expect: 21 passed, 0 failed
node src/cli.js seed ./vault    # a demo vault to look at
```

Requires Node.js 20+. No native dependencies.

## Quickstart

```bash
# see your vault as a graph (no server needed)
node src/cli.js viz ./vault && open vault/viz.html

# bring in an existing Obsidian vault — dry-run first, it touches nothing
node src/cli.js check "/path/to/your/obsidian-vault"
node src/cli.js import "/path/to/your/obsidian-vault" ./myvault

# run the MCP server (point any MCP client at this)
node src/mcp/server.js ./myvault
```

### Wire into an MCP client

Goose, BrowserOS, Claude Desktop, and any MCP client take the same shape. Use an absolute path to `node` and to the vault:

```json
{
  "mcpServers": {
    "open-context-vault": {
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/absolute/path/to/OpenContextVault/src/mcp/server.js",
        "/absolute/path/to/myvault"
      ]
    }
  }
}
```

For semantic search, add an `env` block with `OCV_EMBED_URL`, `OCV_EMBED_MODEL`, and `OCV_EMBED_KEY` pointing at any OpenAI-compatible embeddings endpoint.

### MCP tools

`vault_primer` (load first), `vault_list`, `vault_get`, `vault_put`, `vault_delete`, `vault_search`, `vault_graph`, `vault_backlinks`.

### Sync across machines

```bash
# on the node you're joining
OCV_TOKEN=your-token node src/rest/server.js ./myvault 8787

# on another machine
node src/cli.js join ./myvault http://host:8787 your-token   # one-time
node src/cli.js live-sync ./myvault                          # real-time
```

Or use the Git fallback: `node src/cli.js git-sync ./myvault <remote-url>`.

---

## A reference implementation of OKF

OC5 aims to be a faithful, open implementation of the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf). A vault is a folder of markdown concepts; each file's path is its identity; frontmatter carries a required `type`; markdown links form the graph; `index.md` and `log.md` are reserved. Vaults OC5 produces pass the OKF conformance test.

The format is the contract. Everything else — the REST API, the MCP server, the search, the sync — is an implementation detail layered on top, and is meant to be replaceable. See [PROFILE.md](./PROFILE.md) for the OC5 content profile that fills the model OKF deliberately leaves open, and [ARCHITECTURE.md](./ARCHITECTURE.md) for the design.

## Built for where teams are going

OC5 today is single-user scale. It is also the foundation for something larger: a multi-tenant, role-scoped, securely-federated knowledge layer for teams that need data ownership without lock-in. That direction — sector permissions, enterprise identity, federated department vaults — is laid out in [ROADMAP.md](./ROADMAP.md).

If your team needs data-sovereign agent knowledge at scale, owned and free of lock-in, that roadmap is the conversation worth starting early. Open an issue or reach out.

## Contributing

OC5 is early and open to contribution. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the one hard rule (the self-test stays green), and where help is most useful right now.

## License

Apache-2.0. Chosen deliberately: permissive, patent-protective, and the license the surrounding agentic ecosystem (MCP, A2A, AGENTS.md) already uses. Your team can build on OC5 and scale without a license that boxes you in.
