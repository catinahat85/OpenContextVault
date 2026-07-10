#!/usr/bin/env node
// Open Context Vault (OC5) — cross-platform self-test.
// Runs the same checks on macOS, Windows, and Linux. No network, no servers.
// Exit 0 = all green. Run with: node test/selftest.js
//
// This is what to run on a Windows box before trusting OC5 there.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Vault } from "../src/core/vault.js";
import { importObsidian } from "../src/core/import-obsidian.js";
import { VaultWatcher } from "../src/core/watch.js";

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
};

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oc5-test-"));
const vaultDir = path.join(tmp, "vault");
const obsDir = path.join(tmp, "obsidian");

console.log(`OC5 self-test on ${os.platform()} ${os.arch()}, node ${process.version}`);
console.log(`scratch: ${tmp}\n`);

try {
  // --- core: put / get / type enforcement ---
  const v = await new Vault(vaultDir).init();
  await v.put("concepts/alpha", { type: "Concept", title: "Alpha", body: "Links to [Beta](concepts/beta)." });
  await v.put("concepts/beta", { type: "Concept", title: "Beta", body: "Plain note." });
  const a = await v.get("concepts/alpha");
  ok("put/get roundtrip", a && a.type === "Concept" && a.frontmatter.title === "Alpha");
  ok("path identity normalized", a.id === "concepts/alpha");

  let threw = false;
  try { await v.put("bad", { body: "no type" }); } catch { threw = true; }
  ok("type field enforced", threw);

  // --- graph + backlinks ---
  const g = await v.graph();
  ok("graph has nodes", g.nodes.length === 2);
  const bl = await v.backlinks("concepts/beta");
  ok("backlinks resolve", bl.length === 1 && bl[0].from === "concepts/alpha");

  // --- search (keyword path, no embedder needed) ---
  const hits = await v.search("beta");
  ok("search finds concept", hits.some((h) => h.id === "concepts/beta"));

  // --- importer with spaces + wikilinks + folders ---
  await fs.mkdir(path.join(obsDir, "People"), { recursive: true });
  await fs.writeFile(path.join(obsDir, "Index.md"), "Home. See [[My Note]] and [[Jane Doe]].\n");
  await fs.writeFile(path.join(obsDir, "My Note.md"), "Body with #tag and a [[broken link]].\n");
  await fs.writeFile(path.join(obsDir, "People", "Jane Doe.md"), "---\ntitle: Jane\n---\nA person.\n");
  const rep = await importObsidian(obsDir, path.join(tmp, "imported"));
  ok("import count", rep.imported === 3);
  ok("import resolved a link", rep.links >= 2);
  const iv = new Vault(path.join(tmp, "imported"));
  const jane = await iv.get("people/jane-doe");
  ok("folder->type inference (Entity)", jane && jane.type === "Entity");
  const note = await iv.get("my-note");
  const idx = await iv.get("index");
  ok("wikilink rewritten to md link", idx && /\[My Note\]\(my-note\)/.test(idx.body));
  ok("unresolved wikilink kept as text", note && /broken link/.test(note.body) && !/\[\[/.test(note.body));
  ok("tag captured from body", note && (note.frontmatter.tags ?? []).includes("tag"));

  // --- watcher fires on a write (covers both recursive + poll paths) ---
  const watcher = new VaultWatcher(vaultDir, { debounceMs: 100 }).start();
  const fired = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 4000);
    watcher.on("change", () => { clearTimeout(t); resolve(true); });
    // poller primes its snapshot, so wait a tick before mutating
    setTimeout(() => v.put("concepts/gamma", { type: "Note", body: "new" }), 1200);
  });
  watcher.stop();
  ok("watcher emits on change", fired);
  // --- primer: bounded orientation payload ---
  await v.log("test event");
  const primer = await v.primer({ logLines: 5 });
  ok("primer returns concept map", Array.isArray(primer.map) && primer.map.length >= 2);
  ok("primer map carries no bodies", !primer.map.some((m) => "body" in m));
  ok("primer surfaces recent history", primer.recent.length >= 1);

  // --- sync: two vaults reconcile (content-hash + conflict + idempotency) ---
  const { manifest, applyConcept, hashConcept, exportConcept } = await import("../src/core/sync.js");
  const sa = await new Vault(path.join(tmp, "sa")).init();
  const sb = await new Vault(path.join(tmp, "sb")).init();
  await sa.put("x/only-a", { type: "Note", body: "A" });
  await sa.put("x/shared", { type: "Note", body: "old", timestamp: "2026-01-01T00:00:00Z" });
  await sb.put("x/only-b", { type: "Note", body: "B" });
  await sb.put("x/shared", { type: "Note", body: "new", timestamp: "2026-02-01T00:00:00Z" });

  // simulate reconcile sb -> sa by hand (no server needed for the unit test)
  const manA = await manifest(sa);
  for (const id of await sb.list()) {
    const inc = await exportConcept(sb, id);
    await applyConcept(sa, inc, manA);
  }
  const aShared = await sa.get("x/shared");
  ok("sync: newer version wins conflict", aShared.body === "new");
  ok("sync: both uniques present", (await sa.get("x/only-a")) && (await sa.get("x/only-b")));
  const baks = (await sa.list()).filter((id) => /\.bak$/.test(id));
  ok("sync: backups excluded from concept list", baks.length === 0);
  // idempotency: re-apply, nothing should change
  const manA2 = await manifest(sa);
  const before = JSON.stringify(manA2);
  for (const id of await sb.list()) {
    const inc = await exportConcept(sb, id);
    await applyConcept(sa, inc, manA2);
  }
  ok("sync: idempotent re-apply", JSON.stringify(await manifest(sa)) === before);

  // --- live sync: edit on one side propagates over SSE without manual sync ---
  const { createApp } = await import("../src/rest/server.js");
  const { LiveSync } = await import("../src/core/live-sync.js");
  const { savePeer } = await import("../src/core/peers.js");
  const lvA = path.join(tmp, "lvA"), lvB = path.join(tmp, "lvB");
  await (await new Vault(lvA).init()).put("seed/a", { type: "Note", body: "A" });
  await new Vault(lvB).init();
  const app = createApp(lvA, { token: "t" });
  const server = app.listen(8899);
  await new Promise((r) => setTimeout(r, 300));
  let livePass = false;
  try {
    await savePeer(lvB, { url: "http://localhost:8899", token: "t" });
    const agent = new LiveSync(lvB, { debounceMs: 150 });
    await agent.start();
    await new Promise((r) => setTimeout(r, 400));
    // write a new concept on A; expect it to appear on B via SSE
    await new Vault(lvA).put("live/x", { type: "Note", body: "live" });
    for (let i = 0; i < 40 && !livePass; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const got = await new Vault(lvB).get("live/x");
      if (got && got.body === "live") livePass = true;
    }
    agent.stop();
  } finally {
    server.close();
    app.locals.watcher?.stop();
  }
  ok("live sync: edit propagates over SSE", livePass);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
