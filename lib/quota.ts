// ── Free-tier quota: 5 queries/day via HMAC-signed cookie ────────────────
//
// v1 honesty note: this is a signed *cookie* counter, not a server ledger.
// A visitor who clears cookies gets a fresh 5 — an accepted risk for the
// free tier (cheap models + hard token caps bound the damage). The paid
// tier (Phase 2) moves to a real per-account ledger.

import { createHmac, timingSafeEqual } from "node:crypto";

export const FREE_DAILY_LIMIT = 5;
export const QUOTA_COOKIE = "vf_quota";

interface QuotaPayload {
  d: string; // UTC date YYYY-MM-DD
  n: number; // queries used today
}

function secret(): string {
  const s = process.env.QUOTA_SECRET;
  if (!s) throw new Error("QUOTA_SECRET is not set");
  return s;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("hex");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function encodeQuota(p: QuotaPayload): string {
  const b64 = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${b64}.${sign(b64)}`;
}

export function decodeQuota(cookieValue: string | undefined): QuotaPayload {
  const fresh: QuotaPayload = { d: todayUtc(), n: 0 };
  if (!cookieValue) return fresh;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 0) return fresh;
  const b64 = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const expected = sign(b64);
  try {
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return fresh;
    const p = JSON.parse(Buffer.from(b64, "base64url").toString()) as QuotaPayload;
    if (typeof p.d !== "string" || typeof p.n !== "number") return fresh;
    if (p.d !== todayUtc()) return fresh; // new UTC day → counter resets
    return { d: p.d, n: Math.max(0, Math.floor(p.n)) };
  } catch {
    return fresh;
  }
}

export function quotaResetIso(): string {
  const t = new Date();
  const reset = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
  return reset.toISOString();
}
