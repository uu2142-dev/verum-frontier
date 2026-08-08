// ── In-browser verifier for a sealed Verum Frontier session ──────────────
//
// Recomputes every hash a downloaded session claims, entirely in the visitor's
// browser — nothing is uploaded, matching the privacy note. This is the browser
// twin of the reference verifier at github.com/uu2142-dev/alice-evidence
// (memory/verify_session.py). Its leaf preimages were checked byte-for-byte
// against real sealed sessions before shipping; a verifier that cried "tampered"
// on a genuine record would be worse than none.
//
// The four checks, in the order that matters:
//   1. Content → leaf.   Recompute each leaf's hash from the readable text/data
//      in the file. This is the one that catches an edited transcript: the seal
//      can be authentic while the words beside it were changed.
//   2. Leaves → root.    The Merkle root recomputes from the leaf hashes.
//   3. Root → signature. The Ed25519 signature verifies against the published
//      public key, proving this gate sealed this root at this time.
//   4. Root → chain.     Each exchange's chain hash links to the one before it,
//      so exchanges can't be reordered, dropped, or spliced in.

// id → providerModel. Public data mirrored from the model registry (lib/pricing.ts);
// the TIMING leaf is hashed over the provider's model name, not our display id.
const PROVIDER_MODEL: Record<string, string> = {
  "llama-3.3-70b": "llama-3.3-70b-versatile",
  "gpt-oss-120b": "openai/gpt-oss-120b",
  "qwen3.6-27b": "qwen/qwen3.6-27b",
  "gemini-2.5-flash": "gemini-2.5-flash",
  "claude-opus-4.8": "claude-opus-4-8",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-haiku-4.5": "claude-haiku-4-5",
  "claude-fable-5": "claude-fable-5",
  "gpt-5.6-sol": "gpt-5.6-sol",
  "grok-4.5": "grok-4.5",
};

const GENESIS_PREFIX = "VERUM_FRONTIER_SESSION_GENESIS";
const SIGNED_PREFIX = "VF-SEAL-v1";

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

// Byte-identical to the gate's Merkle: pair left-to-right, duplicate the last
// when odd, hash the concatenation of the two hex strings.
export async function merkleRoot(hashes: string[]): Promise<string> {
  if (!hashes.length) return "";
  let level = [...hashes];
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha256Hex(level[i] + level[i + 1]));
    level = next;
  }
  return level[0];
}

// Returns a real ArrayBuffer (a valid BufferSource for Web Crypto, which the
// strict DOM lib no longer accepts from a bare Uint8Array<ArrayBufferLike>).
function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function utf8(s: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return buf;
}

// null → this browser's Web Crypto lacks Ed25519 (hashes still verify without it).
export async function verifyEd25519(spkiB64: string, payload: string, sigB64: string): Promise<boolean | null> {
  try {
    const key = await crypto.subtle.importKey("spki", b64ToBuffer(spkiB64), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, b64ToBuffer(sigB64), utf8(payload));
  } catch {
    return null;
  }
}

// keyId is the fingerprint of the signing key: sha256(spki DER)[:16]. Confirms
// the key that signed the session is the one the file publishes as its own.
export async function deriveKeyId(spkiB64: string): Promise<string | null> {
  try {
    return toHex(await crypto.subtle.digest("SHA-256", b64ToBuffer(spkiB64))).slice(0, 16);
  } catch {
    return null;
  }
}

// The exact preimage the gate hashed for a given leaf label. `null` means the
// leaf can't be recomputed from the export alone (DOCUMENT: the attachment text
// is the user's and isn't exported; unknown labels from a future format).
function leafPreimage(label: string, ex: Exchange, sealedAt: string): string | null {
  switch (label) {
    case "QUERY":    return JSON.stringify({ q: ex.query, ts: sealedAt });
    case "RESPONSE": return JSON.stringify({ r: ex.response, model: ex.model });
    case "RECEIPT":  return JSON.stringify(ex.receipt);
    case "BIAS":     return ex.biasScreen ? JSON.stringify(ex.biasScreen) : null;
    case "MEMORY":   return ex.memoryRecall ? JSON.stringify(ex.memoryRecall.roots) : null;
    case "SOURCES":  return ex.grounding ? JSON.stringify(ex.grounding.sources.map(s => s.uri)) : null;
    case "TIMING":   return JSON.stringify({ model: PROVIDER_MODEL[ex.model] ?? ex.model, llmMs: ex.timingMs?.llm ?? 0 });
    case "DOCUMENT": return null;
    default:         return null;
  }
}

