'use strict';

// Credentials can change while an HTTP request is in flight. Callers capture
// a token before awaiting and verify it before every stateful action.
function createLastfmSyncGuard() {
  let generation = 0;
  return {
    invalidate() { generation++; return generation; },
    capture(username, apiKey) { return { generation, username: String(username || '').trim(), apiKey: String(apiKey || '').trim() }; },
    isCurrent(token, username, apiKey) {
      return !!token && token.generation === generation
        && token.username === String(username || '').trim()
        && token.apiKey === String(apiKey || '').trim();
    },
    generation() { return generation; },
  };
}

module.exports = { createLastfmSyncGuard };
