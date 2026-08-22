'use strict';

function registerRequest(session, requestId, scope) {
  if (!session || !requestId) return;
  if (!session.resolverRequestIds) session.resolverRequestIds = new Set();
  if (!session.fillRequestIds) session.fillRequestIds = new Set();
  if (!session.transitionRequestIds) session.transitionRequestIds = new Set();
  session.resolverRequestIds.add(requestId);
  (scope === 'transition' ? session.transitionRequestIds : session.fillRequestIds).add(requestId);
}
function unregisterRequest(session, requestId, scope) {
  if (!session || !requestId) return;
  if (session.resolverRequestIds) session.resolverRequestIds.delete(requestId);
  var set = scope === 'transition' ? session.transitionRequestIds : session.fillRequestIds;
  if (set) set.delete(requestId);
}
function cancelRequests(session, scope, cancel) {
  if (!session) return [];
  var sets = scope === 'transition' ? [session.transitionRequestIds]
    : scope === 'fill' ? [session.fillRequestIds]
      : [session.fillRequestIds, session.transitionRequestIds, session.resolverRequestIds];
  var ids = new Set();
  sets.forEach(function (set) { if (set) set.forEach(function (id) { ids.add(id); }); });
  ids.forEach(function (id) { if (typeof cancel === 'function') cancel(id); });
  sets.forEach(function (set) { if (set) set.clear(); });
  if (scope && session.resolverRequestIds) ids.forEach(function (id) { session.resolverRequestIds.delete(id); });
  return Array.from(ids);
}

var radioResolverOwnershipApi = { registerRequest, unregisterRequest, cancelRequests };
if (typeof module !== 'undefined' && module.exports) module.exports = radioResolverOwnershipApi;
if (typeof window !== 'undefined') window.RadioResolverOwnership = radioResolverOwnershipApi;
