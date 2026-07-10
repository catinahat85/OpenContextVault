// okvault core — an OKF-conformant knowledge vault over a plain markdown directory.
//
// OKF v0.1 conformance notes (per the spec):
//  - A bundle is a directory of markdown files. Each file is a "concept".
//  - The file path (relative, without .md) is the concept's identity.
//  - Frontmatter requires exactly one field: `type`. Reserved queryable fields:
//    type, title, description, resource, tags, timestamp.
//  - Concepts link to each other with normal markdown links -> a graph.
//  - `index.md` (progressive disclosure) and `log.md` (change history) are reserved filenames.
//
// This module is the single source of truth. REST and MCP layers call it.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const RESERVED_FIELDS = ["type", "title", "description", "resource", "tags", "timestamp"];
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

export class Vault {
  /** @param {string} root absolute path to the bundle directory
   *  @param {object} [opts]
   *  @param {{embed:(t:string)=>Promise<number[]>}} [opts.embedder] optional embedder for hybrid search */
  constructor(root, opts = {}) {
    this.root = path.resolve(root);
    this.embedder = opts.embedder ?? null;
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
    return this;
  }

  // --- identity helpers -----------------------------------------------------

  // concept id is the posix-style relative path without the .md extension.
  _idToFile(id) {
    const clean = id.replace(/\.md$/i, "").replace(/^\/+/, "");
    const abs = path.resolve(this.root, clean + ".md");
    if (!abs.startsWith(this.root + path.sep) && abs !== this.root) {
      throw new Error(`refusing path outside vault: ${id}`);
    }
    return abs;
  }

  _fileToId(absFile) {
    const rel = path.relative(this.root, absFile);
    return rel.replace(/\\/g, "/").replace(/\.md$/i, "");
  }

  // --- read -----------------------------------------------------------------

