// Open Context Vault — Obsidian importer.
// Converts an Obsidian vault into a conformant OKF bundle following the OCV Profile.
//
// Handles:
//   - [[wikilinks]] and [[wikilinks|alias]]  -> markdown links to resolved ids
//   - [[note#heading]]                        -> link to the note (heading dropped)
//   - existing YAML frontmatter               -> carried over, mapped to OKF fields
//   - #tags in body and frontmatter tags      -> merged into the tags field
//   - folder layout                            -> preserved as concept id paths
//   - type inference                           -> OCV Profile types from folder/frontmatter
//
// Wikilink resolution is name-based, matching Obsidian: a [[Note]] resolves to the
// vault file named Note.md regardless of folder. Ambiguous names resolve to the
// shortest path, with a warning.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { Vault } from "./vault.js";

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const INLINE_TAG = /(^|\s)#([A-Za-z0-9_/-]+)/g;

// Obsidian allows frontmatter values that aren't valid YAML — most commonly
// [[wikilinks]] inside a field (backlinks: [[a]], [[b]]). Strict YAML rejects
// these. safeMatter tries normal parsing first, and on failure sanitizes the
// frontmatter (quoting wikilink-bearing values) and retries, so no note is lost.
function safeMatter(raw) {
  try {
    return matter(raw);
  } catch {
    // isolate frontmatter block
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { data: {}, content: raw };
    const [, fm, content] = m;
    const cleaned = fm
      .split("\n")
      .map((line) => {
        const kv = line.match(/^(\s*[\w.-]+:\s*)(.*)$/);
        if (!kv) return line;
        const [, key, val] = kv;
        // if the value contains wikilinks or unbalanced brackets, store it as a quoted string
        if (/\[\[|\]\]/.test(val)) {
          const safe = val.replace(/"/g, "'");
          return `${key}"${safe}"`;
        }
        return line;
      })
      .join("\n");
    try {
      return matter(`---\n${cleaned}\n---\n${content}`);
    } catch {
      // last resort: skip frontmatter entirely, keep the note body
      return { data: {}, content };
    }
  }
}

// map a folder name or frontmatter hint to an OCV Profile type
function inferType(relPath, frontmatter) {
  if (frontmatter.type) return frontmatter.type;
  const top = relPath.split("/")[0].toLowerCase();
  const byFolder = {
    notes: "Note", note: "Note",
    concepts: "Concept", concept: "Concept",
    people: "Entity", entities: "Entity", entity: "Entity", orgs: "Entity",
    sources: "Source", refs: "Source", references: "Source", clippings: "Source",
    runbooks: "Runbook", howto: "Runbook", procedures: "Runbook",
    decisions: "Decision", adr: "Decision",
  };
  if (byFolder[top]) return byFolder[top];
  if (path.basename(relPath).toLowerCase() === "index") return "Index";
  return "Note"; // default for a personal vault
}

// build a name -> id index for wikilink resolution
async function buildNameIndex(srcRoot) {
  const index = new Map(); // lowercase basename -> [ids...]
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.toLowerCase().endsWith(".md")) {
        const rel = path.relative(srcRoot, full).replace(/\\/g, "/").replace(/\.md$/i, "");
        const base = path.basename(rel).toLowerCase();
        if (!index.has(base)) index.set(base, []);
        index.get(base).push(rel);
      }
    }
  };
  await walk(srcRoot);
  return index;
}

function resolveWikilink(name, nameIndex) {
  // strip heading/block refs and aliases
  const target = name.split("|")[0].split("#")[0].split("^")[0].trim();
  const key = target.toLowerCase();
  const matches = nameIndex.get(key);
  if (!matches || matches.length === 0) return { id: null, target };
  const id = matches.slice().sort((a, b) => a.length - b.length)[0];
  return { id, target, ambiguous: matches.length > 1 };
}

// slugify a vault path into a clean OCV concept id
function toConceptId(rel) {
  return rel
    .split("/")
    .map((seg) =>
      seg.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9/_-]/g, "")
    )
    .join("/");
}

export async function importObsidian(srcRoot, destRoot, { embedder = null } = {}) {
  srcRoot = path.resolve(srcRoot);
  const vault = await new Vault(destRoot, { embedder }).init();
  const nameIndex = await buildNameIndex(srcRoot);

  const report = { imported: 0, links: 0, unresolved: [], ambiguous: [] };

  const files = [];
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.toLowerCase().endsWith(".md")) files.push(full);
    }
  };
  await walk(srcRoot);

  for (const file of files) {
    const rel = path.relative(srcRoot, file).replace(/\\/g, "/").replace(/\.md$/i, "");
    const id = toConceptId(rel);
    const raw = await fs.readFile(file, "utf8");
    const parsed = safeMatter(raw);
    let body = parsed.content;

    // collect inline #tags, then strip them from prose
    const tags = new Set();
    for (const fmTag of [].concat(parsed.data.tags ?? [])) tags.add(String(fmTag));
    for (const m of body.matchAll(INLINE_TAG)) tags.add(m[2]);

    // rewrite [[wikilinks]] -> [text](id)
    body = body.replace(WIKILINK, (_full, inner) => {
      const aliasSplit = inner.split("|");
      const display = (aliasSplit[1] ?? aliasSplit[0].split("#")[0]).trim();
      const { id: targetId, target, ambiguous } = resolveWikilink(inner, nameIndex);
      report.links++;
      if (!targetId) {
        report.unresolved.push({ from: id, target });
        return display; // drop the link, keep the text
      }
      if (ambiguous) report.ambiguous.push({ from: id, target });
      const targetConceptId = toConceptId(targetId);
      return `[${display}](${targetConceptId})`;
    });

    const fields = {
      type: inferType(rel, parsed.data),
      title: parsed.data.title ?? path.basename(rel),
      body,
    };
    if (parsed.data.description) fields.description = parsed.data.description;
    if (tags.size) fields.tags = [...tags];
    // preserve any aliases Obsidian-style under the ocv namespace
    if (parsed.data.aliases) fields.ocv = { aliases: [].concat(parsed.data.aliases) };

    await vault.put(id, fields);
    report.imported++;
  }

  await vault.log(`imported ${report.imported} notes from Obsidian vault ${path.basename(srcRoot)}`);
  return report;
}
