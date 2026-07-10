#!/usr/bin/env node
// okvault CLI — seed a demo bundle and render a self-contained graph viewer.
//
//   okvault seed [vaultPath]      write a small example OKF bundle
//   okvault viz  [vaultPath]      write viz.html (no backend, opens anywhere)

import { promises as fs } from "node:fs";
import path from "node:path";
import { Vault } from "./core/vault.js";
import { importObsidian } from "./core/import-obsidian.js";

const cmd = process.argv[2];
const root = process.argv[3] ?? "./vault";

async function seed() {
  const v = await new Vault(root).init();
  // drop the AGENTS.md primer directive at the vault root
  try {
    const tpl = await fs.readFile(new URL("../templates/AGENTS.md", import.meta.url), "utf8");
    await fs.writeFile(path.join(root, "AGENTS.md"), tpl, "utf8");
  } catch { /* template missing, skip */ }
  await v.put("index", {
    type: "Index",
    title: "Vault Home",
    description: "Entry point for this knowledge bundle.",
    body: "Start here. See [MCP](concepts/mcp) and [OKF](concepts/okf).",
  });
  await v.put("concepts/okf", {
    type: "Concept",
    title: "Open Knowledge Format",
    tags: ["standard", "knowledge"],
    body: "A vendor-neutral markdown+YAML format for agent-readable knowledge. Sibling of [AGENTS.md](concepts/agents-md). Consumed here via [MCP](concepts/mcp).",
  });
  await v.put("concepts/mcp", {
    type: "Concept",
    title: "Model Context Protocol",
    tags: ["protocol", "tools"],
    body: "The tool-and-data layer agents use to reach a vault. This bundle is served over an MCP server.",
  });
  await v.put("concepts/agents-md", {
    type: "Concept",
    title: "AGENTS.md",
    tags: ["standard", "instructions"],
    body: "Markdown convention for agent instructions. Related to [OKF](concepts/okf), which carries knowledge rather than instructions.",
  });
  await v.log("seeded demo bundle");
  console.log(`Seeded ${(await v.list()).length} concepts into ${root}`);
}

