// Open Context Vault (OC5) — live sync agent.
// Turns on-demand reconcile into real-time sync. For each saved peer, the agent:
//   1. does an initial reconcile so both sides start converged,
//   2. opens a persistent SSE connection to the peer's /events stream,
//   3. reconciles (debounced) whenever the peer reports a change,
//   4. also reconciles when our own local watcher reports a change (push side),
//   5. auto-reconnects with backoff if a peer drops.
//
// Still last-write-wins per concept (see sync.js). Real-time shrinks the window
// for conflicts; it does not merge simultaneous edits.

import { EventEmitter } from "node:events";
import { Vault } from "./vault.js";
import { reconcile } from "./sync.js";
import { VaultWatcher } from "./watch.js";
import { loadPeers } from "./peers.js";

export class LiveSync extends EventEmitter {
  constructor(vaultDir, { debounceMs = 400 } = {}) {
    super();
    this.dir = vaultDir;
    this.debounceMs = debounceMs;
    this.vault = new Vault(vaultDir);
    this.peers = [];
    this._conns = new Map(); // peerUrl -> { abort, timer }
    this._stopped = false;
    this._localTimer = null;
  }

  async start() {
    await this.vault.init();
    const cfg = await loadPeers(this.dir);
    this.peers = cfg.peers ?? [];
    if (!this.peers.length) {
      this.emit("log", "no peers configured; nothing to sync");
      return this;
    }

    // local watcher: when WE change, push to every peer (debounced)
    this._watcher = new VaultWatcher(this.dir, { debounceMs: 150 }).start();
    this._watcher.on("change", () => this._scheduleLocal());

    for (const peer of this.peers) {
      await this._syncPeer(peer, "initial");
      this._connect(peer);
    }
    return this;
  }

  _scheduleLocal() {
    if (this._localTimer) clearTimeout(this._localTimer);
    this._localTimer = setTimeout(() => {
      this._localTimer = null;
      for (const peer of this.peers) this._syncPeer(peer, "local-change");
    }, this.debounceMs);
  }

  // open a persistent SSE connection to a peer and reconcile on each change event
  _connect(peer) {
    if (this._stopped) return;
    const controller = new AbortController();
    const state = { abort: controller, timer: null, backoff: 1000 };
    this._conns.set(peer.url, state);

    const debouncedSync = () => {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => this._syncPeer(peer, "peer-change"), this.debounceMs);
    };

    (async () => {
      try {
        const res = await fetch(`${peer.url}/events`, {
          headers: { authorization: `Bearer ${peer.token}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        this.emit("log", `live: connected to ${peer.url}`);
        state.backoff = 1000; // reset on success

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!this._stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // SSE frames are separated by blank lines; we only care that a change arrived
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (frame.includes("event: change")) debouncedSync();
          }
        }
      } catch (err) {
        if (this._stopped || controller.signal.aborted) return;
        this.emit("log", `live: ${peer.url} dropped (${err.message}); retrying`);
      }
      // reconnect with capped backoff
      if (!this._stopped) {
        const wait = Math.min(state.backoff, 15000);
        state.backoff = wait * 2;
        setTimeout(() => this._connect(peer), wait);
      }
    })();
  }

  async _syncPeer(peer, reason) {
    try {
      const r = await reconcile(this.vault, peer.url, peer.token);
      const moved = r.pulled.length + r.pushed.length;
      if (moved > 0 || reason === "initial") {
        this.emit("sync", { peer: peer.url, reason, ...r });
        this.emit(
          "log",
          `sync (${reason}) ${peer.url}: pulled ${r.pulled.length}, pushed ${r.pushed.length}, conflicts ${r.conflicts.length}`
        );
      }
    } catch (err) {
      this.emit("log", `sync failed ${peer.url}: ${err.message}`);
    }
  }

  stop() {
    this._stopped = true;
    for (const { abort, timer } of this._conns.values()) {
      abort.abort();
      if (timer) clearTimeout(timer);
    }
    this._conns.clear();
    if (this._watcher) this._watcher.stop();
    if (this._localTimer) clearTimeout(this._localTimer);
  }
}
