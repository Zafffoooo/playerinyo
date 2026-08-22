'use strict';

const HIGH_WATER = 24;
const REFILL_THRESHOLD = 8;
const MAX_CANDIDATES_PER_FILL = 72;
const RESOLVE_CONCURRENCY = 2;

class RadioResolutionController {
  constructor(options) { this.options = options || {}; this.generation = 0; this.cancelled = false; }
  cancel() { this.cancelled = true; this.generation++; if (this.options.cancel) this.options.cancel(); }
  async fill(session, initialItems) {
    const generation = ++this.generation; this.cancelled = false; const playable = []; let candidates = (initialItems || []).slice(); let batches = 1; let exhausted = false; let consumed = 0;
    while (!this.cancelled && generation === this.generation && playable.length < HIGH_WATER && consumed < MAX_CANDIDATES_PER_FILL) {
      if (!candidates.length) {
        if (exhausted || batches >= 3 || !this.options.nextBatch) break;
        const batch = await this.options.nextBatch(session); if (this.cancelled || generation !== this.generation) return [];
        candidates = (batch && batch.items || []).slice(); exhausted = !!(batch && batch.exhausted); batches++;
        if (!candidates.length) continue;
      }
      const window = candidates.splice(0, Math.min(RESOLVE_CONCURRENCY, MAX_CANDIDATES_PER_FILL - consumed)); consumed += window.length;
      const results = await Promise.all(window.map((candidate) => Promise.resolve(this.options.resolve(candidate, session)).catch(() => null)));
      if (this.cancelled || generation !== this.generation) return [];
      results.forEach((track) => { if (track && playable.length < HIGH_WATER) playable.push(track); });
    }
    return playable;
  }
}
module.exports = { HIGH_WATER, REFILL_THRESHOLD, MAX_CANDIDATES_PER_FILL, RESOLVE_CONCURRENCY, RadioResolutionController };