// ── Types (only the fields the verifier reads) ──────────────────────────────
export interface Leaf { label: string; sha256: string }
export interface Seal {
  algo: string;
  leaves: Leaf[];
  root: string;
  sealedAt: string;
  sig?: { alg: string; keyId: string; signature: string };
}
export interface Exchange {
  query: string;
  response: string;
  model: string;
  receipt: unknown;
  biasScreen?: unknown;
  memoryRecall?: { roots: string[] } | null;
  grounding?: { sources: { title: string; uri: string }[] } | null;
  attachmentMeta?: { name: string; chars: number } | null;
  timingMs?: { llm: number };
  seal: Seal;
  sessionChainHash: string;
}
export interface SealedSession {
  format?: string;
  startedAt: string;
  exchanges: Exchange[];
  sessionChainRoot: string;
  sealPublicKey?: { alg: string; keyId: string; publicKeySpkiB64: string };
}

export type LeafStatus = "match" | "mismatch" | "skipped";
export interface LeafResult { label: string; claimed: string; computed: string | null; status: LeafStatus; note?: string }
export interface ExchangeResult {
  index: number;
  model: string;
  queryPreview: string;
  declined?: boolean;
  truncated?: boolean;
  leaves: LeafResult[];
  rootOk: boolean;
  computedRoot: string;
  claimedRoot: string;
  sigStatus: "valid" | "invalid" | "unsigned" | "no-webcrypto";
  keyIdMatch: boolean | null;
  chainOk: boolean;
}
export interface SessionResult {
  ok: boolean;
  exchangeCount: number;
  exchanges: ExchangeResult[];
  chainRootOk: boolean;
  anyMismatch: boolean;
  anySkipped: boolean;
  webCryptoEd25519: boolean;
}

export async function verifySession(doc: SealedSession): Promise<SessionResult> {
  if (!doc || !Array.isArray(doc.exchanges)) {
    throw new Error("This does not look like a sealed session file (no exchanges array).");
  }
  const spkiB64 = doc.sealPublicKey?.publicKeySpkiB64;
  const publishedKeyId = doc.sealPublicKey?.keyId ?? null;

  let prevChain = await sha256Hex(GENESIS_PREFIX + doc.startedAt);
  let anyMismatch = false, anySkipped = false, ed25519Available = true;
  const exchanges: ExchangeResult[] = [];

  for (let i = 0; i < doc.exchanges.length; i++) {
    const ex = doc.exchanges[i];
    const sealedAt = ex.seal.sealedAt;

    const leaves: LeafResult[] = [];
    for (const leaf of ex.seal.leaves) {
      const pre = leafPreimage(leaf.label, ex, sealedAt);
      if (pre === null) {
        anySkipped = true;
        leaves.push({
          label: leaf.label, claimed: leaf.sha256, computed: null, status: "skipped",
          note: leaf.label === "DOCUMENT"
            ? "attachment text is not exported — check against your own copy of the file"
            : "not recomputable from this file",
        });
        continue;
      }
      const computed = await sha256Hex(pre);
      const status: LeafStatus = computed === leaf.sha256 ? "match" : "mismatch";
      if (status === "mismatch") anyMismatch = true;
      leaves.push({ label: leaf.label, claimed: leaf.sha256, computed, status });
    }

    const computedRoot = await merkleRoot(ex.seal.leaves.map(l => l.sha256));
    const rootOk = computedRoot === ex.seal.root;
    if (!rootOk) anyMismatch = true;

    let sigStatus: ExchangeResult["sigStatus"] = "unsigned";
    let keyIdMatch: boolean | null = null;
    if (ex.seal.sig?.signature && spkiB64) {
      const payload = `${SIGNED_PREFIX}|${ex.seal.root}|${sealedAt}`;
      const ok = await verifyEd25519(spkiB64, payload, ex.seal.sig.signature);
      if (ok === null) { sigStatus = "no-webcrypto"; ed25519Available = false; }
      else { sigStatus = ok ? "valid" : "invalid"; if (!ok) anyMismatch = true; }
      const derived = await deriveKeyId(spkiB64);
      keyIdMatch = derived !== null && publishedKeyId !== null
        ? derived === publishedKeyId && ex.seal.sig.keyId === publishedKeyId
        : null;
    }

    const chain = await sha256Hex(prevChain + ex.seal.root);
    const chainOk = chain === ex.sessionChainHash;
    if (!chainOk) anyMismatch = true;
    prevChain = chain;

    exchanges.push({
      index: i,
      model: ex.model,
      queryPreview: (ex.query || "").slice(0, 100),
      declined: (ex as { declined?: boolean }).declined,
      truncated: (ex as { truncated?: boolean }).truncated,
      leaves, rootOk, computedRoot, claimedRoot: ex.seal.root,
      sigStatus, keyIdMatch, chainOk,
    });
  }

  const chainRootOk = prevChain === doc.sessionChainRoot;
  if (!chainRootOk) anyMismatch = true;

  return {
    ok: !anyMismatch,
    exchangeCount: doc.exchanges.length,
    exchanges,
    chainRootOk,
    anyMismatch,
    anySkipped,
    webCryptoEd25519: ed25519Available,
  };
}
