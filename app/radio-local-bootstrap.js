'use strict';
function findFirstLocalCandidate(items, matchLocal, library, options) {
  for (let index = 0; index < (items || []).length; index++) {
    const item = items[index];
    if (!item || item.itemKind !== 'candidate' || typeof matchLocal !== 'function') continue;
    const candidate = { candidateId: item.id || item.candidateId, trackMbid: item.trackMbid || item.recordingMbid || item.mbid || '', title: item.title || '', artist: item.artist || '', album: item.album || '', duration: Number(item.duration) || 0 };
    const file = matchLocal(candidate, library || [], options || {});
    if (file) return { index, item, file };
  }
  return null;
}
var radioLocalBootstrapApi = { findFirstLocalCandidate };
if (typeof module !== 'undefined' && module.exports) module.exports = radioLocalBootstrapApi;
if (typeof window !== 'undefined') window.RadioLocalBootstrap = radioLocalBootstrapApi;
