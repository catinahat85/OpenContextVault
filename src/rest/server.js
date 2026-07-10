// okvault REST API — thin HTTP surface over the vault core.
// Every route calls the same Vault methods the MCP server uses.
//
//   GET    /concepts                list ids
//   GET    /concepts/*              get one concept (id is the wildcard path)
//   PUT    /concepts/*              create/replace { type, body, ...fields }
//   DELETE /concepts/*              delete
//   GET    /search?q=...            search
//   GET    /graph                   nodes + edges
//   GET    /backlinks/*             who links here
//   POST   /log  { message }        append history line

import express from "express";
import { timingSafeEqual as tse } from "node:crypto";
import { Vault } from "../core/vault.js";
import { embedderFromEnv } from "../core/embedder.js";
import { VaultWatcher } from "../core/watch.js";
import { manifest, exportConcept, applyConcept } from "../core/sync.js";

// constant-time string compare that won't throw on length mismatch
function timingSafeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return tse(ab, bb);
}

export function createApp(vaultRoot, { token = process.env.OCV_TOKEN ?? null } = {}) {
  const vault = new Vault(vaultRoot, { embedder: embedderFromEnv() });
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // optional bearer-token auth. No token configured -> open (local dev default).
  // Token configured -> every route except /health requires Authorization: Bearer <token>.
  if (token) {
    app.use((req, res, next) => {
      if (req.path === "/health") return next();
      const header = req.get("authorization") ?? "";
      const presented = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (presented && timingSafeEqual(presented, token)) return next();
      res.set("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "unauthorized" });
    });
  }

  app.get("/health", (_req, res) => res.json({ ok: true, auth: Boolean(token) }));

  const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => res.status(400).json({ error: err.message }));

  app.get("/primer", wrap(async (req, res) => {
    const logLines = req.query.logLines ? Number(req.query.logLines) : undefined;
    res.json(await vault.primer({ logLines }));
  }));

  app.get("/concepts", wrap(async (_req, res) => {
    res.json({ concepts: await vault.list() });
  }));

  app.get("/concepts/*", wrap(async (req, res) => {
    const c = await vault.get(req.params[0]);
    if (!c) return res.status(404).json({ error: "not found" });
    res.json(c);
  }));

  app.put("/concepts/*", wrap(async (req, res) => {
    const { type, body, ...fields } = req.body ?? {};
    const c = await vault.put(req.params[0], { type, body, ...fields });
    res.json(c);
  }));

  app.delete("/concepts/*", wrap(async (req, res) => {
    res.json({ deleted: await vault.delete(req.params[0]) });
  }));

  app.get("/search", wrap(async (req, res) => {
    const q = String(req.query.q ?? "");
    if (!q) return res.status(400).json({ error: "q required" });
    res.json({ hits: await vault.search(q) });
  }));

  app.get("/graph", wrap(async (_req, res) => {
    res.json(await vault.graph());
  }));

  app.get("/backlinks/*", wrap(async (req, res) => {
    res.json({ backlinks: await vault.backlinks(req.params[0]) });
  }));

  app.post("/log", wrap(async (req, res) => {
    await vault.log(String(req.body?.message ?? ""));
    res.json({ ok: true });
  }));

  // --- sync API: lets a peer join this vault and reconcile ---
  app.get("/sync/manifest", wrap(async (_req, res) => {
    res.json(await manifest(vault));
  }));

  app.get("/sync/concept", wrap(async (req, res) => {
    const c = await exportConcept(vault, String(req.query.id ?? ""));
    if (!c) return res.status(404).json({ error: "not found" });
    res.json(c);
  }));

  app.post("/sync/push", wrap(async (req, res) => {
    const local = await manifest(vault);
    const result = await applyConcept(vault, req.body, local);
    res.json(result);
  }));

  // live change stream over Server-Sent Events, backed by the file watcher.
  // GET /events  -> text/event-stream, one message per debounced on-disk change.
  const watcher = new VaultWatcher(vaultRoot).start();
  app.get("/events", (req, res) => {
    res.set({
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.flushHeaders?.();
    res.write(`event: ready\ndata: {}\n\n`);
    const onChange = (payload) => res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
    watcher.on("change", onChange);
    req.on("close", () => watcher.off("change", onChange));
  });
  app.locals.watcher = watcher;

  return app;
}

// run directly: node src/rest/server.js [vaultPath] [port]
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? "./vault";
  const port = Number(process.argv[3] ?? 8787);
  createApp(root).listen(port, () =>
    console.log(`Open Context Vault REST on http://localhost:${port} (vault: ${root})`)
  );
}