  async list() {
    const out = [];
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.name.toLowerCase() === "log.md") continue; // reserved history file, not a concept
        else if (e.name === "AGENTS.md") continue; // agent directive, not a concept
        else if (/\.bak\.md$/i.test(e.name)) continue; // sync conflict backups, not concepts
        else if (e.name.toLowerCase().endsWith(".md")) out.push(this._fileToId(full));
      }
    };
    try {
      await walk(this.root);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    return out.sort();
  }

  async get(id) {
    const file = this._idToFile(id);
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    const parsed = matter(raw);
    return {
      id: this._fileToId(file),
      type: parsed.data.type ?? null,
      frontmatter: parsed.data,
      body: parsed.content.trim(),
      links: this._extractLinks(id, parsed.content),
    };
  }

  // --- write ----------------------------------------------------------------

  // Create or replace a concept. `type` is required by OKF.
  async put(id, { type, body = "", ...fields } = {}) {
    if (!type || typeof type !== "string") {
      throw new Error("OKF requires a non-empty `type` on every concept");
    }
    const data = { type, ...fields };
    if (!data.timestamp) data.timestamp = new Date().toISOString();
    const file = this._idToFile(id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const content = matter.stringify(`\n${body.trim()}\n`, data);
    await fs.writeFile(file, content, "utf8");
    return this.get(id);
  }

  async delete(id) {
    const file = this._idToFile(id);
    try {
      await fs.unlink(file);
      return true;
    } catch (err) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  }

  // append a dated line to the bundle's log.md (reserved history file)
  async log(message) {
    const file = path.join(this.root, "log.md");
    const line = `- ${new Date().toISOString()} ${message}\n`;
    await fs.appendFile(file, line, "utf8");
    return true;
  }

  // --- graph + search -------------------------------------------------------

  _extractLinks(fromId, body) {
    const links = [];
    for (const m of body.matchAll(MD_LINK)) {
      const target = m[2];
      if (/^[a-z]+:\/\//i.test(target) || target.startsWith("#")) continue; // external / anchor
      const norm = target.replace(/^\/+/, "").replace(/\.md$/i, "");
      links.push({ text: m[1], target: norm });
    }
    return links;
  }

  // full graph: nodes (concepts) + edges (resolved internal links)
  async graph() {
    const ids = await this.list();
    const nodes = [];
    const edges = [];
    for (const id of ids) {
      const c = await this.get(id);
      nodes.push({ id, type: c.type, title: c.frontmatter.title ?? id });
      for (const l of c.links) {
        edges.push({ from: id, to: l.target, text: l.text });
      }
    }
    return { nodes, edges };
  }

  _conceptText(c) {
    return [
      c.frontmatter.title ?? "",
      c.frontmatter.description ?? "",
      (c.frontmatter.tags ?? []).join(" "),
      c.body,
    ].join("\n");
  }

  // keyword search: token-based scoring over the searchable text. Always available.
  async keywordSearch(query, { limit = 20 } = {}) {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 1);
    if (terms.length === 0) return [];
    const ids = await this.list();
    const hits = [];
    for (const id of ids) {
      const c = await this.get(id);
      const text = this._conceptText(c);
      const hay = (id + "\n" + (c.type ?? "") + "\n" + text).toLowerCase();
      let score = 0;
      let firstIdx = Infinity;
      for (const t of terms) {
        const occ = hay.split(t).length - 1;
        if (occ > 0) {
          score += occ;
          firstIdx = Math.min(firstIdx, hay.indexOf(t));
        }
      }
      if (score === 0) continue;
      // bonus for matching more distinct terms; mild rank boost for earlier match
      const distinct = terms.filter((t) => hay.includes(t)).length;
      score = (score + distinct * 2) / (1 + firstIdx / 400);
      const start = Math.max(0, firstIdx - 60);
      hits.push({
        id,
        type: c.type,
        title: c.frontmatter.title ?? id,
        score,
        snippet: hay.slice(start, firstIdx + 120).replace(/\s+/g, " ").trim(),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  // hybrid search: blends keyword score with vector cosine similarity when an
  // embedder is configured. Falls back to keyword-only if not.
  // `embedder` is any object with async embed(text) -> number[].
  async search(query, { limit = 20, embedder = this.embedder, alpha = 0.5 } = {}) {
    if (!embedder) return this.keywordSearch(query, { limit });

    const ids = await this.list();
    const qvec = await embedder.embed(query);
    const kw = await this.keywordSearch(query, { limit: ids.length });
    const kwById = Object.fromEntries(kw.map((h) => [h.id, h]));
    const kwMax = Math.max(1e-9, ...kw.map((h) => h.score));

    const scored = [];
    for (const id of ids) {
      const c = await this.get(id);
      const cvec = await embedder.embed(this._conceptText(c));
      const vsim = cosine(qvec, cvec); // 0..1-ish
      const ksim = (kwById[id]?.score ?? 0) / kwMax; // normalized 0..1
      const blended = alpha * vsim + (1 - alpha) * ksim;
      if (blended <= 0) continue;
      scored.push({
        id,
        type: c.type,
        title: c.frontmatter.title ?? id,
        score: Number(blended.toFixed(4)),
        vector: Number(vsim.toFixed(4)),
        keyword: Number(ksim.toFixed(4)),
        snippet: kwById[id]?.snippet ?? (c.frontmatter.description ?? "").slice(0, 120),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // backlinks: who points at this concept
  async backlinks(id) {
    const target = id.replace(/\.md$/i, "");
    const { edges } = await this.graph();
    return edges.filter((e) => e.to === target).map((e) => ({ from: e.from, text: e.text }));
  }

  // primer: the "load the brain first" payload, bounded for one cheap session-start call.
  // Returns immediate context (root index body), recent history (capped log tail),
  // and a lightweight concept map (id + type + title only, no bodies).
  async primer({ logLines = 20 } = {}) {
    const index = await this.get("index");
    const ids = await this.list();
    const map = [];
    for (const id of ids) {
      const c = await this.get(id);
      map.push({ id, type: c.type, title: c.frontmatter.title ?? id });
    }

    // tail of log.md, most recent first
    let recent = [];
    try {
      const raw = await fs.readFile(path.join(this.root, "log.md"), "utf8");
      recent = raw.split("\n").filter((l) => l.trim()).slice(-logLines).reverse();
    } catch {
      /* no log yet */
    }

    return {
      context: index ? { id: index.id, type: index.type, title: index.frontmatter.title ?? "index", body: index.body } : null,
      recent,            // recent history lines, newest first
      conceptCount: map.length,
      map,               // [{id,type,title}] — orientation, not full content
      hint: "Call vault_get <id> to read any concept in full, vault_search to find by topic.",
    };
  }
}

export { RESERVED_FIELDS };

// cosine similarity, clamped to [0,1] for blending.
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, c);
}
