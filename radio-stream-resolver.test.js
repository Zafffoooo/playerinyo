'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DurableMatchCache, RuntimeLeaseCache } = require('./radio-stream-cache');
const { chooseAudioFormat, parseSearchPayload, createRadioStreamResolver } = require('./radio-stream-resolver');

test('durable cache only serializes stable video identity', () => {
  const cache = new DurableMatchCache({ now: () => 100 });
  cache.set({ candidateKey: 'a', videoId: 'abcdefghijk', confidence: .9, matcherVersion: 1, verifiedAt: 100, url: 'https://secret' });
  assert.deepEqual(Object.keys(cache.serialize()[0]).sort(), ['aliasKey', 'candidateKey', 'confidence', 'lastUsedAt', 'matcherVersion', 'verifiedAt', 'videoId']);
});
test('failed video identity can be invalidated without retaining raw sources', () => {
  const cache = new DurableMatchCache({ now: () => 100 });
  cache.set({ candidateKey: 'a', videoId: 'abcdefghijk', confidence: .9, matcherVersion: 1, verifiedAt: 100 });
  assert.equal(cache.invalidateVideoId('abcdefghijk'), true); assert.deepEqual(cache.serialize(), []);
});
test('runtime lease expires and enforces ownership for IPC-side reads', () => {
  let now = 100; const cache = new RuntimeLeaseCache({ now: () => now, randomToken: () => 'x'.repeat(32) });
  const lease = cache.create('abcdefghijk', { url: 'https://r1.googlevideo.com/audio', expiresAt: 200 }, { stationId: 's', queueEntryId: 'q', generation: 1 });
  assert.ok(cache.get(lease.leaseId, { stationId: 's', queueEntryId: 'q', generation: 1 }));
  assert.equal(cache.get(lease.leaseId, { stationId: 's', queueEntryId: 'other', generation: 1 }), null);
  now = 300; assert.equal(cache.get(lease.leaseId), null);
});
test('format choice excludes video/mixed/non-HTTPS sources and prefers M4A', () => {
  const format = chooseAudioFormat({ formats: [{ url: 'http://bad.example/x', acodec: 'aac', vcodec: 'none', ext: 'm4a' }, { url: 'https://r.googlevideo.com/x', acodec: 'opus', vcodec: 'none', ext: 'webm' }, { url: 'https://r.googlevideo.com/y', acodec: 'aac', vcodec: 'none', ext: 'm4a' }] });
  assert.equal(format.url, 'https://r.googlevideo.com/y');
});
test('resolver caches video identity and creates no URL until prepare', async () => {
  let calls = 0; const resolver = createRadioStreamResolver({ runYtdlp: async (args) => { calls++; return args[0].startsWith('ytsearch') ? { entries: [{ id: 'abcdefghijk', title: 'Massive Attack - Teardrop', uploader: 'Massive Attack - Topic', duration: 331 }] } : { formats: [{ url: 'https://r.googlevideo.com/audio?expire=9999999999', acodec: 'aac', vcodec: 'none', ext: 'm4a' }] }; } });
  const candidate = { candidateId: 'x', title: 'Teardrop', artist: 'Massive Attack', duration: 331 };
  const resolved = await resolver.resolveCandidate(candidate, 'one'); assert.equal(resolved.videoId, 'abcdefghijk');
  const prepared = await resolver.prepare(resolved.videoId, { stationId: 's', queueEntryId: 'q', generation: 1 }, 'two');
  assert.match(prepared.src, /^playerinyo-stream:\/\/lease\//); assert.equal(calls, 2);
});
test('high-confidence exact official result short-circuits remaining search variants', async () => {
  let searches = 0;
  const resolver = createRadioStreamResolver({
    runYtdlp: async (args) => {
      searches++;
      assert.match(args[0], /^ytsearch10:/);
      return { entries: [{ id: 'abcdefghijk', title: 'Massive Attack - Teardrop', uploader: 'Massive Attack - Topic', duration: 331 }] };
    },
  });
  const resolved = await resolver.resolveCandidate({ candidateId: 'x', title: 'Teardrop', artist: 'Massive Attack', duration: 331 }, 'one');
  assert.equal(resolved.videoId, 'abcdefghijk');
  assert.equal(searches, 1);
});
test('flat search uses one lightweight subprocess and no detail extraction for a confident match', async () => {
  const calls = [];
  const resolver = createRadioStreamResolver({ runYtdlp: async (args) => { calls.push(args); return { entries: [{ id: 'abcdefghijk', title: 'Massive Attack - Teardrop', uploader: 'Massive Attack - Topic', duration: 331 }] }; } });
  const resolved = await resolver.resolveCandidate({ candidateId: 'x', title: 'Teardrop', artist: 'Massive Attack', duration: 331 }, 'one');
  assert.equal(resolved.metrics.flatSearchCount, 1); assert.equal(resolved.metrics.detailedExtractionCount, 0); assert.equal(calls.length, 1); assert.ok(calls[0].includes('--flat-playlist'));
});
test('ambiguous flat results extract at most two shortlisted videos', async () => {
  const calls = [];
  const resolver = createRadioStreamResolver({ runYtdlp: async (args) => {
    calls.push(args);
    if (args[0].startsWith('ytsearch')) return { entries: [{ id: 'abcdefghijk', title: 'Roads Live', channel: 'Portishead', duration: 307 }, { id: 'zyxwvutsrqp', title: 'Roads Remix', channel: 'Portishead', duration: 307 }, { id: '12345678901', title: 'Roads Cover', channel: 'Portishead', duration: 307 }] };
    return { id: args[0].slice(-11), title: 'Roads Live', channel: 'Portishead', duration: 307 };
  } });
  const resolved = await resolver.resolveCandidate({ candidateId: 'x', title: 'Roads', artist: 'Portishead', duration: 307 }, 'one');
  assert.equal(resolved, null); assert.equal(calls.length, 3); assert.ok(calls.slice(1).every((args) => !args[0].startsWith('ytsearch')));
});
test('durable cache bypasses flat search completely', async () => {
  let calls = 0; const resolver = createRadioStreamResolver({ runYtdlp: async () => { calls++; return { entries: [{ id: 'abcdefghijk', title: 'Massive Attack - Teardrop', uploader: 'Massive Attack - Topic', duration: 331 }] }; } });
  const candidate = { candidateId: 'x', title: 'Teardrop', artist: 'Massive Attack', duration: 331 };
  await resolver.resolveCandidate(candidate, 'one'); const second = await resolver.resolveCandidate(candidate, 'two');
  assert.equal(second.cached, true); assert.equal(second.metrics.flatSearchCount, 0); assert.equal(calls, 1);
});
test('rate limit trips a runtime circuit breaker without caching a negative match', async () => {
  let now = 1000; let calls = 0; const cancelled = [];
  const resolver = createRadioStreamResolver({ now: () => now, cancel: (id) => cancelled.push(id), runYtdlp: async () => { calls++; throw new Error('This content is not available, try again later. Your account has been rate-limited by YouTube for up to an hour.'); } });
  const candidate = { candidateId: 'x', title: 'Teardrop', artist: 'Massive Attack' };
  const first = await resolver.resolveCandidate(candidate, 'one'); const second = await resolver.resolveCandidate({ ...candidate, candidateId: 'y', title: 'Angel' }, 'two');
  assert.equal(first.rateLimited, true); assert.equal(second.rateLimited, true); assert.equal(calls, 1); assert.ok(resolver.getCooldown() > 0); assert.deepEqual(cancelled, []);
  now += 60 * 60 * 1000 + 1; await resolver.resolveCandidate(candidate, 'three'); assert.equal(calls, 2);
});
test('cooldown cleanup is bounded to the retired station runtime', async () => {
  const resolver = createRadioStreamResolver({ runYtdlp: async () => { throw new Error('YouTube rate-limited by YouTube, try again later'); } });
  await resolver.resolveCandidate({ candidateId: 'x', title: 'A', artist: 'B' }, 'one');
  assert.ok(resolver.getCooldown() > 0); resolver.clearCooldown(); assert.equal(resolver.getCooldown(), 0);
});
test('bounded parser accepts yt-dlp newline JSON search output and rejects malformed rows', () => {
  assert.equal(parseSearchPayload('{"id":"abcdefghijk"}\n{"id":"zyxwvutsrqp"}').entries.length, 2);
  assert.throws(() => parseSearchPayload('{bad}'), /malformed resolver data/);
});
test('resolver reports the top candidate rejection without treating it as a subprocess failure', async () => {
  const diagnostics = [];
  const resolver = createRadioStreamResolver({
    runYtdlp: async () => ({ entries: [{ id: 'abcdefghijk', title: 'Roads Live', channel: 'Portishead', duration: 307 }] }),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const resolved = await resolver.resolveCandidate({ candidateId: 'x', title: 'Roads', artist: 'Portishead', duration: 0 }, 'one');
  assert.equal(resolved, null);
  assert.deepEqual(diagnostics, [{
    candidate: { artist: 'Portishead', title: 'Roads', duration: 0 },
    topResult: { title: 'Roads Live', channel: 'Portishead', artist: '', track: '', duration: 307 },
    score: 0,
    reason: 'modifier',
  }]);
});
