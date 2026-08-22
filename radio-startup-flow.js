'use strict';

// Small orchestration primitive shared by the renderer startup path and its
// regression tests.  It deliberately stops at the first playable result so a
// slow sibling YouTube lookup cannot hold an already-resolved local track.
async function resolveInitialPlayable(options) {
  options = options || {};
  const max = Math.max(1, Number(options.maxCandidates) || 72);
  let consumed = 0;
  while (consumed < max) {
    const item = await options.nextItem();
    if (!item) break;
    consumed++;
    if (typeof options.onConsumed === 'function') options.onConsumed(item, consumed);
    const track = await options.resolve(item);
    if (track) return { track, consumed };
  }
  return { track: null, consumed };
}

const radioStartupFlowApi = { resolveInitialPlayable };
if (typeof module !== 'undefined' && module.exports) module.exports = radioStartupFlowApi;
if (typeof window !== 'undefined') window.RadioStartupFlow = radioStartupFlowApi;