async function viz() {
  const v = new Vault(root);
  const graph = await v.graph();
  const html = VIZ_TEMPLATE.replace("__GRAPH__", JSON.stringify(graph));
  const out = path.join(root, "viz.html");
  await fs.writeFile(out, html, "utf8");
  console.log(`Wrote ${out} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
}

const VIZ_TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OC5 — Open Context Vault</title>
<style>
  :root { --ink:#11201a; --paper:#f6f4ee; --line:#c9c4b6; --accent:#1f6f54; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:ui-monospace,"SF Mono",Menlo,monospace; background:var(--paper); color:var(--ink); }
  header { padding:18px 22px; border-bottom:1px solid var(--line); }
  header b { font-weight:650; letter-spacing:.02em; }
  header span { color:#6b6657; }
  svg { width:100vw; height:calc(100vh - 60px); display:block; }
  .edge { stroke:var(--line); stroke-width:1; }
  .node circle { fill:#fff; stroke:var(--accent); stroke-width:1.5; }
  .node text { font-size:11px; fill:var(--ink); }
  .node:hover circle { fill:var(--accent); }
</style></head>
<body>
<header><b>OC5</b> &nbsp;<span>knowledge graph — drag nodes, hover to read</span></header>
<svg id="c"></svg>
<script>
const G = __GRAPH__;
const svg = document.getElementById("c");
const W = svg.clientWidth, H = svg.clientHeight;
const idset = new Set(G.nodes.map(n=>n.id));
const nodes = G.nodes.map((n,i)=>({...n, x:W/2+Math.cos(i)*180, y:H/2+Math.sin(i)*180, vx:0, vy:0}));
const pos = Object.fromEntries(nodes.map(n=>[n.id,n]));
const edges = G.edges.filter(e=>idset.has(e.to)&&idset.has(e.from));
function step(){
  for(const a of nodes){ for(const b of nodes){ if(a===b) continue;
    let dx=a.x-b.x, dy=a.y-b.y, d=Math.hypot(dx,dy)||1;
    let f=2200/(d*d); a.vx+=dx/d*f; a.vy+=dy/d*f; } }
  for(const e of edges){ const a=pos[e.from], b=pos[e.to];
    let dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1, f=(d-140)*0.01;
    a.vx+=dx/d*f; a.vy+=dy/d*f; b.vx-=dx/d*f; b.vy-=dy/d*f; }
  for(const n of nodes){ if(n===drag) continue;
    n.vx+=(W/2-n.x)*0.0008; n.vy+=(H/2-n.y)*0.0008;
    n.x+=n.vx*=0.85; n.y+=n.vy*=0.85; }
  render();
}
let drag=null;
function render(){
  let s="";
  for(const e of edges){ const a=pos[e.from], b=pos[e.to];
    s+=\`<line class="edge" x1="\${a.x}" y1="\${a.y}" x2="\${b.x}" y2="\${b.y}"/>\`; }
  for(const n of nodes){
    s+=\`<g class="node" data-id="\${n.id}"><circle cx="\${n.x}" cy="\${n.y}" r="7"/>\`+
       \`<text x="\${n.x+11}" y="\${n.y+4}">\${n.title}</text>\`+
       \`<title>\${n.id} — \${n.type||""}</title></g>\`;
  }
  svg.innerHTML=s;
}
svg.addEventListener("mousedown",ev=>{
  const g=ev.target.closest(".node"); if(!g) return;
  drag=pos[g.dataset.id];
});
window.addEventListener("mousemove",ev=>{ if(!drag) return;
  const r=svg.getBoundingClientRect(); drag.x=ev.clientX-r.left; drag.y=ev.clientY-r.top; drag.vx=drag.vy=0; });
window.addEventListener("mouseup",()=>drag=null);
setInterval(step,33);
</script></body></html>`;

const run = { seed, viz, import: importCmd, check: checkCmd, watch: watchCmd, join: joinCmd, sync: syncCmd, "git-sync": gitSyncCmd, "live-sync": liveSyncCmd };
if (!run[cmd]) {
  console.error("usage: oc5 <seed|viz|import|check|watch|join|sync|live-sync|git-sync> [args]");
  console.error("  oc5 import <obsidianDir> <destVault>   convert an Obsidian vault to OC5/OKF");
  console.error("  oc5 check  <obsidianDir>               dry-run an import (source untouched)");
  console.error("  oc5 watch  <vaultDir>                  print live on-disk changes");
  console.error("  oc5 join   <vaultDir> <peerUrl> <token>  join a peer vault and reconcile");
  console.error("  oc5 sync   <vaultDir>                  reconcile once against saved peers");
  console.error("  oc5 live-sync <vaultDir>               real-time sync with saved peers");
  console.error("  oc5 git-sync <vaultDir> [remoteUrl]    fallback: sync via git");
  process.exit(1);
}
await run[cmd]();

async function liveSyncCmd() {
  const { LiveSync } = await import("./core/live-sync.js");
  const dir = process.argv[3] ?? "./vault";
  const agent = new LiveSync(dir);
  agent.on("log", (m) => console.log(`[live] ${m}`));
  await agent.start();
  console.log(`Live sync running for ${dir} (ctrl-C to stop)`);
}

async function importCmd() {
  const src = process.argv[3];
  const dest = process.argv[4] ?? "./vault";
  if (!src) {
    console.error("usage: oc5 import <obsidianDir> <destVault>");
    process.exit(1);
  }
  const r = await importObsidian(src, dest);
  console.log(`Imported ${r.imported} notes, rewrote ${r.links} links into ${dest}`);
  if (r.unresolved.length) console.log(`  ${r.unresolved.length} unresolved wikilinks (kept as text)`);
  if (r.ambiguous.length) console.log(`  ${r.ambiguous.length} ambiguous links resolved to shortest path`);
}

// dry-run against a real vault: imports into a temp dir, reports, then cleans up.
// safe to point at your actual Obsidian vault — it never writes into the source.
async function checkCmd() {
  const src = process.argv[3];
  if (!src) {
    console.error("usage: oc5 check <obsidianDir>");
    process.exit(1);
  }
  const os = await import("node:os");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oc5-check-"));
  try {
    const r = await importObsidian(src, tmp);
    const v = new Vault(tmp);
    const ids = await v.list();
    const types = {};
    for (const id of ids) {
      const c = await v.get(id);
      types[c.type] = (types[c.type] ?? 0) + 1;
    }
    console.log(`Dry run against ${src} (source untouched)`);
    console.log(`  ${r.imported} notes would import, ${r.links} wikilinks found`);
    console.log(`  types: ${Object.entries(types).map(([t, n]) => `${t}:${n}`).join("  ")}`);
    console.log(`  unresolved wikilinks: ${r.unresolved.length}`);
    if (r.unresolved.length) {
      const sample = r.unresolved.slice(0, 8).map((u) => `${u.target}`).join(", ");
      console.log(`    e.g. ${sample}${r.unresolved.length > 8 ? " ..." : ""}`);
    }
    console.log(`  ambiguous names: ${r.ambiguous.length}`);
    console.log(`\nLooks good? Run: oc5 import "${src}" ./vault`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function watchCmd() {
  const { VaultWatcher } = await import("./core/watch.js");
  const os = await import("node:os");
  const dir = process.argv[3] ?? "./vault";
  console.log(`Watching ${dir} on ${os.platform()} (ctrl-C to stop)`);
  new VaultWatcher(dir).start().on("change", ({ ids, at }) =>
    console.log(`${at} changed: ${ids.join(", ")}`)
  );
}

// kubeadm-style: join a peer vault by url + token, reconcile once, remember the peer.
async function joinCmd() {
  const dir = process.argv[3];
  const url = process.argv[4];
  const token = process.argv[5];
  if (!dir || !url || !token) {
    console.error('usage: oc5 join <vaultDir> <peerUrl> <token>');
    process.exit(1);
  }
  const { reconcile } = await import("./core/sync.js");
  const { savePeer } = await import("./core/peers.js");
  const v = await new Vault(dir).init();
  const r = await reconcile(v, url.replace(/\/$/, ""), token);
  await savePeer(dir, { url: url.replace(/\/$/, ""), token, joinedAt: new Date().toISOString() });
  console.log(`Joined ${url}`);
  console.log(`  pulled ${r.pulled.length}, pushed ${r.pushed.length}, conflicts ${r.conflicts.length}`);
  if (r.conflicts.length) console.log(`  conflicts (loser kept as .bak): ${r.conflicts.join(", ")}`);
}

// reconcile against every saved peer
async function syncCmd() {
  const dir = process.argv[3] ?? "./vault";
  const { reconcile } = await import("./core/sync.js");
  const { loadPeers } = await import("./core/peers.js");
  const v = await new Vault(dir).init();
  const { peers } = await loadPeers(dir);
  if (!peers.length) {
    console.log("No saved peers. Use: oc5 join <vaultDir> <peerUrl> <token>");
    return;
  }
  for (const p of peers) {
    try {
      const r = await reconcile(v, p.url, p.token);
      console.log(`${p.url}: pulled ${r.pulled.length}, pushed ${r.pushed.length}, conflicts ${r.conflicts.length}`);
    } catch (e) {
      console.log(`${p.url}: FAILED ${e.message}`);
    }
  }
}

// git fallback
async function gitSyncCmd() {
  const dir = process.argv[3] ?? "./vault";
  const remote = process.argv[4] ?? null;
  const { gitSync } = await import("./core/peers.js");
  const r = await gitSync(path.resolve(dir), remote);
  console.log(`git-sync ${dir}`);
  console.log(`  pull: ${r.pulled.split("\n").pop()}`);
  console.log(`  commit: ${r.committed.split("\n").pop()}`);
  console.log(`  push: ${r.pushed.split("\n").pop()}`);
}
