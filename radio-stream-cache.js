'use strict';

const MAX_ENTRIES = 5000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function safeEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.candidateKey !== 'string' || !entry.candidateKey || !/^[A-Za-z0-9_-]{11}$/.test(entry.videoId || '')) return null;
  return { candidateKey: entry.candidateKey.slice(0, 1000), aliasKey: typeof entry.aliasKey === 'string' ? entry.aliasKey.slice(0, 1000) : '', videoId: entry.videoId, confidence: Math.max(0, Math.min(1, Number(entry.confidence) || 0)), matcherVersion: Number(entry.matcherVersion) || 0, verifiedAt: Number(entry.verifiedAt) || 0, lastUsedAt: Number(entry.lastUsedAt) || 0 };
}
class DurableMatchCache {
  constructor(options) { options = options || {}; this.entries = new Map(); this.now = options.now || Date.now; this.write = options.write || null; }
  hydrate(raw) { this.entries.clear(); (Array.isArray(raw) ? raw : []).forEach((entry) => { entry = safeEntry(entry); if (entry) this.entries.set(entry.candidateKey, entry); }); this.prune(); }
  get(candidateKey, matcherVersion) { const entry = this.entries.get(candidateKey); if (!entry || entry.matcherVersion !== matcherVersion || this.now() - entry.verifiedAt > MAX_AGE_MS) return null; entry.lastUsedAt = this.now(); return { ...entry }; }
  set(entry) { entry = safeEntry({ ...entry, lastUsedAt: this.now() }); if (!entry) return false; this.entries.set(entry.candidateKey, entry); this.prune(); this.persist(); return true; }
  invalidate(candidateKey) { if (this.entries.delete(candidateKey)) this.persist(); }
  invalidateVideoId(videoId) { let changed = false; for (const [key, entry] of this.entries) { if (entry.videoId === videoId) { this.entries.delete(key); changed = true; } } if (changed) this.persist(); return changed; }
  serialize() { return Array.from(this.entries.values()).sort((a, b) => b.lastUsedAt - a.lastUsedAt); }
  prune() { let list = this.serialize(); while (list.length > MAX_ENTRIES || Buffer.byteLength(JSON.stringify(list)) > MAX_BYTES) { const removed = list.pop(); if (removed) this.entries.delete(removed.candidateKey); list = this.serialize(); } }
  persist() { if (this.write) return this.write(this.serialize()); }
}
class RuntimeLeaseCache {
  constructor(options) { options = options || {}; this.now = options.now || Date.now; this.randomToken = options.randomToken || (() => require('crypto').randomBytes(24).toString('base64url')); this.leases = new Map(); }
  create(videoId, source, ownership) { if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '') || !source || typeof source.url !== 'string') throw new Error('Invalid stream lease source'); const leaseId = this.randomToken(); const lease = { leaseId, videoId, url: source.url, headers: { ...(source.headers || {}) }, createdAt: this.now(), expiresAt: Number(source.expiresAt) || this.now() + 5 * 60 * 1000, ownership: { ...(ownership || {}) }, lastUsedAt: this.now() }; this.leases.set(leaseId, lease); return { leaseId, expiresAt: lease.expiresAt }; }
  get(leaseId, ownership) { const lease = this.leases.get(String(leaseId || '')); if (!lease || lease.expiresAt <= this.now() || (ownership && !sameOwnership(lease.ownership, ownership))) { if (lease) this.leases.delete(String(leaseId)); return null; } lease.lastUsedAt = this.now(); return lease; }
  release(leaseId) { return this.leases.delete(String(leaseId || '')); }
  releaseByOwnership(ownership) { for (const [id, lease] of this.leases) if (sameOwnership(lease.ownership, ownership)) this.leases.delete(id); }
  clear() { this.leases.clear(); }
}
function sameOwnership(expected, actual) { if (!expected) return false; actual = actual || {}; return ['stationId', 'queueEntryId', 'generation'].every((key) => String(expected[key] || '') === String(actual[key] || '')); }
module.exports = { MAX_ENTRIES, MAX_BYTES, DurableMatchCache, RuntimeLeaseCache, safeEntry, sameOwnership };
