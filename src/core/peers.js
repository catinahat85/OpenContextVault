// Open Context Vault (OC5) — peer registry + Git fallback.

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function peersFile(vaultRoot) {
  return path.resolve(vaultRoot, ".oc5", "peers.json");
}

export async function loadPeers(vaultRoot) {
  try {
    return JSON.parse(await fs.readFile(peersFile(vaultRoot), "utf8"));
  } catch {
    return { peers: [] };
  }
}

export async function savePeer(vaultRoot, peer) {
  const f = peersFile(vaultRoot);
  await fs.mkdir(path.dirname(f), { recursive: true });
  const cfg = await loadPeers(vaultRoot);
  cfg.peers = cfg.peers.filter((p) => p.url !== peer.url);
  cfg.peers.push(peer);
  await fs.writeFile(f, JSON.stringify(cfg, null, 2), "utf8");
  return cfg;
}

// --- Git fallback: vault is plain files, so git just works ---

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `git ${args[0]} exited ${code}`))
    );
    p.on("error", reject);
  });
}

export async function gitSync(vaultRoot, remote) {
  // init if needed
  try {
    await git(["rev-parse", "--is-inside-work-tree"], vaultRoot);
  } catch {
    await git(["init"], vaultRoot);
    await git(["checkout", "-B", "main"], vaultRoot);
  }
  if (remote) {
    try {
      await git(["remote", "add", "origin", remote], vaultRoot);
    } catch {
      await git(["remote", "set-url", "origin", remote], vaultRoot);
    }
  }
  // pull first (merge remote changes), then commit + push
  let pulled = "";
  try {
    pulled = await git(["pull", "--no-rebase", "--no-edit", "origin", "main"], vaultRoot);
  } catch (e) {
    pulled = `(no pull: ${e.message})`;
  }
  await git(["add", "-A"], vaultRoot);
  let committed = "nothing to commit";
  try {
    committed = await git(["commit", "-m", `oc5 sync ${new Date().toISOString()}`], vaultRoot);
  } catch {
    /* nothing staged */
  }
  let pushed = "";
  try {
    pushed = await git(["push", "-u", "origin", "main"], vaultRoot);
  } catch (e) {
    pushed = `(no push: ${e.message})`;
  }
  return { pulled, committed, pushed };
}
