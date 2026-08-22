(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RadioDiscoveryBias = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  function consume(session, acceptedCount) {
    if (!session || !session.discoveryBias) return null;
    var remaining = Math.max(0, Number(session.discoveryBias.remainingSelections) || 0);
    remaining = Math.max(0, remaining - Math.max(0, Number(acceptedCount) || 0));
    session.discoveryBias.remainingSelections = remaining;
    session.discoveryBias.strength = Math.max(0, Math.min(1, remaining / 10));
    if (!remaining) session.discoveryBias = null;
    return session.discoveryBias;
  }

  return { consume: consume };
});
