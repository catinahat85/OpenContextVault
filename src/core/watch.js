// Open Context Vault (OC5) — file watcher.
// Reflects on-disk edits to the vault live. Uses node:fs.watch (recursive),
// which is supported on macOS and Windows natively, with a portable fallback
// poller for Linux where recursive watch isn't guaranteed.
//
// Emits debounced change events so a consumer (REST SSE, an agent, a rebuild
// hook) can react without thrashing on rapid saves.

import { promises as fs, watch as fsWatch } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import os from "node:os";

export class VaultWatcher extends EventEmitter {
  constructor(root, { debounceMs = 200 } = {}) {
    super();
    this.root = path.resolve(root);
    this.debounceMs = debounceMs;
    this._timer = null;
    this._pending = new Set();
    this._watchers = [];
    this._poll = null;
  }

  start() {
    const recursiveSupported = process.platform === "darwin" || process.platform === "win32";
    if (recursiveSupported) {
      this._startRecursive();
    } else {
      this._startPolling();
    }
    return this;
  }

  _startRecursive() {
    try {
      const w = fsWatch(this.root, { recursive: true }, (_event, filename) => {
        if (filename && filename.toString().toLowerCase().endsWith(".md")) {
          this._queue(filename.toString().replace(/\\/g, "/").replace(/\.md$/i, ""));
        }
      });
      this._watchers.push(w);
    } catch (err) {
      // some environments throw on recursive; fall back to polling
      this._startPolling();
    }
  }

  // portable poller: snapshots mtimes, diffs on an interval. Works everywhere.
  _startPolling(intervalMs = 1000) {
    let snapshot = new Map();
    const scan = async () => {
      const next = new Map();
      const walk = async (dir) => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else if (e.name.toLowerCase().endsWith(".md")) {
            try {
              const st = await fs.stat(full);
              next.set(full, st.mtimeMs);
            } catch {
              /* race: file vanished mid-scan */
            }
          }
        }
      };
      await walk(this.root);
      // diff
      for (const [file, mtime] of next) {
        if (snapshot.get(file) !== mtime) {
          this._queue(path.relative(this.root, file).replace(/\\/g, "/").replace(/\.md$/i, ""));
        }
      }
      for (const file of snapshot.keys()) {
        if (!next.has(file)) {
          this._queue(path.relative(this.root, file).replace(/\\/g, "/").replace(/\.md$/i, ""));
        }
      }
      snapshot = next;
    };
    scan(); // prime snapshot without emitting on first pass
    snapshot = new Map(); // ensure first real scan emits nothing spurious
    this._poll = setInterval(scan, intervalMs);
  }

  _queue(conceptId) {
    this._pending.add(conceptId);
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      const ids = [...this._pending];
      this._pending.clear();
      this._timer = null;
      this.emit("change", { ids, at: new Date().toISOString() });
    }, this.debounceMs);
  }

  stop() {
    for (const w of this._watchers) w.close();
    this._watchers = [];
    if (this._poll) clearInterval(this._poll);
    if (this._timer) clearTimeout(this._timer);
  }
}

// run directly: node src/core/watch.js [vaultPath]
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? "./vault";
  console.log(`Watching ${root} on ${os.platform()} (ctrl-C to stop)`);
  const w = new VaultWatcher(root).start();
  w.on("change", ({ ids, at }) => console.log(`${at} changed: ${ids.join(", ")}`));
}
