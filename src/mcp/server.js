// okvault MCP server — exposes the vault core as agent tools over stdio.
// Same functions as the REST API, shaped as MCP tools so any MCP client
// (Claude, an agent runtime, etc.) can read and write the knowledge vault.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Vault } from "../core/vault.js";
import { embedderFromEnv } from "../core/embedder.js";

const root = process.env.OKVAULT_PATH ?? process.env.OCV_PATH ?? process.argv[2] ?? "./vault";
const vault = new Vault(root, { embedder: embedderFromEnv() });
await vault.init();

const server = new McpServer({ name: "open-context-vault", version: "0.1.0" });

const text = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

server.tool(
  "vault_primer",
  "Load this first. Returns the vault's immediate context (root index), recent history (log tail), and a lightweight map of all concepts (id, type, title). Call once at session start to orient before reading individual concepts.",
  { logLines: z.number().optional() },
  async ({ logLines }) => text(await vault.primer({ logLines }))
);

server.tool(
  "vault_list",
  "List all concept ids in the OKF vault.",
  {},
  async () => text({ concepts: await vault.list() })
);

server.tool(
  "vault_get",
  "Read one concept by id (its path without .md). Returns type, frontmatter, body, and outgoing links.",
  { id: z.string() },
  async ({ id }) => {
    const c = await vault.get(id);
    return c ? text(c) : text({ error: "not found", id });
  }
);

server.tool(
  "vault_put",
  "Create or replace a concept. `type` is required by OKF. Pass body as markdown; cross-link other concepts with [text](path) links to build the graph.",
  {
    id: z.string(),
    type: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    resource: z.string().optional(),
    body: z.string().optional(),
  },
  async ({ id, ...fields }) => text(await vault.put(id, fields))
);

server.tool(
  "vault_delete",
  "Delete a concept by id.",
  { id: z.string() },
  async ({ id }) => text({ deleted: await vault.delete(id) })
);

server.tool(
  "vault_search",
  "Search concepts by substring across id, title, description, type, tags, and body.",
  { query: z.string(), limit: z.number().optional() },
  async ({ query, limit }) => text({ hits: await vault.search(query, { limit }) })
);

server.tool(
  "vault_graph",
  "Return the full knowledge graph: nodes (concepts) and edges (resolved internal links).",
  {},
  async () => text(await vault.graph())
);

server.tool(
  "vault_backlinks",
  "List concepts that link to the given concept id.",
  { id: z.string() },
  async ({ id }) => text({ backlinks: await vault.backlinks(id) })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Open Context Vault MCP server running over stdio (vault: ${root})`);
