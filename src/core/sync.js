// Open Context Vault (OC5) — sync core.
// Peer-to-peer vault reconciliation, kubeadm-style: a peer joins a vault by
// address + token, pulls state, then pushes/pulls concept changes.
//
// Model (v0):
//   - Each concept is content-hashed. A vault's MANIFEST is { id -> {hash, timestamp} }.
//   - Reconcile = diff two manifests, transfer the concepts that differ.
//   - Conflict (both sides changed the same id) -> last-write-wins by timestamp,
//     and the losing version is written to <id>.bak so nothing is lost.
// This is pull/push reconciliation with a join handshake, not live consensus.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Vault } from "./vault.js";

export function hashConcept(concept) {
  // hash the meaningful content, not the volatile timestamp
  const payload = JSON.stringify({
    type: concept.type,
    body: concept.body,
    fm: { ...concept.frontmatter, timestamp: undefined },
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

// build a manifest of the local vault: id -> { hash, timestamp }
export async function manifest(vault) {
  const ids = await vault.list();
  const out = {};
  for (const id of ids) {
    const c = await vault.get(id);
    out[id] = { hash: hashConcept(c), timestamp: c.frontmatter.timestamp ?? null };
  }
  return out;
}

// serialize a single concept for transport
export async function exportConcept(vault, id) {
  const c = await vault.get(id);
  if (!c) return null;
  return { id, type: c.type, frontmatter: c.frontmatter, body: c.body };
}

// apply a received concept, resolving conflicts by timestamp, backing up the loser
export async function applyConcept(vault, incoming, localManifest) {
  const id = incoming.id;
  const local = localManifest[id];
  const incomingHash = hashConcept({
    type: incoming.type,
    body: incoming.body,
    frontmatter: incoming.frontmatter,
  });

  // identical content -> nothing to do
  if (local && local.hash === incomingHash) return { id, action: "skip" };

  if (local) {
    // both sides have it and they differ -> conflict. newer timestamp wins.
    const localTs = Date.parse(local.timestamp ?? 0) || 0;
    const incomingTs = Date.parse(incoming.frontmatter?.timestamp ?? 0) || 0;
    if (localTs > incomingTs) {
      // local wins; keep incoming as a backup so it isn't lost
      await backup(vault, id, incoming, "remote");
      return { id, action: "kept-local" };
    }
    // incoming wins; back up the local copy first
    const localConcept = await exportConcept(vault, id);
    await backup(vault, id, localConcept, "local");
  }

  const { type, body, frontmatter } = incoming;
  const { type: _t, timestamp, ...fields } = frontmatter ?? {};
  await vault.put(id, { type, body, timestamp, ...fields });
  return { id, action: local ? "updated" : "created" };
}

async function backup(vault, id, concept, side) {
  if (!concept) return;
  const file = path.resolve(vault.root, id + `.${side}.bak.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const fm = concept.frontmatter ?? { type: concept.type };
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${JSON.stringify(v)}`);
  lines.push("---", "", concept.body ?? "");
  await fs.writeFile(file, lines.join("\n"), "utf8");
}

// reconcile this vault against a remote peer's HTTP sync API.
// pushes local-only/newer concepts, pulls remote-only/newer concepts.
export async function reconcile(vault, peerUrl, token) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const local = await manifest(vault);

  // get remote manifest
  const rm = await fetch(`${peerUrl}/sync/manifest`, { headers });
  if (!rm.ok) throw new Error(`peer manifest failed: ${rm.status}`);
  const remote = await rm.json();

  const report = { pulled: [], pushed: [], conflicts: [] };

  // PULL: ids the remote has that we lack or that differ
  for (const [id, meta] of Object.entries(remote)) {
    const localMeta = local[id];
    if (!localMeta || localMeta.hash !== meta.hash) {
      const r = await fetch(`${peerUrl}/sync/concept?id=${encodeURIComponent(id)}`, { headers });
      if (!r.ok) continue;
      const incoming = await r.json();
      const res = await applyConcept(vault, incoming, local);
      if (res.action === "kept-local" || res.action === "updated") report.conflicts.push(id);
      if (res.action !== "skip") report.pulled.push({ id, ...res });
    }
  }

  // refresh local manifest after pulls so we don't re-push what we just pulled
  const local2 = await manifest(vault);

  // PUSH: ids we have that the remote lacks or that differ
  for (const [id, meta] of Object.entries(local2)) {
    const remoteMeta = remote[id];
    if (!remoteMeta || remoteMeta.hash !== meta.hash) {
      const concept = await exportConcept(vault, id);
      const r = await fetch(`${peerUrl}/sync/push`, {
        method: "POST",
        headers,
        body: JSON.stringify(concept),
      });
      if (r.ok) report.pushed.push(id);
    }
  }

  return report;
}
