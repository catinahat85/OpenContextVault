// Open Context Vault — embedder.
// A pluggable text embedder for hybrid search. Talks to any OpenAI-compatible
// /embeddings endpoint (OpenRouter, a local server, Ollama via its OpenAI shim,
// etc.). Defaults target BGE-M3. If no endpoint is configured, search degrades
// to keyword-only — the vault still works.
//
// Config via env:
//   OCV_EMBED_URL    e.g. https://openrouter.ai/api/v1/embeddings
//                    or   http://localhost:11434/v1/embeddings  (Ollama)
//   OCV_EMBED_MODEL  e.g. baai/bge-m3   (default)
//   OCV_EMBED_KEY    bearer token if the endpoint needs one

export class Embedder {
  constructor({ url, model, key } = {}) {
    this.url = url ?? process.env.OCV_EMBED_URL ?? null;
    this.model = model ?? process.env.OCV_EMBED_MODEL ?? "baai/bge-m3";
    this.key = key ?? process.env.OCV_EMBED_KEY ?? null;
    this.cache = new Map(); // text -> vector, cheap memo within a process
  }

  get enabled() {
    return Boolean(this.url);
  }

  async embed(text) {
    const k = text.slice(0, 2000);
    if (this.cache.has(k)) return this.cache.get(k);

    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.key ? { authorization: `Bearer ${this.key}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: k }),
    });
    if (!res.ok) {
      throw new Error(`embed failed ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const vec = json?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error("embedder returned no vector");
    this.cache.set(k, vec);
    return vec;
  }
}

// returns an Embedder if configured, else null (keyword-only mode)
export function embedderFromEnv() {
  const e = new Embedder();
  return e.enabled ? e : null;
}
