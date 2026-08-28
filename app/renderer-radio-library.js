function trackMatchesRadioContext(track, context) {
  var sourceRadio = normalizeSourceRadio(track && track.sourceRadio);
  if (!sourceRadio || !context || sourceRadio.providerId !== context.providerId || sourceRadio.genreIds.length !== context.genreIds.length) return false;
  return sourceRadio.genreIds.every(function (genre, index) { return genre === context.genreIds[index]; });
}

function markRadioTracksForSession(tracks, context, session) {
  (tracks || []).forEach(function (track) {
    if (trackMatchesRadioContext(track, context)) track.radioSessionId = session.stationId;
  });
}

function getActiveRadioSequence() {
  return state.isShuffle ? state.shuffleQueue : state.playQueueTracks;
}

function getRemainingRadioTrackCount(session) {
  if (!session) return 0;
  var sequence = getActiveRadioSequence();
  var cursor = state.isShuffle ? state.shuffleQueueCursor : state.playQueueCursor;
  var cursorIndex = findTrackIndexByIdentity(sequence, cursor);
  var currentIndex = sequence.indexOf(state.currentPlayingTrack);
  if (currentIndex !== -1 && state.currentPlayingTrack && state.currentPlayingTrack.radioSessionId === session.stationId) cursorIndex = currentIndex;
  var start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  return sequence.slice(start).filter(function (track) { return !track.isDisabled && track.radioSessionId === session.stationId; }).length;
}

function rememberPlayedRadioTrack(session, track) {
  if (!session || !track || track.radioSessionId !== session.stationId) return;
  if (!session.playedTracks) session.playedTracks = [];
  session.playedTracks = window.RadioQueueHelpers && window.RadioQueueHelpers.appendPlayedRadioTrack
    ? window.RadioQueueHelpers.appendPlayedRadioTrack(session.playedTracks, Object.assign({}, track), 100)
    : session.playedTracks.concat([Object.assign({}, track)]).slice(-100);
}

function canAppendRadioPlayable(session) {
  return getRemainingRadioTrackCount(session) < RADIO_PLAYABLE_HARD_CAP;
}

async function resolveRadioBatch(session, result, limit, onResolved) {
  var items = (result && result.items || []).slice(0, limit || RADIO_FILL_CANDIDATE_LIMIT);
  var tracks = new Array(items.length);
  for (var offset = 0; offset < items.length; offset += 2) {
    var settled = await Promise.all(items.slice(offset, offset + 2).map(async function (item) {
      var track = await resolveRadioItemToPlaybackTrack(item, session);
      if (track && typeof onResolved === 'function') onResolved(track);
      return track;
    }));
    settled.forEach(function (track, index) { tracks[offset + index] = track; });
    if (!isCurrentRadioSession(session, session.stationId) && !isCurrentRadioStart(session.stationId)) return [];
  }
  return tracks.filter(Boolean);
}

async function appendRadioBatch(session, result) {
  var appended = 0;
  var tracks = await resolveRadioBatch(session, result, RADIO_FILL_CANDIDATE_LIMIT, function (track) {
    if (!isCurrentRadioSession(session, session.stationId)) return;
    // Resolution is concurrent in pairs.  The append boundary is the hard
    // limit, so a late result cannot grow the active Radio tail without bound.
    var ahead = getRemainingRadioTrackCount(session);
    var mayAppend = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldAppendProviderRadioTrack
      ? window.RadioQueueHelpers.shouldAppendProviderRadioTrack(ahead, RADIO_PLAYABLE_HIGH_WATER, RADIO_PLAYABLE_HARD_CAP)
      : ahead < RADIO_PLAYABLE_HIGH_WATER && ahead < RADIO_PLAYABLE_HARD_CAP;
    if (!mayAppend || !canAppendRadioPlayable(session)) return;
    if (window.RadioQueueHelpers && window.RadioQueueHelpers.appendRadioTracksToQueues) {
      window.RadioQueueHelpers.appendRadioTracksToQueues(state.playQueueTracks, state.shuffleQueue, [track], state.isShuffle);
    } else {
      state.playQueueTracks.push(track);
      if (state.isShuffle) state.shuffleQueue.push(track);
    }
    appended++;
    session.trackCount = (session.trackCount || 0) + 1;
    prepareNextRadioTrack();
    scheduleQueueRefresh();
    var pending = session.awaitingNextPlayable;
    if (pending && pending.generation === playbackGeneration) {
      session.awaitingNextPlayable = null;
      playNextTrack({ automaticAdvance: pending.reason !== 'manual-next', waitedForRadioRefill: true });
    }
  });
  if (!tracks.length) {
    if (result && result.providerSession) session.providerSession = result.providerSession;
    return 0;
  }
  session.providerSession = result.providerSession;
  return appended;
}

function maybeRefillRadioQueue(options) {
  options = options || {};
  var session = state.radioSession;
  if (!session || session.starting || session.refillPromise) return session && session.refillPromise;
  if (session.refillError && !options.retry) return null;
  if (!options.force && getRemainingRadioTrackCount(session) >= RADIO_REFILL_THRESHOLD) return null;
  var provider = session.provider;
  if (!provider || !provider.nextBatch) return null;
  var stationId = session.stationId;
  session.refillError = '';
  var refillPromise = Promise.resolve().then(async function () {
    var consumed = 0; var appended = 0; var result = null;
    while (consumed < RADIO_FILL_CANDIDATE_LIMIT && getRemainingRadioTrackCount(session) < RADIO_PLAYABLE_HIGH_WATER && canAppendRadioPlayable(session)) {
      if (session.candidateBacklog && session.candidateBacklog.length) {
        result = { items: session.candidateBacklog.splice(0, Math.min(24, RADIO_FILL_CANDIDATE_LIMIT - consumed)), providerSession: session.providerSession, exhausted: false };
      } else {
        result = await provider.nextBatch(session.providerSession, Object.assign({ genreIds: session.genreIds.slice() }, getRadioDiscoveryOptions(session)), getRadioProviderContext());
      }
      if (!isCurrentRadioSession(session, stationId)) return { appended: 0, result: result };
      consumed += (result && result.items || []).length;
      var accepted = await appendRadioBatch(session, result || {});
      appended += accepted;
      consumeRadioDiscoveryBias(session, accepted);
      if (!result || result.exhausted || !(result.items || []).length) break;
    }
    return { appended: appended, result: result };
  });
  session.refillPromise = refillPromise;
  refillPromise.then(function (fill) {
    if (!isCurrentRadioSession(session, stationId)) return;
    var appended = fill && fill.appended || 0;
    var result = fill && fill.result;
    if (!appended) {
      var shouldCheckpoint = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldCheckpointEmptyRadioRefill
        ? window.RadioQueueHelpers.shouldCheckpointEmptyRadioRefill(result && result.providerSession, appended)
        : !!(result && result.providerSession);
      if (shouldCheckpoint) {
        syncSavedQueuePaths();
        saveSettingsDebounced(300);
      }
      session.refillError = session.youtubeRateLimited ? 'YouTube is temporarily rate limited. Local/cached radio will continue.' : 'No playable tracks are available for this radio station.';
      return;
    }
    syncSavedQueuePaths();
    saveSettingsDebounced(300);
    if (isQueueOpen) renderQueue();
  }).catch(function (error) {
    if (!isCurrentRadioSession(session, stationId)) return;
    console.error('Could not refill radio:', error);
    session.refillError = 'Radio could not load more tracks. Try again while the current queue keeps playing.';
  }).finally(function () {
    if (!isCurrentRadioSession(session, stationId) || session.refillPromise !== refillPromise) return;
    session.refillPromise = null;
    if (state.currentView === 'radio') renderRadioView();
  });
  if (state.currentView === 'radio') renderRadioView();
  return refillPromise;
}

function retryRadioRefill() {
  maybeRefillRadioQueue({ force: true, retry: true });
}

function restoreRadioSessionFromContext(value) {
  var context = value && typeof value === 'object' ? value : null;
  var sourceRadio = normalizeSourceRadio(context);
  var providerSession = normalizeRadioProviderSession(context && context.providerSession, sourceRadio && sourceRadio.genreIds, sourceRadio && sourceRadio.providerId);
  var provider = sourceRadio && getRadioProvider(sourceRadio.providerId);
  if (!sourceRadio || !provider || !providerSession) return null;
  var session = { stationId: createRadioStationId(), providerId: sourceRadio.providerId, provider: provider, providerSession: providerSession, genreIds: sourceRadio.genreIds, trackCount: 0, refillPromise: null, refillError: '', restored: true, resolverRequestIds: new Set(), fillRequestIds: new Set(), transitionRequestIds: new Set(), candidateBacklog: [], playedTracks: Array.isArray(context.playedTracks) ? context.playedTracks.map(hydrateTrackRef).filter(Boolean).slice(-100) : [] };
  markRadioTracksForSession(state.playQueueTracks, sourceRadio, session);
  markRadioTracksForSession(state.shuffleQueue, sourceRadio, session);
  markRadioTracksForSession(state.currentTracks, sourceRadio, session);
  if (trackMatchesRadioContext(state.currentPlayingTrack, sourceRadio)) state.currentPlayingTrack.radioSessionId = session.stationId;
  var hasRadioTrack = state.playQueueTracks.concat(state.shuffleQueue).some(function (track) { return track.radioSessionId === session.stationId; });
  if (!hasRadioTrack) return null;
  session.trackCount = state.playQueueTracks.filter(function (track) { return track.radioSessionId === session.stationId; }).length;
  state.radioSession = session;
  radioUiState.providerId = sourceRadio.providerId;
  return session;
}

function radioElement(tag, className, text) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function blockRadioTrack(track) {
  if (!window.RadioPreferences) return;
  var entry = window.RadioPreferences.radioDisplayTrack(track); if (!entry.key) return;
  var list = getRadioBlocklist(); if (!list.tracks.some(function (item) { return item.key === entry.key; })) list.tracks.push(entry);
  appSettings.radioBlocklist = list; var removed = removeBlockedRadioQueueEntries(); persistRadioPersonalization(); showToast('Blocked from Radio: ' + (entry.title || 'track') + (removed ? '. Removed ' + removed + ' queued track' + (removed === 1 ? '' : 's') + '.' : '.'));
  if (state.currentView === 'radio') renderRadioView();
}
function blockRadioArtist(track) {
  if (!window.RadioPreferences) return;
  var entry = window.RadioPreferences.radioDisplayArtist(track); if (!entry.key) return;
  var list = getRadioBlocklist(); if (!list.artists.some(function (item) { return item.key === entry.key; })) list.artists.push(entry);
  appSettings.radioBlocklist = list; var removed = removeBlockedRadioQueueEntries(); persistRadioPersonalization(); showToast('Blocked from Radio: ' + (entry.artist || 'artist') + (removed ? '. Removed ' + removed + ' queued track' + (removed === 1 ? '' : 's') + '.' : '.'));
  if (state.currentView === 'radio') renderRadioView();
}
function addManualRadioBlock(kind, artist, title) {
  if (!window.RadioPreferences) return;
  var source = { artist: String(artist || '').trim(), title: String(title || '').trim() };
  var entry = kind === 'track' ? window.RadioPreferences.radioDisplayTrack(source) : window.RadioPreferences.radioDisplayArtist(source);
  if (!entry.key) { showToast(kind === 'track' ? 'Enter both artist and track.' : 'Enter an artist name.'); return; }
  var list = getRadioBlocklist(); var bucket = kind === 'track' ? 'tracks' : 'artists';
  if (list[bucket].some(function (item) { return item.key === entry.key; })) { showToast('Already blocked from Radio.'); return; }
  list[bucket].push(entry);
  appSettings.radioBlocklist = list;
  var removed = removeBlockedRadioQueueEntries();
  persistRadioPersonalization();
  showToast('Blocked from Radio: ' + (kind === 'track' ? entry.title : entry.artist) + (removed ? '. Removed ' + removed + ' queued track' + (removed === 1 ? '' : 's') + '.' : '.'));
  renderRadioView();
}

function removeBlockedRadioQueueEntries() {
  if (!window.RadioPreferences) return 0;
  var removed = 0;
  function blocked(track) {
    if (!track || !(track.radioSessionId || track.sourceRadio)) return false;
    var result = isRadioCandidateBlocked(track);
    return !!(result.track || result.artist);
  }
  var removedIds = new Set();
  ['playQueueTracks', 'shuffleQueue', 'userQueue'].forEach(function (key) {
    state[key] = state[key].filter(function (track) {
      if (!blocked(track)) return true;
      removed++;
      if (track.queueEntryId) removedIds.add(track.queueEntryId);
      return false;
    });
  });
  if (state.playQueueCursor && blocked(state.playQueueCursor)) state.playQueueCursor = null;
  if (state.shuffleQueueCursor && blocked(state.shuffleQueueCursor)) state.shuffleQueueCursor = null;
  if (preparedRadioSlot && removedIds.has(preparedRadioSlot.queueEntryId)) clearPreparedRadioSlot(true);
  if (removed) {
    syncSavedQueuePaths();
    persistInBackground(persistSettings(appSettings));
    scheduleQueueRefresh();
    maybeRefillRadioQueue();
  }
  return removed;
}
function renderRadioRules() {
  var details = radioElement('details', 'radio-rules');
  details.appendChild(radioElement('summary', '', 'Discovery Rules'));
  var body = radioElement('div', 'radio-rules-body');
  var prefs = getRadioPreferences();
  var depth = radioElement('label', 'radio-depth-control');
  depth.appendChild(radioElement('span', 'radio-depth-label', 'Discovery depth'));
  var depthEnds = radioElement('div', 'radio-depth-ends'); depthEnds.append(radioElement('span', '', 'Essentials'), radioElement('span', '', 'Deep Cuts'));
  var range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '0.1'; range.value = String(prefs.discoveryDepth); range.setAttribute('aria-label', 'Discovery depth: Essentials to Deep Cuts');
  range.addEventListener('input', function () { var next = getRadioPreferences(); next.discoveryDepth = Number(range.value); appSettings.radioPreferences = next; persistRadioPersonalization(); });
  depth.append(depthEnds, range, radioElement('small', 'radio-rule-scope', state.radioSession ? 'Applies to the next discovery batch' : 'Used when a station starts'));
  body.appendChild(depth);
  [['excludeKnownTracks', 'Skip previously heard tracks'], ['avoidClean', 'Avoid clean / censored versions'], ['avoidLive', 'Avoid live versions'], ['avoidCovers', 'Avoid covers'], ['avoidRemixes', 'Avoid remixes'], ['avoidSlowedSped', 'Avoid slowed / sped-up versions']].forEach(function (row) {
    var label = radioElement('label', 'radio-rule-toggle'); var input = document.createElement('input'); input.type = 'checkbox'; input.checked = prefs[row[0]] === true;
    input.addEventListener('change', function () {
      var next = getRadioPreferences(); next[row[0]] = input.checked; appSettings.radioPreferences = next;
      if (row[0] === 'excludeKnownTracks' && state.radioSession && state.radioSession.providerId === 'lastfm' && state.radioSession.providerSession) {
        state.radioSession.providerSession = Object.assign({}, state.radioSession.providerSession, { excludeKnownTracks: next.excludeKnownTracks === true });
        maybeRefillRadioQueue({ force: true });
      }
      persistRadioPersonalization();
    });
    var copy = radioElement('span', 'radio-rule-copy');
    copy.append(radioElement('span', '', row[1]));
    var scope = row[0] === 'excludeKnownTracks' && state.radioSession && state.radioSession.providerId === 'lastfm'
      ? 'Current station'
      : (state.radioSession ? 'Next resolution' : 'New stations');
    copy.appendChild(radioElement('small', 'radio-rule-scope', scope));
    label.append(input, copy); body.appendChild(label);
  });
  var manual = radioElement('div', 'radio-manual-block');
  manual.appendChild(radioElement('h3', '', 'Manual blocklist'));
  var artistInput = document.createElement('input'); artistInput.type = 'text'; artistInput.placeholder = 'Artist'; artistInput.setAttribute('aria-label', 'Artist to block from Radio');
  var titleInput = document.createElement('input'); titleInput.type = 'text'; titleInput.placeholder = 'Track (optional)'; titleInput.setAttribute('aria-label', 'Track to block from Radio');
  var addButton = radioElement('button', 'btn btn-outline', 'Block'); addButton.type = 'button';
  addButton.addEventListener('click', function () { addManualRadioBlock(titleInput.value.trim() ? 'track' : 'artist', artistInput.value, titleInput.value); });
  manual.append(artistInput, titleInput, addButton); body.appendChild(manual);
  var list = getRadioBlocklist(); var manage = radioElement('details', 'radio-blocked-manager');
  manage.appendChild(radioElement('summary', '', 'Blocked: ' + list.tracks.length + ' tracks · ' + list.artists.length + ' artists'));
  var managerBody = radioElement('div', 'radio-blocked-body');
  var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search blocked artists and tracks'; search.className = 'radio-blocked-search'; search.setAttribute('aria-label', 'Search blocked Radio entries'); managerBody.appendChild(search);
  var refreshBlocked = function () {
    Array.from(managerBody.querySelectorAll('.radio-blocked-section')).forEach(function (node) { node.remove(); });
    var query = String(search.value || '').trim().toLocaleLowerCase();
    [['tracks', 'Blocked Tracks', function (item) { return (item.artist || 'Unknown Artist') + ' — ' + (item.title || 'Unknown Track'); }], ['artists', 'Blocked Artists', function (item) { return item.artist || 'Unknown Artist'; }]].forEach(function (section) {
      var sectionEl = radioElement('section', 'radio-blocked-section'); sectionEl.appendChild(radioElement('h3', '', section[1]));
      var items = list[section[0]].filter(function (item) { return !query || section[2](item).toLocaleLowerCase().includes(query); });
      if (!items.length) sectionEl.appendChild(radioElement('p', 'radio-blocked-empty', query ? 'No matches.' : 'Nothing blocked.'));
      items.forEach(function (item) { var row = radioElement('div', 'radio-blocked-row'); row.appendChild(radioElement('span', '', section[2](item))); var remove = radioElement('button', 'btn btn-outline', 'Unban'); remove.type = 'button'; remove.addEventListener('click', function () { list[section[0]] = list[section[0]].filter(function (entry) { return entry.key !== item.key; }); appSettings.radioBlocklist = list; persistRadioPersonalization(); renderRadioView(); }); row.appendChild(remove); sectionEl.appendChild(row); });
      managerBody.appendChild(sectionEl);
    });
  };
  search.addEventListener('input', refreshBlocked);
  refreshBlocked();
  manage.appendChild(managerBody); body.appendChild(manage); details.appendChild(body); return details;
}

function renderRadioView() {
  var container = $('radio-container');
  if (!container) return;
  var provider = getRadioProvider(radioUiState.providerId);
  container.replaceChildren();
  var header = radioElement('header', 'radio-view-header');
  var title = radioElement('h1', '', 'Radio'); title.id = 'radio-title';
  var subtitle = radioElement('p', 'radio-subtitle', provider && provider.id === 'lastfm' ? 'Discover genre-based candidates through Last.fm, then play only verified local or YouTube matches.' : 'Choose one genre and begin a local station from your collection.');
  header.append(title, subtitle);
  container.appendChild(header);

  if (!provider) {
    container.appendChild(radioElement('p', 'radio-state radio-state-error', 'Radio provider is unavailable.'));
    return;
  }
  if (provider && provider.id === 'local-library' && !state.musicFiles.length) {
    container.appendChild(radioElement('p', 'radio-state', 'Your library is empty. Import music to start a radio station.'));
    return;
  }

  var controlBar = radioElement('div', 'radio-control-bar');
  var providerPanel = radioElement('div', 'radio-provider-panel');
  providerPanel.appendChild(radioElement('span', 'radio-field-label', 'PROVIDER'));
  var providerPicker = radioElement('div', 'radio-provider-picker');
  (radioProviderRegistry ? radioProviderRegistry.list() : []).forEach(function (candidateProvider) {
    var button = radioElement('button', 'btn btn-outline radio-provider-choice', candidateProvider.label);
    button.type = 'button'; button.classList.toggle('active', candidateProvider.id === radioUiState.providerId);
    button.disabled = !!state.radioSession || radioUiState.starting;
    button.addEventListener('click', function () {
      radioUiState.providerId = candidateProvider.id; radioUiState.loaded = false; radioUiState.genres = []; radioUiState.selectedGenreId = ''; radioUiState.error = ''; renderRadioView(); loadRadioGenres(true);
    });
    providerPicker.appendChild(button);
  });
  providerPanel.appendChild(providerPicker);
  controlBar.appendChild(providerPanel);
  if (state.radioSession) {
    var activeGenre = radioUiState.genres.find(function (genre) { return genre.id === state.radioSession.genreIds[0]; });
    var stationActions = radioElement('div', 'radio-station-actions');
    var summary = radioElement('div', 'radio-station-summary');
    var summaryText = (activeGenre ? activeGenre.label : state.radioSession.genreIds[0]) + ' · ' + getRemainingRadioTrackCount(state.radioSession) + ' tracks remaining · ' + ((state.radioSession.playedTracks || []).length) + ' played';
    if (state.radioSession.refillPromise) summaryText += ' · loading more';
    summary.append(radioElement('span', 'radio-field-label', 'ACTIVE STATION'), radioElement('strong', '', summaryText));
    var viewQueueButton = radioElement('button', 'btn ghost radio-view-queue', 'View Queue');
    viewQueueButton.type = 'button';
    viewQueueButton.addEventListener('click', function () { setQueueOpen(true); });
    summary.appendChild(viewQueueButton);
    stationActions.appendChild(summary);
    var activeStopButton = radioElement('button', 'btn btn-outline radio-stop-button', 'Stop Radio');
    activeStopButton.type = 'button'; activeStopButton.addEventListener('click', stopRadioStation);
    stationActions.appendChild(activeStopButton);
    controlBar.appendChild(stationActions);
  } else {
    var stopButton = radioElement('button', 'btn btn-outline radio-stop-button', radioUiState.starting ? 'Cancel Start' : 'Stop Radio');
    stopButton.type = 'button'; stopButton.disabled = !radioUiState.starting;
    stopButton.addEventListener('click', stopRadioStation);
    controlBar.appendChild(stopButton);
  }
  container.appendChild(controlBar);

  if (radioUiState.preparation) container.appendChild(radioElement('p', 'radio-preparation-state', radioUiState.preparation));
  if (provider.id === 'lastfm') container.appendChild(renderRadioRules());
  if (state.radioSession && state.radioSession.discoveryBias) {
    var bias = state.radioSession.discoveryBias; var biasNote = radioElement('div', 'radio-bias-note');
    biasNote.append(radioElement('span', '', 'More like: ' + bias.seedTrack.artist + ' — ' + bias.seedTrack.title + ' · ' + bias.remainingSelections + ' selections remaining'));
    var clearBias = radioElement('button', 'btn ghost', 'Clear'); clearBias.type = 'button'; clearBias.addEventListener('click', clearMoreLikeThis); biasNote.appendChild(clearBias); container.appendChild(biasNote);
  }

  if (state.radioSession && state.radioSession.refillError) {
    var refillState = radioElement('div', 'radio-refill-error');
    refillState.appendChild(radioElement('span', '', state.radioSession.refillError));
    var retryRefill = radioElement('button', 'btn btn-outline', state.radioSession.refillPromise ? 'Retrying…' : 'Retry');
    retryRefill.type = 'button'; retryRefill.disabled = !!state.radioSession.refillPromise;
    retryRefill.addEventListener('click', retryRadioRefill);
    refillState.appendChild(retryRefill); container.appendChild(refillState);
  }

  if (radioUiState.loading) {
    container.appendChild(radioElement('p', 'radio-state', 'Loading genres…'));
    return;
  }
  if (radioUiState.error) {
    var errorState = radioElement('div', 'radio-state radio-state-error');
    errorState.appendChild(radioElement('span', '', radioUiState.error));
    var retry = radioElement('button', 'btn btn-outline', 'Retry'); retry.type = 'button'; retry.addEventListener('click', function () { loadRadioGenres(true); });
    errorState.appendChild(retry); container.appendChild(errorState);
    return;
  }
  if (!radioUiState.genres.length) {
    container.appendChild(radioElement('p', 'radio-state', 'No tagged genres are available in this library yet. Add genre metadata to start radio.'));
    return;
  }

  var picker = radioElement('section', 'radio-genre-picker');
  picker.appendChild(radioElement('h2', '', 'Choose a genre'));
  var search = radioElement('input', 'radio-genre-search');
  search.type = 'search'; search.placeholder = 'Search genres'; search.value = radioUiState.search; search.setAttribute('aria-label', 'Search genres');
  search.addEventListener('input', function () {
    var selectionStart = search.selectionStart;
    var selectionEnd = search.selectionEnd;
    radioUiState.search = search.value;
    renderRadioView();
    var nextSearch = container.querySelector('.radio-genre-search');
    if (!nextSearch) return;
    nextSearch.focus({ preventScroll: true });
    nextSearch.setSelectionRange(selectionStart, selectionEnd);
  });
  picker.appendChild(search);
  var list = radioElement('div', 'radio-genre-list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Genres');
  var query = radioUiState.search.trim();
  var visibleGenres = provider.id === 'lastfm' && window.RadioProviders && window.RadioProviders.searchLastfmGenreCatalog
    ? window.RadioProviders.searchLastfmGenreCatalog(query)
    : radioUiState.genres.filter(function (genre) { return !query || genre.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()); });
  if (!visibleGenres.length) list.appendChild(radioElement('p', 'radio-genre-empty', 'No genres match this search.'));
  visibleGenres.forEach(function (genre) {
    var button = radioElement('button', 'radio-genre-option'); button.type = 'button'; button.setAttribute('role', 'option');
    var selected = radioUiState.selectedGenreId === genre.id;
    button.classList.toggle('selected', selected); button.setAttribute('aria-selected', String(selected));
    button.appendChild(radioElement('span', '', genre.label));
    if (Number.isFinite(genre.trackCount) && genre.trackCount >= 0) button.appendChild(radioElement('small', '', String(genre.trackCount)));
    button.addEventListener('click', function () { radioUiState.selectedGenreId = genre.id; renderRadioView(); });
    list.appendChild(button);
  });
  picker.appendChild(list); container.appendChild(picker);
  var activeGenreId = state.radioSession && state.radioSession.providerId === provider.id ? state.radioSession.genreIds[0] : '';
  var sameAsActive = radioGenreIdsMatch(provider.id, activeGenreId, radioUiState.selectedGenreId);
  var startLabel = radioUiState.starting ? 'Starting Radio…' : state.radioSession ? (sameAsActive ? 'Current Station' : 'Start New Station') : 'Start Radio';
  var start = radioElement('button', 'btn btn-primary radio-start-button', startLabel);
  start.type = 'button'; start.disabled = !radioUiState.selectedGenreId || sameAsActive || radioUiState.starting;
  if (sameAsActive) start.setAttribute('aria-describedby', 'radio-active-station-note');
  start.addEventListener('click', startRadioStation); container.appendChild(start);
  if (sameAsActive) {
    var activeNote = radioElement('p', 'radio-active-station-note', 'This genre is already playing. Choose another genre to start a new station.');
    activeNote.id = 'radio-active-station-note'; container.appendChild(activeNote);
  }
}

async function loadRadioGenres(force) {
  if (radioUiState.loading || (radioUiState.loaded && !force)) return;
  var provider = getRadioProvider();
  if (!provider) return;
  radioUiState.loading = true; radioUiState.error = ''; renderRadioView();
  try {
    radioUiState.genres = await provider.listGenres(getRadioProviderContext());
    radioUiState.loaded = true;
    if (radioUiState.selectedGenreId && !radioUiState.genres.some(function (genre) { return genre.id === radioUiState.selectedGenreId; })) radioUiState.selectedGenreId = '';
  } catch (error) {
    console.error('Could not load radio genres:', error); radioUiState.error = 'Genres could not be loaded.';
  } finally {
    radioUiState.loading = false; renderRadioView();
  }
}

async function startRadioStation() {
  var provider = getRadioProvider();
  if (!provider || !radioUiState.selectedGenreId) return;
  if (radioUiState.starting) cancelPendingRadioStart();
  radioUiState.starting = true; radioUiState.error = ''; renderRadioView();
  disposeRadioSession();
  radioUiState.starting = true;
  var session = { stationId: createRadioStationId(), providerId: provider.id, provider: provider, providerSession: null, genreIds: [radioUiState.selectedGenreId], trackCount: 0, refillPromise: null, refillError: '', starting: true, resolverRequestIds: new Set(), fillRequestIds: new Set(), transitionRequestIds: new Set(), candidateBacklog: [], playedTracks: [], radioDebug: { candidateLogged: 0, candidatesReceived: 0, candidatesConsumed: 0, localMatches: 0, youtubeSearches: 0, youtubeAccepted: 0, rejected: 0 } };
  pendingRadioStartSession = session;
  var stationId = session.stationId;
  radioUiState.startingStationId = stationId;
  try {
    var result = await provider.startStation({ genreIds: [radioUiState.selectedGenreId], stationId: stationId, excludeKnownTracks: getRadioPreferences().excludeKnownTracks === true, discoveryDepth: getRadioPreferences().discoveryDepth }, getRadioProviderContext());
    // A Start action has already atomically disposed any restored/old session.
    // Do not reject its own result merely because a prior radio context existed.
    if (!isCurrentRadioStart(stationId)) {
      disposeRadioProviderSession(provider, result && result.providerSession);
      return;
    }
    session.providerSession = result.providerSession;
    var tracks = [];
    var batches = 1;
    session.candidateBacklog.push.apply(session.candidateBacklog, result && result.items || []);
    session.radioDebug.candidatesReceived += (result && result.items || []).length;
    radioDebug('resolution-start', { stationId: stationId, candidateBacklogSize: session.candidateBacklog.length });
    // Scan the provider-selected batch locally before any remote work. This
    // keeps Last.fm ordering/tiering intact while avoiding needless yt-dlp
    // startup when a later discovery candidate is already in the library.
    var bootstrap = window.RadioLocalBootstrap && window.RadioLocalBootstrap.findFirstLocalCandidate
      ? window.RadioLocalBootstrap.findFirstLocalCandidate(session.candidateBacklog, window.LocalTrackMatcher.matchLocalTrack, state.musicFiles, { unplayableFilePaths: libraryMissingFilePaths })
      : null;
    if (bootstrap) {
      session.candidateBacklog.splice(bootstrap.index, 1);
      session.radioDebug.candidatesConsumed++;
      var bootstrapTrack = await resolveRadioItemToPlaybackTrack(bootstrap.item, session);
      if (bootstrapTrack && isCurrentRadioStart(stationId)) tracks.push(bootstrapTrack);
    }
    var startupFlow = window.RadioStartupFlow && window.RadioStartupFlow.resolveInitialPlayable;
    if (!startupFlow) throw new Error('Radio startup resolver is unavailable.');
    var initial = tracks.length ? { track: null } : await startupFlow({
      maxCandidates: RADIO_FILL_CANDIDATE_LIMIT,
      nextItem: async function () {
        while (!session.candidateBacklog.length && result && !result.exhausted && batches < 3) {
          result = await provider.nextBatch(session.providerSession, { genreIds: session.genreIds.slice() }, getRadioProviderContext());
          session.providerSession = result && result.providerSession;
          session.candidateBacklog.push.apply(session.candidateBacklog, result && result.items || []);
          session.radioDebug.candidatesReceived += (result && result.items || []).length;
          batches++;
        }
        return session.candidateBacklog.shift() || null;
      },
      onConsumed: function () { session.radioDebug.candidatesConsumed++; },
      resolve: async function (item) {
        var track = await resolveRadioItemToPlaybackTrack(item, session);
        return isCurrentRadioStart(stationId) ? track : null;
      }
    });
    if (!isCurrentRadioStart(stationId)) return;
    if (initial.track) tracks.push(initial.track);
    var shouldDisposeUnplayable = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldDisposeUnplayableRadioStart
      ? window.RadioQueueHelpers.shouldDisposeUnplayableRadioStart(session.providerSession, tracks.length)
      : !tracks.length && !!session.providerSession;
    if (!tracks.length) {
      if (shouldDisposeUnplayable) disposeRadioProviderSession(provider, session.providerSession);
      session.providerSession = null;
      if (session.youtubeRateLimited) throw new Error('YouTube is temporarily rate limited. Local/cached radio will continue when available.');
      throw new Error('No playable tracks were found for this genre.');
    }
    // Commit the first resolved track before playback.  The remaining backlog
    // is resolved by the existing refill path after play starts.
    session.trackCount = tracks.length;
    state.playQueueTracks = tracks;
    state.currentTracks = tracks.slice();
    state.shuffleQueue = [];
    if (state.isShuffle) rebuildShuffleQueueForMode();
    state.radioSession = session;
    session.starting = false;
    if (pendingRadioStartSession === session) pendingRadioStartSession = null;
    if (radioUiState.startingStationId === stationId) {
      radioUiState.starting = false;
      radioUiState.startingStationId = '';
    }
    initAudioCtx();
    var first = state.isShuffle ? state.shuffleQueue[0] : tracks[0];
    if (!await playTrack(first, { preserveRadioSession: true })) throw new Error('The first radio track could not be played.');
  } catch (error) {
    if (isCurrentRadioSession(session, stationId) || isCurrentRadioStart(stationId)) {
      console.error('Could not start radio:', error);
      if (isCurrentRadioSession(session, stationId)) disposeRadioSession();
      radioUiState.error = error.message || 'Radio could not be started.';
    }
  } finally {
    radioDebug('fill-summary', { stationId: stationId, candidatesReceived: session.radioDebug.candidatesReceived, candidatesConsumed: session.radioDebug.candidatesConsumed, localMatches: session.radioDebug.localMatches, youtubeSearches: session.radioDebug.youtubeSearches, youtubeAccepted: session.radioDebug.youtubeAccepted, rejected: session.radioDebug.rejected, playableCount: tracks && tracks.length || 0, providerExhausted: !!(result && result.exhausted), reason: tracks && tracks.length ? '' : 'No playable tracks' });
    if (pendingRadioStartSession === session) pendingRadioStartSession = null;
    if (radioUiState.startingStationId === stationId) {
      radioUiState.starting = false;
      radioUiState.startingStationId = '';
    }
    renderRadioView();
  }
}

function stopRadioStation() {
  var session = state.radioSession;
  if (!session) {
    cancelPendingRadioStart();
    if (state.currentView === 'radio') renderRadioView();
    return;
  }
  var currentIsRadio = state.currentPlayingTrack && state.currentPlayingTrack.radioSessionId === session.stationId
    && (!state.currentPlaybackPreservesQueueCursors || state.currentRadioHistoryPlayback);
  disposeRadioSession();
  state.playQueueTracks = state.playQueueTracks.filter(function (track) { return track.radioSessionId !== session.stationId; });
  state.shuffleQueue = state.shuffleQueue.filter(function (track) { return track.radioSessionId !== session.stationId; });
  state.currentTracks = state.currentTracks.filter(function (track) { return track.radioSessionId !== session.stationId; });
  if (state.playQueueCursor && state.playQueueCursor.radioSessionId === session.stationId) state.playQueueCursor = null;
  if (state.shuffleQueueCursor && state.shuffleQueueCursor.radioSessionId === session.stationId) state.shuffleQueueCursor = null;
  if (currentIsRadio) {
    stopPlaybackState({ resetPosition: true });
    state.currentPlayingTrack = null;
    state.sourcePlaylistId = null;
    state.currentPlaybackPreservesQueueCursors = false;
    state.currentRadioHistoryPlayback = false;
  }
  syncSavedQueuePaths(); saveSettingsDebounced(300); renderRadioView();
}
function setDisclosureState(panel, trigger, open) {
  var restoreTriggerFocus = !!(panel && !open && panel.contains(document.activeElement));
  if (panel) {
    panel.classList.toggle('open', !!open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    panel.inert = !open;
  }
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (restoreTriggerFocus && trigger) trigger.focus();
}
function setQueueOpen(open) {
  isQueueOpen = !!open;
  if (isQueueOpen && lyricsOpen) setLyricsOpen(false);
  if (isQueueOpen) queueRenderLimit = 250;
  var trigger = $('btn-queue-toggle');
  setDisclosureState($('queue-panel'), trigger, isQueueOpen);
  if (trigger) trigger.style.color = isQueueOpen ? 'var(--accent)' : '';
  if (isQueueOpen) renderQueue();
}
function toggleQueue() { setQueueOpen(!isQueueOpen); }

// A remote Radio queue entry persists only a stable YouTube video ID.  Build
// the thumbnail from that ID instead of carrying an arbitrary remote URL.
function getTrackArtworkUrl(track) {
  if (!track) return '';
  if (track.matchedFile && typeof track.matchedFile.picture === 'string' && track.matchedFile.picture) return track.matchedFile.picture;
  if (isRemotePlaybackTrack(track)) return 'https://i.ytimg.com/vi/' + track.playback.videoId + '/hqdefault.jpg';
  return '';
}
function isLastfmRadioTrack(track) {
  return !!(track && state.radioSession && track.radioSessionId === state.radioSession.stationId && state.radioSession.providerId === 'lastfm');
}
function makeQueueActionMarkup(track, includeRemove, removeIndex) {
  var actions = '<button type="button" class="icon-btn ghost btn-add-queue-playlist" aria-label="Add to playlist" title="Add to playlist"><i class="ph ph-plus" aria-hidden="true"></i></button>';
  if (isLastfmRadioTrack(track)) actions += '<button type="button" class="icon-btn ghost btn-more-like-queue" aria-label="More Like This" title="More Like This"><i class="ph ph-sparkle" aria-hidden="true"></i></button>';
  if (track && (track.sourceRadio || isLastfmRadioTrack(track))) {
    actions += '<button type="button" class="icon-btn ghost btn-block-radio-track" aria-label="Never play ' + esc(track.title || 'track') + ' on Radio" title="Never play this track"><i class="ph ph-prohibit" aria-hidden="true"></i></button>';
    actions += '<button type="button" class="icon-btn ghost btn-block-radio-artist" aria-label="Never play ' + esc(track.artist || 'artist') + ' on Radio" title="Never play this artist"><i class="ph ph-user-minus" aria-hidden="true"></i></button>';
  }
  if (includeRemove) actions += '<button type="button" class="icon-btn ghost btn-remove-queue" aria-label="Remove ' + esc(track.title || 'track') + ' from queue" data-idx="' + removeIndex + '"><i class="ph ph-x" aria-hidden="true"></i></button>';
  return '<span class="queue-row-actions">' + actions + '</span>';
}
function bindQueueActionHandlers(row, track) {
  var addButton = row.querySelector('.btn-add-queue-playlist');
  if (addButton) addButton.addEventListener('click', function (event) { event.stopPropagation(); showAddToPlaylistModal([track]); });
  var moreButton = row.querySelector('.btn-more-like-queue');
  if (moreButton) moreButton.addEventListener('click', function (event) { event.stopPropagation(); setMoreLikeThis(track); });
  var blockTrackButton = row.querySelector('.btn-block-radio-track');
  if (blockTrackButton) blockTrackButton.addEventListener('click', function (event) { event.stopPropagation(); blockRadioTrack(track); });
  var blockArtistButton = row.querySelector('.btn-block-radio-artist');
  if (blockArtistButton) blockArtistButton.addEventListener('click', function (event) { event.stopPropagation(); blockRadioArtist(track); });
}

// Queue: Now Playing + Next Up sections
function renderQueue(options) {
  options = options || {};
  var ql = options.target || $('queue-list'); if (!ql) return;
  var preservedScrollTop = options.preserveScroll ? ql.scrollTop : 0;
  ql.innerHTML = '';
  var allTracks = state.isShuffle ? state.shuffleQueue : state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  var curIdx = getPlaybackSequenceCursorIndex(allTracks);
  var cur = state.currentPlayingTrack;
  var dragIndex = -1;
  var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
  function makePic(track) { var artwork = getTrackArtworkUrl(track); var label = track && (track.album || track.title) || 'track'; return artwork ? '<img src="' + esc(artwork) + '" alt="Artwork for ' + esc(label) + '"' + lazy + ' style="width:36px;height:36px;border-radius:3px;object-fit:cover;flex-shrink:0;" />' : '<div style="width:36px;height:36px;background:#333;border-radius:3px;flex-shrink:0;"></div>'; }
  if (options.includeRadioPlayed && state.radioSession && (state.radioSession.playedTracks || []).length) {
    var playedHeader = document.createElement('div');
    playedHeader.style.cssText = 'padding:8px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    playedHeader.textContent = 'PLAYED'; ql.appendChild(playedHeader);
    state.radioSession.playedTracks.forEach(function (playedTrack) {
      var playedRow = document.createElement('div'); playedRow.className = 'queue-item'; playedRow.tabIndex = 0; playedRow.setAttribute('role', 'button');
      playedRow.setAttribute('aria-label', 'Play again: ' + (playedTrack.title || 'track') + ' by ' + (playedTrack.artist || 'Unknown Artist'));
      playedRow.innerHTML = makePic(playedTrack) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(playedTrack.title) + '</div><div class="queue-item-artist">' + esc(playedTrack.artist) + '</div></div><button type="button" class="icon-btn ghost btn-add-queue-playlist" aria-label="Add to playlist"><i class="ph ph-plus" aria-hidden="true"></i></button>';
      function replayPlayedTrack() { initAudioCtx(); playTrack(playedTrack, { preserveRadioSession: true, preserveQueueCursors: true, radioHistoryPlayback: true }); }
      playedRow.addEventListener('click', replayPlayedTrack);
      playedRow.querySelector('.btn-add-queue-playlist').addEventListener('click', function (event) { event.stopPropagation(); showAddToPlaylistModal([playedTrack]); });
      playedRow.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); replayPlayedTrack(); } });
      ql.appendChild(playedRow);
    });
  }
  if (cur) {
    var h1 = document.createElement('div');
    h1.style.cssText = 'padding:8px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    h1.textContent = 'NOW PLAYING'; ql.appendChild(h1);
    var npDiv = document.createElement('div'); npDiv.className = 'queue-item playing';
    npDiv.innerHTML = makePic(cur) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(cur.title) + '</div><div class="queue-item-artist">' + esc(cur.artist) + '</div></div>' + makeQueueActionMarkup(cur, false, -1);
    bindQueueActionHandlers(npDiv, cur);
    ql.appendChild(npDiv);
  }
  var nextTracks = curIdx >= 0 ? allTracks.slice(curIdx + 1) : allTracks;
  var combinedQueue = (state.userQueue || []).concat(nextTracks);
  if (combinedQueue.length > 0) {
    var h2 = document.createElement('div');
    h2.style.cssText = 'padding:12px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    h2.textContent = 'NEXT UP'; ql.appendChild(h2);

    var nextUpContainer = document.createElement('div');
    nextUpContainer.id = ql.id + '-next-up-list';
    nextUpContainer.className = 'queue-next-up-list';
    function reorderCombinedQueue(fromIndex, toIndex) {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= combinedQueue.length || toIndex >= combinedQueue.length || fromIndex === toIndex) return;
      var userQueueLength = (state.userQueue || []).length;
      var movedItem = combinedQueue.splice(fromIndex, 1)[0];
      combinedQueue.splice(toIndex, 0, movedItem);
      state.userQueue = combinedQueue.slice(0, userQueueLength);
      var nextUpQueue = combinedQueue.slice(userQueueLength);
      if (state.isShuffle) {
        var previousShuffleTracks = curIdx >= 0 ? state.shuffleQueue.slice(0, curIdx + 1) : [];
        state.shuffleQueue = previousShuffleTracks.concat(nextUpQueue);
      } else {
        var allNonDisabled = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
        var previousTracks = curIdx >= 0 ? allNonDisabled.slice(0, curIdx + 1) : [];
        state.playQueueTracks = previousTracks.concat(nextUpQueue);
      }
      syncSavedQueuePaths();
      saveSettingsDebounced(300);
      renderQueue(); if (isFullscreenQueueOpen()) renderFullscreenQueue();
      requestAnimationFrame(function () {
        var currentList = $(ql.id + '-next-up-list');
        var movedRow = currentList && currentList.querySelector('[data-queue-index="' + toIndex + '"]');
        if (movedRow) movedRow.focus();
      });
    }

    combinedQueue.slice(0, queueRenderLimit).forEach(function (track, i) {
      var isUserQueue = i < (state.userQueue || []).length;
      var isRadioContinuation = !isUserQueue && !!(track && (track.radioSessionId || track.sourceRadio));
      var queueSourceLabel = isUserQueue ? 'Manual Up Next' : (isRadioContinuation ? 'Radio continuation' : 'Queue');
      var sourceBadge = (isUserQueue || isRadioContinuation) ? '<span class="queue-source-badge" aria-hidden="true">' + (isUserQueue ? 'Manual' : 'Radio') + '</span>' : '';
      var div = document.createElement('div'); div.className = 'queue-item' + (isUserQueue ? ' queue-item-manual' : '') + (isRadioContinuation ? ' queue-item-radio' : '');
      div.draggable = !options.readOnly;
      div.dataset.queueIndex = String(i);
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.setAttribute('aria-label', queueSourceLabel + ': play ' + (track.title || 'track') + ' by ' + (track.artist || 'Unknown Artist') + (options.readOnly ? '.' : '. Use Alt plus Up or Down to reorder.'));
      div.innerHTML = makePic(track) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(track.title) + sourceBadge + '</div><div class="queue-item-artist">' + esc(track.artist) + '</div></div>' + makeQueueActionMarkup(track, isUserQueue, i);
      if (!options.readOnly) div.addEventListener('dragstart', function (e) { queueDragInProgress = true; dragIndex = i; div.style.opacity = '0.5'; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      if (!options.readOnly) div.addEventListener('dragend', function () { queueDragInProgress = false; dragIndex = -1; div.style.opacity = ''; div.classList.remove('drag-over'); scheduleQueueRefresh(); });
      if (!options.readOnly) div.addEventListener('dragover', function (e) { e.preventDefault(); if (dragIndex !== -1 && dragIndex !== i) div.classList.add('drag-over'); });
      if (!options.readOnly) div.addEventListener('dragleave', function () { div.classList.remove('drag-over'); });
      if (!options.readOnly) div.addEventListener('drop', function (e) {
        e.preventDefault();
        div.classList.remove('drag-over');
        if (dragIndex === -1 || dragIndex === i) return;
        reorderCombinedQueue(dragIndex, i);
      });
      div.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.btn-more-like-queue')) {
          e.stopPropagation(); setMoreLikeThis(track);
        } else if (e.target.closest && e.target.closest('.btn-block-radio-track')) {
          e.stopPropagation(); blockRadioTrack(track);
        } else if (e.target.closest && e.target.closest('.btn-block-radio-artist')) {
          e.stopPropagation(); blockRadioArtist(track);
        } else if (e.target.closest && e.target.closest('.btn-remove-queue')) {
          e.stopPropagation();
          state.userQueue.splice(i, 1);
          syncSavedQueuePaths();
          saveSettingsDebounced(300);
          renderQueue();
          if (isFullscreenQueueOpen()) renderFullscreenQueue();
        } else if (e.target.closest && e.target.closest('.btn-add-queue-playlist')) {
          e.stopPropagation(); showAddToPlaylistModal([track]);
        } else if (!e.target.classList.contains('drag-handle')) {
          initAudioCtx();
          playTrack(track, { preserveRadioSession: isUserQueue, preserveQueueCursors: isUserQueue, selectedQueueTrack: true }).then(function (started) {
            if (!started || !isUserQueue) return;
            var queuedIndex = state.userQueue[i] === track ? i : state.userQueue.indexOf(track);
            if (queuedIndex !== -1) state.userQueue.splice(queuedIndex, 1);
            syncSavedQueuePaths();
            saveSettingsDebounced(300);
            if (isQueueOpen) renderQueue();
            if (isFullscreenQueueOpen()) renderFullscreenQueue();
          });
        }
      });
      div.addEventListener('keydown', function (e) {
        if (e.target !== div) return;
        if (!options.readOnly && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); reorderCombinedQueue(i, i + (e.key === 'ArrowUp' ? -1 : 1)); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); div.click(); }
      });
      nextUpContainer.appendChild(div);
    });
    ql.appendChild(nextUpContainer);
    if (combinedQueue.length > queueRenderLimit) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-outline';
      more.style.cssText = 'width:calc(100% - 16px);margin:8px;';
      more.textContent = 'Show ' + Math.min(250, combinedQueue.length - queueRenderLimit) + ' more';
      more.addEventListener('click', function () { queueRenderLimit += 250; renderQueue(); if (isFullscreenQueueOpen()) renderFullscreenQueue(); });
      ql.appendChild(more);
    }
  }
  if (!cur && combinedQueue.length === 0) { ql.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-subdued);font-size:13px;">Queue is empty</div>'; }
  if (options.preserveScroll) ql.scrollTop = Math.min(preservedScrollTop, ql.scrollHeight);
}

function renderFullscreenQueue(options) {
  var target = $('np-queue-content');
  if (target) renderQueue(Object.assign({}, options || {}, { target: target, readOnly: true, includeRadioPlayed: true }));
}

// FIX 7: switchView always pushes to nav history, including album detail
function switchView(viewId, addToHistory) {
  if (addToHistory === undefined) addToHistory = true;
  if (viewId === 'playlists_fullscreen') viewId = 'playlists';
  if (viewId !== state.currentView) clearTrackSelection();

  var ca = $('content-area');
  if (state.currentView === 'library' && viewId !== 'library') {
    state.libraryScrollPos = ca ? ca.scrollTop : 0;
  }

  state.currentView = viewId;
  var gs = $('global-search'); if (gs && viewId !== 'search') { gs.value = ''; var clearSearch = $('global-search-clear'); if (clearSearch) clearSearch.hidden = true; }
  // FIX 5: scroll reset on every view change
  if (ca) ca.scrollTop = 0;
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); el.removeAttribute('aria-current'); });
  document.querySelectorAll('.playlist-item').forEach(function (el) { el.classList.remove('active'); el.removeAttribute('aria-current'); });
  hideAllViewRoots();
  var hdc = $('home-dashboard-container');
  var pcontainer = $('playlists-grid-container'); if (pcontainer) pcontainer.style.display = 'none';
  var radioContainer = $('radio-container'); if (radioContainer) radioContainer.style.display = 'none';
  var mhc = $('metadata-health-container');
  if (addToHistory) pushNav(viewId);
  $('view-title').style.display = 'block';
  if (viewId === 'library') {
    setViewKind('library');
    $('view-title').textContent = 'Library';
    $('nav-library').classList.add('active');
    $('nav-library').setAttribute('aria-current', 'page');
    $('zoom-controls').style.display = 'flex';
    renderLibrary();
    if (state.libraryScrollPos && ca) {
      setTimeout(function () { ca.scrollTop = state.libraryScrollPos; }, 50);
    }
  } else if (viewId === 'playlists') {
    setViewKind('playlists');
    $('view-title').style.display = 'none';
    var navPlaylists = $('nav-playlists'); if (navPlaylists) { navPlaylists.classList.add('active'); navPlaylists.setAttribute('aria-current', 'page'); }
    if (pcontainer) pcontainer.style.display = 'block';
    renderSidebarPlaylists();
  } else if (viewId === 'radio') {
    setViewKind('radio');
    $('view-title').style.display = 'none';
    var navRadio = $('nav-radio'); if (navRadio) { navRadio.classList.add('active'); navRadio.setAttribute('aria-current', 'page'); }
    if (radioContainer) radioContainer.style.display = 'block';
    renderRadioView();
    loadRadioGenres();
  } else if (viewId === 'home') {
    setViewKind('home');
    $('view-title').textContent = 'Home';
    $('nav-home').classList.add('active');
    $('nav-home').setAttribute('aria-current', 'page');
    $('view-title').style.display = 'none'; // hide generic title
    $('albums-grid-container').style.display = 'none';
    $('tracks-table-container').style.display = 'none';

    var hdc = $('home-dashboard-container');
    if (hdc) {
      hdc.style.display = 'block';
      renderHomeDashboard();
    }
  } else if (viewId === 'metadata_health') {
    setViewKind('health');
    $('view-title').textContent = 'Tag Health';
    var navHealth = $('nav-health'); if (navHealth) { navHealth.classList.add('active'); navHealth.setAttribute('aria-current', 'page'); }
    if (mhc) { mhc.style.display = 'block'; renderMetadataHealthView(); }
  } else if (viewId === 'stats') {
    setViewKind('stats');
    $('view-title').style.display = 'none';
    var navStats = $('nav-stats'); if (navStats) { navStats.classList.add('active'); navStats.setAttribute('aria-current', 'page'); }
    renderStatsView();
  } else if (viewId === 'search') {
    setViewKind('search');
    $('view-title').textContent = 'Search Results';
    $('view-title').style.display = 'none';
    if (gs && gs.value) {
      // Re-trigger the input event so that search renders results
      gs.dispatchEvent(new Event('input'));
    }
  } else if (getSmartPlaylistById(viewId)) {
    setViewKind('playlist');
    var smartNav = $('nav-playlists'); if (smartNav) { smartNav.classList.add('active'); smartNav.setAttribute('aria-current', 'page'); }
    openSmartPlaylist(getSmartPlaylistById(viewId));
  } else {
    setViewKind('playlist');
    $('tracks-table-container').style.display = 'block';
    var playlistNav = $('nav-playlists'); if (playlistNav) { playlistNav.classList.add('active'); playlistNav.setAttribute('aria-current', 'page'); }
    var el = document.getElementById(viewId); if (el) { el.classList.add('active'); el.setAttribute('aria-current', 'page'); }
    renderPlaylist(viewId);
  }
  syncDockPlaylistStates();
}

function renderHomeDashboard() {
  var renderGeneration = ++homeRenderGeneration;
  var emptyState = $('home-empty-library');
  var libraryContent = $('home-library-content');
  var isEmptyLibrary = state.musicFiles.length === 0;
  if (emptyState) emptyState.hidden = !isEmptyLibrary;
  if (libraryContent) libraryContent.hidden = isEmptyLibrary;
  var recGrid = $('home-recommendations');
  var recEmpty = $('home-recommendations-empty');
  var lfTxt = $('lastfm-status-text');
  if (isEmptyLibrary) {
    if (recGrid) recGrid.replaceChildren();
    if (lfTxt) lfTxt.textContent = 'Available after import';
    return;
  }

  // Helper to create album card
  function addAlbumCard(album, gridEl) {
    var card = document.createElement('article'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : ''); card.dataset.albumKey = album.id || '';
    var active = isAlbumActive(album);
    var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt=""' + lazy + ' />' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
    card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + '<button type="button" class="album-card-play-btn" aria-label="Play ' + esc(album.name) + '" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '" aria-hidden="true"></i></button></div><button type="button" class="album-card-open" aria-label="Open ' + esc(album.name) + ' by ' + esc(album.artist || 'Unknown Artist') + '"><span class="album-card-info"><span class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</span><span class="album-card-artist">' + esc(album.artist) + '</span></span></button>';
    // Set blurred bg for non-square covers
    if (album.cover) {
      var wrapper = card.querySelector('.album-card-img-wrapper');
      if (wrapper) wrapper.style.setProperty('--cover-bg', 'url("' + album.cover.replace(/"/g, '\\"') + '")');
    }
    
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      currentContextMenuAlbum = album;
      positionContextMenu($('album-context-menu'), e.clientX, e.clientY, card);
    });
    card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
      e.stopPropagation(); initAudioCtx();
      if (isAlbumActive(album)) { togglePlay(); var icon = e.currentTarget.querySelector('i'); if (icon) icon.className = state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'; return; }
      state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
      state.shuffleQueue = []; if (state.isShuffle) rebuildShuffleQueueForMode();
      playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
    });
    card.addEventListener('click', function () { pushNav('album:' + album.id); renderAlbumDetail(album); });
    card.querySelector('.album-card-open').addEventListener('keydown', function (e) {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
    });
    gridEl.appendChild(card);
  }

  var albumList = getLibraryIndex().albums;
  renderDailySmartPlaylists();

  // ── Compact Stats Bar ──
  var statsBar = $('home-stats-bar');
  if (statsBar) {
    var listeningEntries2 = getListeningStatEntries();
    var totalPlays2 = listeningEntries2.reduce(function(sum, entry) { return sum + entry.count; }, 0);
    var totalSecs2 = listeningEntries2.reduce(function(sum, entry) { return sum + entry.time; }, 0);
    var totalHrs2 = Math.floor(totalSecs2/3600);
    var totalMins2 = Math.floor((totalSecs2%3600)/60);
    var uniqueTracks2 = listeningEntries2.length;
    var statItems = [
      { icon: 'ph-play', val: totalPlays2 || '—', label: 'Total plays' },
      { icon: 'ph-clock', val: totalPlays2 ? (totalHrs2 + 'h ' + totalMins2 + 'm') : '—', label: 'Listened' },
      { icon: 'ph-music-notes', val: uniqueTracks2 || '—', label: 'Tracks played' },
      { icon: 'ph-vinyl-record', val: albumList.length, label: 'Albums' },
    ];
    statsBar.innerHTML = statItems.map(function(s) {
      return '<button type="button" class="home-stat-button" aria-label="Open listening statistics. ' + s.label + ': ' + s.val + '">' +
        '<i class="ph ' + s.icon + '" aria-hidden="true"></i>' +
        '<span class="home-stat-copy"><strong>' + s.val + '</strong><span>' + s.label + '</span></span>' +
        '<i class="ph ph-caret-right home-stat-open" aria-hidden="true"></i>' +
        '</button>';
    }).join('');
    statsBar.querySelectorAll('.home-stat-button').forEach(function (button) { button.addEventListener('click', function () { switchView('stats'); }); });
  }

  // Recently Added (by real added-at timestamp; falls back to insertion order for old entries)
  var gridRecent = $('home-recently-added');
  if (gridRecent) {
    gridRecent.innerHTML = '';
    var recent = albumList.map(function (album, index) { return { album: album, addedAt: getAlbumAddedAt(album), index: index }; });
    recent.sort(function (a, b) { return b.addedAt - a.addedAt || b.index - a.index; });
    recent.slice(0, 6).forEach(function(entry) { addAlbumCard(entry.album, gridRecent); });
  }

  // Most Played (For now, sort by track count as proxy)
  var gridMost = $('home-most-played');
  if (gridMost) {
    gridMost.innerHTML = '';
    var listeningCounts = new Map(getListeningStatEntries().map(function (entry) { return [entry.key, entry.count]; }));
    var mostPlayed = albumList.map(function (album) {
      return { album: album, count: album.tracks.reduce(function (sum, track) { return sum + (listeningCounts.get(getListeningStatIdentity(track)) || 0); }, 0) };
    }).sort(function(a, b) { return b.count - a.count || b.album.tracks.length - a.album.tracks.length; });
    if (mostPlayed.some(function (entry) { return entry.count > 0; })) {
      mostPlayed.filter(function (entry) { return entry.count > 0; }).slice(0, 6).forEach(function(entry) { addAlbumCard(entry.album, gridMost); });
    } else {
      gridMost.innerHTML = '<div class="home-shelf-empty"><i class="ph ph-waveform" aria-hidden="true"></i><span>Play a few tracks to build your listening history.</span></div>';
    }
  }

  // Discover / Random Albums
  var gridRandom = $('home-random-albums');
  if (gridRandom) {
    gridRandom.innerHTML = '';
    var randoms = albumList.slice();
    for (var randomIndex = 0; randomIndex < Math.min(6, randoms.length); randomIndex++) {
      var swapIndex = randomIndex + Math.floor(Math.random() * (randoms.length - randomIndex));
      var swapAlbum = randoms[randomIndex]; randoms[randomIndex] = randoms[swapIndex]; randoms[swapIndex] = swapAlbum;
    }
    randoms = randoms.slice(0, 6);
    randoms.forEach(function(a) { addAlbumCard(a, gridRandom); });
  }

  var btnRefRandom = $('btn-refresh-random-albums');
  if (btnRefRandom) btnRefRandom.onclick = function() { renderHomeDashboard(); };

  // Last.fm Recommendations
  var btnRefLfm = $('btn-refresh-lastfm');
  if (appSettings.lastfmConnected) {
    lfTxt.textContent = 'Connected as ' + appSettings.lastfmUsername;
    recEmpty.style.display = 'none';
    if (btnRefLfm) {
      btnRefLfm.style.display = 'flex';
      btnRefLfm.onclick = function() { state.lastfmRecsCache = null; renderHomeDashboard(); };
    }

    function renderRecs(recs) {
      recGrid.innerHTML = '';
      if (!recs || recs.length === 0) {
        recGrid.innerHTML = '<div class="home-recommendations-empty home-recommendations-inline">No recommendations found yet. Listen to more tracks to help Last.fm learn your taste.</div>';
      } else {
        recs.forEach(function (r) {
          var card = document.createElement('button'); card.type = 'button'; card.className = 'album-card recommendation-card';
          card.setAttribute('aria-label', 'Search YouTube for ' + r.artist + ' ' + r.name);
          var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
          var cov = r.image ? '<img src="' + esc(r.image) + '" alt=""' + lazy + '/>' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
          card.innerHTML = '<div class="album-card-img-wrapper">' + cov + '</div><div class="album-card-info"><div class="album-card-title" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="album-card-artist">' + esc(r.artist) + '</div></div>';
          card.addEventListener('click', function () {
            window.api.openExternal('https://www.youtube.com/results?search_query=' + encodeURIComponent(r.artist + ' ' + r.name));
          });
          recGrid.appendChild(card);
        });
      }
    }

    if (state.lastfmRecsCache && state.lastfmRecsCacheTime && (Date.now() - state.lastfmRecsCacheTime < 3600000)) {
      renderRecs(state.lastfmRecsCache);
    } else {
      recGrid.innerHTML = '<div class="home-recommendations-state"><i class="ph ph-spinner ph-spin" aria-hidden="true"></i><p>Fetching personalized recommendations...</p></div>';
      window.api.getLastfmRecommendations().then(function (recs) {
        if (renderGeneration !== homeRenderGeneration || state.currentView !== 'home' || !state.musicFiles.length || !appSettings.lastfmConnected) return;
        state.lastfmRecsCache = recs;
        state.lastfmRecsCacheTime = Date.now();
        renderRecs(recs);
      }).catch(function (err) {
        if (renderGeneration !== homeRenderGeneration || state.currentView !== 'home' || !state.musicFiles.length) return;
        recGrid.innerHTML = '<div class="home-recommendations-state error">Recommendations could not be loaded. Try refreshing this section.</div>';
      });
    }
  } else {
    lfTxt.textContent = 'Not connected';
    recEmpty.style.display = 'grid';
    recGrid.innerHTML = '';
    if (btnRefLfm) btnRefLfm.style.display = 'none';
  }
}

// FIX 1+2+3: Sidebar playlist render - grid fix, pin/lastPlayed separate, auto cover

function renderSidebarPlaylists() {
  var list = $('playlists-list'); if (!list) return; list.innerHTML = '';
  if (state.currentView === 'playlists') renderSmartPlaylistsGrid();
  var recentCovers = new Map();
  var libIndex = getLibraryIndex();
  var titleArtistMap = new Map();
  var titleArtistAlbumMap = new Map();
  var filenameMap = new Map();
  state.musicFiles.forEach(function (file) {
    var titleKey = normalize(file.title) + '::' + normalize(file.artist);
    var albumKey = titleKey + '::' + normalize(file.album);
    var filenameKey = normalize(file.filename ? file.filename.replace(/\.[^.]+$/, '') : '');
    if (titleKey && !titleArtistMap.has(titleKey)) titleArtistMap.set(titleKey, file);
    if (albumKey && !titleArtistAlbumMap.has(albumKey)) titleArtistAlbumMap.set(albumKey, file);
    if (filenameKey && !filenameMap.has(filenameKey)) filenameMap.set(filenameKey, file);
  });

  var likedSet = new Set(state.likedSongs);
  var pseudoLiked = {
    id: 'liked_songs',
    name: 'Liked Songs',
    pinned: false,
    color: 'linear-gradient(135deg, #171717, #4A4A4A)',
    isSpecial: true,
    tracks: state.musicFiles.filter(function (f) { return likedSet.has(f.filePath); }),
    lastPlayed: localStorage.getItem('likedSongsLastPlayed') || null
  };

  var pinned = state.playlists.filter(function (p) { return p.pinned; });
  var unpinned = state.playlists.filter(function (p) { return !p.pinned; });
  unpinned.push(pseudoLiked);

  unpinned.sort(function (a, b) {
    if (!a.lastPlayed && !b.lastPlayed) return 0;
    if (!a.lastPlayed) return 1; if (!b.lastPlayed) return -1;
    return new Date(b.lastPlayed) - new Date(a.lastPlayed);
  });
  var sorted = pinned.concat(unpinned);

  list.className = 'playlists-container playlists-grid';
  list.removeAttribute('style');
  if($('playlist-search')) $('playlist-search').style.display = 'block';

  sorted.forEach(function (pl) {
    var autoCover = pl.cover || null;
    if (!autoCover && !pl.isSpecial) {
      for (var i = 0; i < (pl.tracks || []).length; i++) {
        var r = pl.tracks[i];
        var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
        var trackPath = getPlaylistTrackFilePath(r);
        var m = isM3uImportRecord(r) ? findPlaylistRecordMatch(r) : ((trackPath ? libIndex.byStrippedPath.get(stripFileUrl(trackPath)) : null) || titleArtistAlbumMap.get(normalize(sn) + '::' + normalize(an) + '::' + normalize(al)) || titleArtistMap.get(normalize(sn) + '::' + normalize(an)) || filenameMap.get(normalize(sn)) || findMatchingFile(sn, an, al, trackPath));
        if (m && m.picture) { autoCover = m.picture; break; }
      }
    }
    recentCovers.set(pl.id, autoCover);

    var el = document.createElement('button');
    el.type = 'button';
    var isActive = state.currentView === pl.id;
    var isPlayingSource = state.sourcePlaylistId === pl.id;
    el.className = 'playlist-item playlist-card' + (pl.pinned ? ' pinned' : '') + (isActive ? ' active' : '') + (isPlayingSource ? ' playing-source' : '');
    el.id = pl.id;
    if (isActive) el.setAttribute('aria-current', 'page');

    var trackCount = pl.tracks ? pl.tracks.length : 0;
    var subText = trackCount + ' tracks';

    var innerIcon = pl.isSpecial ? '<i class="ph-fill ph-heart"></i>' : '<i class="ph ph-music-notes"></i>';
    var bgStyle = pl.id === 'liked_songs' ? 'background:linear-gradient(135deg, #171717, #4A4A4A);' : 'background:' + getSafePlaylistColor(pl.color) + ';';
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var coverHtml = autoCover ? '<img class="playlist-card-cover" src="' + esc(autoCover) + '"' + lazy + ' alt="" />'
      : '<div class="playlist-card-cover playlist-card-cover-placeholder" style="' + bgStyle + '">' + innerIcon + '</div>';
    var pinHtml = pl.pinned ? '<span class="playlist-card-pin" title="Pinned"><i class="ph-fill ph-push-pin" aria-hidden="true"></i></span>' : '';
    var playingHtml = '<span class="playlist-card-playing" title="Playing from this playlist"><i class="ph ph-waveform" aria-hidden="true"></i></span>';

    el.innerHTML = '<span class="playlist-card-cover-shell">' + coverHtml + pinHtml + playingHtml + '</span><span class="playlist-card-title" title="' + esc(pl.name) + '">' + esc(pl.name) + '</span><span class="playlist-card-meta">' + subText + '</span>';

    el.addEventListener('click', function () { switchView(pl.id); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); openPlaylistContextMenu(pl, e.clientX, e.clientY, el); });
    if (!pl.isSpecial) bindPlaylistTrackDropTarget(el, pl);
    list.appendChild(el);
  });
  var dockPinned = state.playlists.filter(function (playlist) { return playlist.pinned; });
  var dockRecent = state.playlists.filter(function (playlist) { return !playlist.pinned; }).concat(pseudoLiked).sort(function (a, b) {
    return (Date.parse(b.lastPlayed || '') || 0) - (Date.parse(a.lastPlayed || '') || 0);
  });
  var dockPlaylists = dockPinned.concat(dockRecent);
  renderRecentPlaylistDock(dockPlaylists, recentCovers);
  var playlistSearch = $('playlist-search');
  if (playlistSearch && playlistSearch.value) filterPlaylists(playlistSearch.value);
}

function getEffectiveDockMode() {
  return appSettings.dockMode === 'expanded' && window.innerWidth > 1180 ? 'expanded' : 'collapsed';
}

function applyDockMode() {
  var effectiveMode = getEffectiveDockMode();
  var changed = document.body.dataset.dockMode !== effectiveMode;
  document.body.dataset.dockMode = effectiveMode;
  var sidebar = $('sidebar');
  if (sidebar) sidebar.dataset.dockMode = effectiveMode;
  var toggle = $('dock-mode-toggle');
  if (toggle) {
    var prefersExpanded = appSettings.dockMode === 'expanded';
    var effectivelyExpanded = effectiveMode === 'expanded';
    toggle.setAttribute('aria-pressed', effectivelyExpanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', effectivelyExpanded ? 'Collapse playlist dock' : 'Expand playlist dock');
    toggle.title = effectivelyExpanded ? 'Collapse playlist dock' : (prefersExpanded && window.innerWidth <= 1180 ? 'Expanded dock is saved and will return when the window is wider' : 'Expand playlist dock');
  }
  return changed;
}

function appendDockPlaylistCover(target, pl, cover) {
  var coverFrame = document.createElement('span');
  coverFrame.className = 'dock-playlist-cover';
  function showFallback() {
    coverFrame.replaceChildren();
    coverFrame.classList.add('placeholder');
    coverFrame.style.background = pl.id === 'liked_songs' ? 'linear-gradient(135deg, #171717, #4A4A4A)' : getSafePlaylistColor(pl.color);
    var fallbackIcon = document.createElement('i');
    fallbackIcon.className = pl.id === 'liked_songs' ? 'ph-fill ph-heart' : 'ph ph-playlist';
    fallbackIcon.setAttribute('aria-hidden', 'true');
    coverFrame.appendChild(fallbackIcon);
  }
  if (cover) {
    var image = document.createElement('img');
    image.src = cover;
    image.alt = '';
    if (appSettings.lazyLoading) image.loading = 'lazy';
    image.addEventListener('error', showFallback, { once: true });
    coverFrame.appendChild(image);
  } else showFallback();
  target.appendChild(coverFrame);
}

function getDockPlaylistPlaybackTracks(pl) {
  if (pl.id === 'liked_songs') {
    var byPath = getLibraryIndex().byStrippedPath;
    return state.likedSongs.map(function (record) {
      var file = typeof record === 'string' ? byPath.get(stripFileUrl(record)) : state.musicFiles.find(function (candidate) { return candidate && record && candidate && likedIdentity(candidate) === record.identity; });
      if (file) return { matchedFile: file, title: file.title, artist: file.artist, album: file.album, duration: file.duration, isDisabled: false, sourcePlaylistId: pl.id };
      return record && typeof record === 'object' && /^[A-Za-z0-9_-]{11}$/.test(record.videoId || '') ? { title: record.title, artist: record.artist, album: record.album, duration: record.duration, trackMbid: record.trackMbid, playback: { kind: 'youtube', videoId: record.videoId }, artwork: record.artwork, isDisabled: false, sourcePlaylistId: pl.id } : null;
    }).filter(Boolean);
  }
  return (pl.tracks || []).map(function (record) { return playlistRecordToPlaybackTrack(record, pl.id); });
}

function toggleDockPlaylistPlayback(pl) {
  if (state.sourcePlaylistId === pl.id && state.currentPlayingTrack) {
    initAudioCtx();
    togglePlay();
    return;
  }
  var tracks = getDockPlaylistPlaybackTracks(pl);
  var firstPlayable = tracks.find(function (track) { return !track.isDisabled; });
  if (!firstPlayable) {
    showToast('"' + (pl.name || 'This playlist') + '" has no playable tracks.');
    return;
  }
  initAudioCtx();
  state.playQueueTracks = tracks.slice();
  state.shuffleQueue = [];
  if (state.isShuffle) rebuildShuffleQueueForMode();
  playTrack(state.isShuffle ? state.shuffleQueue[0] : firstPlayable);
}

function createDockPlaylistButton(pl, covers) {
  var card = document.createElement('div');
  card.dataset.playlistId = pl.id;
  card.dataset.playlistName = pl.name;
  card.className = 'dock-recent-playlist';

  var openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'dock-playlist-open';
  openButton.setAttribute('aria-label', 'Open playlist ' + pl.name);
  appendDockPlaylistCover(openButton, pl, covers.get(pl.id));
  var label = document.createElement('span');
  label.className = 'dock-playlist-name';
  label.title = pl.name;
  var labelText = document.createElement('span');
  labelText.className = 'dock-playlist-name-text';
  labelText.textContent = pl.name;
  label.appendChild(labelText);
  openButton.appendChild(label);
  openButton.addEventListener('click', function () { switchView(pl.id); });

  var playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'dock-playlist-play';
  playButton.setAttribute('aria-label', 'Play ' + pl.name);
  playButton.innerHTML = '<i class="ph-fill ph-play" aria-hidden="true"></i>';
  playButton.addEventListener('click', function (event) {
    event.stopPropagation();
    toggleDockPlaylistPlayback(pl);
  });

  card.append(openButton, playButton);
  card.addEventListener('contextmenu', function (event) { event.preventDefault(); openPlaylistContextMenu(pl, event.clientX, event.clientY, card); });
  if (!pl.isSpecial) bindPlaylistTrackDropTarget(card, pl);
  return card;
}

function appendExpandedDockSection(dock, label, playlists, covers) {
  if (!playlists.length) return;
  var section = document.createElement('section');
  section.className = 'dock-playlist-section';
  var heading = document.createElement('span');
  heading.className = 'dock-playlist-section-label';
  heading.textContent = label;
  section.appendChild(heading);
  var grid = document.createElement('div');
  grid.className = 'dock-playlist-grid';
  playlists.forEach(function (playlist) {
    var card = createDockPlaylistButton(playlist, covers);
    grid.appendChild(card);
  });
  section.appendChild(grid);
  dock.appendChild(section);
}

function renderRecentPlaylistDock(playlists, covers) {
  var dock = $('dock-recent-playlists');
  if (!dock) return;
  applyDockMode();
  dock.classList.remove('dock-capacity-ready');
  dock.replaceChildren();
  dock.hidden = !playlists.length;
  if (document.body.dataset.dockMode === 'expanded') {
    dock.setAttribute('aria-label', 'Pinned and recent playlists');
    var pinned = playlists.filter(function (playlist) { return playlist.pinned; });
    var remaining = playlists.filter(function (playlist) { return !playlist.pinned; }).sort(function (a, b) {
      return (Date.parse(b.lastPlayed || '') || 0) - (Date.parse(a.lastPlayed || '') || 0);
    });
    appendExpandedDockSection(dock, 'Pinned', pinned, covers);
    appendExpandedDockSection(dock, 'Recent playlists', remaining, covers);
  } else {
    dock.setAttribute('aria-label', 'Playlists, recent first');
    playlists.forEach(function (playlist) { dock.appendChild(createDockPlaylistButton(playlist, covers)); });
  }
  syncDockPlaylistStates();
  observeRecentPlaylistDock();
  scheduleRecentPlaylistDockCapacityUpdate();
}

function updateDockPlayingNameOverflow() {
  document.querySelectorAll('.dock-recent-playlist.playing-name-overflow').forEach(function (card) {
    card.classList.remove('playing-name-overflow');
    var previousName = card.querySelector('.dock-playlist-name');
    if (previousName) previousName.style.removeProperty('--dock-name-overflow');
  });
}

function syncDockPlaylistStates() {
  document.querySelectorAll('.dock-recent-playlist[data-playlist-id]').forEach(function (card) {
    var viewed = card.dataset.playlistId === state.currentView;
    var playingSource = card.dataset.playlistId === state.sourcePlaylistId;
    var playlistName = card.dataset.playlistName || '';
    var openButton = card.querySelector('.dock-playlist-open');
    var playButton = card.querySelector('.dock-playlist-play');
    card.classList.toggle('viewed', viewed);
    card.classList.toggle('playing-source', playingSource);
    if (openButton) {
      if (viewed) openButton.setAttribute('aria-current', 'page');
      else openButton.removeAttribute('aria-current');
      openButton.setAttribute('aria-label', 'Open playlist ' + playlistName + (viewed ? '. Currently viewed.' : '') + (playingSource ? '. Current playback source.' : ''));
    }
    if (playButton) {
      var isActivePlayback = playingSource && !!state.currentPlayingTrack;
      var isPlaying = isActivePlayback && state.isPlaying;
      playButton.setAttribute('aria-label', (isPlaying ? 'Pause ' : 'Play ') + playlistName);
      playButton.title = isPlaying ? 'Pause' : 'Play';
      var icon = playButton.querySelector('i');
      if (icon) icon.className = isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    }
  });
  updateDockPlayingNameOverflow();
}

function scheduleRecentPlaylistDockCapacityUpdate() {
  if (recentPlaylistDockCapacityFrame !== null) cancelAnimationFrame(recentPlaylistDockCapacityFrame);
  recentPlaylistDockCapacityFrame = requestAnimationFrame(function () {
    recentPlaylistDockCapacityFrame = null;
    updateRecentPlaylistDockCapacity();
    updateDockPlayingNameOverflow();
  });
}

function observeRecentPlaylistDock() {
  var dock = $('dock-recent-playlists');
  if (!dock || recentPlaylistDockResizeObserver || typeof ResizeObserver === 'undefined') return;
  recentPlaylistDockResizeObserver = new ResizeObserver(scheduleRecentPlaylistDockCapacityUpdate);
  recentPlaylistDockResizeObserver.observe(dock);
  window.addEventListener('resize', function () {
    if (applyDockMode()) renderSidebarPlaylists();
    else { scheduleRecentPlaylistDockCapacityUpdate(); updateDockPlayingNameOverflow(); }
  });
}

function updateRecentPlaylistDockCapacity() {
  var dock = $('dock-recent-playlists');
  if (!dock) return;
  var buttons = Array.from(dock.querySelectorAll('.dock-recent-playlist'));
  buttons.forEach(function (button) { button.classList.remove('dock-capacity-hidden'); });
  if (dock.hidden || document.body.dataset.dockMode === 'expanded' || window.innerWidth <= 760 || !buttons.length) {
    dock.classList.add('dock-capacity-ready');
    return;
  }
  var styles = getComputedStyle(dock);
  var padding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  var gap = parseFloat(styles.rowGap || styles.gap) || 0;
  var buttonHeight = buttons[0].offsetHeight || 36;
  var availableHeight = Math.max(0, dock.clientHeight - padding);
  var capacity = Math.max(0, Math.floor((availableHeight + gap) / (buttonHeight + gap)));
  var visible = new Set(buttons.slice(0, capacity));
  var priorityButtons = buttons.filter(function (button) { return button.classList.contains('viewed') || button.classList.contains('playing-source'); });
  priorityButtons.slice(0, capacity).forEach(function (priorityButton) {
    if (visible.has(priorityButton)) return;
    var replacement = Array.from(visible).reverse().find(function (button) { return !priorityButtons.includes(button); });
    if (replacement) visible.delete(replacement);
    if (visible.size < capacity) visible.add(priorityButton);
  });
  buttons.forEach(function (button) { button.classList.toggle('dock-capacity-hidden', !visible.has(button)); });
  dock.classList.add('dock-capacity-ready');
}

// FIX 9: playlist search - filters on name, case-insensitive, works for both list/grid
function filterPlaylists(q) {
  var query = String(q || '').trim().toLowerCase();
  var visibleRegular = 0;
  document.querySelectorAll('#playlists-list .playlist-item').forEach(function (el) {
    var nameEl = el.querySelector('.playlist-card-title');
    var txt = nameEl ? nameEl.textContent.toLowerCase() : el.textContent.toLowerCase();
    var visible = txt.includes(query);
    el.style.display = visible ? '' : 'none';
    if (visible) visibleRegular++;
  });
  var visibleSmart = 0;
  document.querySelectorAll('#smart-mixes-list .smart-mix-card').forEach(function (el) {
    var visible = String(el.dataset.searchText || el.textContent || '').toLowerCase().includes(query);
    el.style.display = visible ? '' : 'none';
    if (visible) visibleSmart++;
  });
  var smartSection = $('smart-mixes-section'); if (smartSection) smartSection.hidden = visibleSmart === 0;
  var regularSection = $('regular-playlists-section'); if (regularSection) regularSection.hidden = visibleRegular === 0;
  var empty = $('playlist-search-empty'); if (empty) empty.hidden = visibleSmart + visibleRegular > 0;
}

// FIX 6: album play button state - track which album is active
function isAlbumActive(album) {
  return state.currentPlayingTrack && state.currentPlayingTrack.matchedFile &&
    album.tracks.some(function (t) { return t.filePath === state.currentPlayingTrack.matchedFile.filePath; });
}

function setTagHealthProgress(active, label, current, total, summary) {
  tagHealthProgress = {
    active: !!active,
    label: label || '',
    current: Number(current || 0),
    total: Number(total || 0),
    summary: summary || ''
  };
  updateTagHealthProgressUi();
}
function getTagHealthProgressPercent() {
  var total = tagHealthProgress.total || 0;
  return total ? Math.max(0, Math.min(100, Math.round((tagHealthProgress.current / total) * 100))) : 0;
}
function getTagHealthProgressText() {
  var pct = getTagHealthProgressPercent();
  if (tagHealthProgress.active) return (tagHealthProgress.label || 'Working') + ' ' + tagHealthProgress.current + '/' + tagHealthProgress.total + (tagHealthProgress.total ? ' (' + pct + '%)' : '');
  return tagHealthProgress.summary || '';
}
function renderTagHealthProgressHtml() {
  var pct = getTagHealthProgressPercent();
  var text = getTagHealthProgressText();
  var hidden = !tagHealthProgress.active && !tagHealthProgress.summary ? ' hidden' : '';
  return '<div class="tag-health-progress" id="tag-health-progress" role="status" aria-live="polite"' + hidden + '><div class="tag-health-progress-head"><span id="tag-health-progress-text">' + esc(text) + '</span></div><div class="tag-health-progress-bar"><span id="tag-health-progress-fill" style="width:' + pct + '%"></span></div></div>';
}
function updateTagHealthProgressUi() {
  var root = $('metadata-health-container');
  if (root) root.querySelectorAll('.tag-health-action').forEach(function (btn) { btn.disabled = !!tagHealthProgress.active; });
  var wrap = $('tag-health-progress');
  if (!wrap) return;
  var text = $('tag-health-progress-text');
  var fill = $('tag-health-progress-fill');
  var pct = getTagHealthProgressPercent();
  wrap.hidden = !tagHealthProgress.active && !tagHealthProgress.summary;
  if (text) text.textContent = getTagHealthProgressText();
  if (fill) fill.style.width = pct + '%';
}

function renderMetadataHealthView() {
  var root = $('metadata-health-container'); if (!root) return;
  var albumDiscCounts = {};
  getLibraryIndex().albums.forEach(function (album) {
    albumDiscCounts[album.id] = new Set();
    album.tracks.forEach(function (f) { albumDiscCounts[album.id].add(getDiscNumber(f)); });
  });
  function isMissingTrackOrDisc(f) {
    return !f.trackNo || (albumDiscCounts[getAlbumKey(f)] && albumDiscCounts[getAlbumKey(f)].size > 1 && !f.discNo && !f.__displayDiscNo);
  }
  var checks = [
    { id: 'missing_files', label: 'Missing Files', icon: 'ph-file-x', test: function (f) { return libraryMissingFilePaths.has(f.filePath); } },
    { id: 'missing_cover', label: 'Missing Cover', icon: 'ph-image-broken', test: function (f) { return !f.picture; } },
    { id: 'missing_year', label: 'Missing Year', icon: 'ph-calendar-x', test: function (f) { return !f.year; } },
    { id: 'missing_genre', label: 'Missing Genre', icon: 'ph-tag', test: function (f) { return !f.genre; } },
    { id: 'missing_track', label: 'Missing Track/Disc', icon: 'ph-list-numbers', test: isMissingTrackOrDisc },
    { id: 'missing_replaygain', label: 'Missing ReplayGain', icon: 'ph-waveform', test: function (f) { return f.replayGainTrackDb === null || f.replayGainTrackDb === undefined; } }
  ];
  var activeId = root.dataset.filter || checks[0].id;
  var active = checks.find(function (c) { return c.id === activeId; }) || checks[0];
  // Single pass over the library: card counts + the active filter's matches together
  var checkCounts = {};
  checks.forEach(function (c) { checkCounts[c.id] = 0; });
  var allFiltered = [];
  state.musicFiles.forEach(function (f) {
    checks.forEach(function (c) {
      if (c.test(f)) {
        checkCounts[c.id]++;
        if (c.id === active.id) allFiltered.push(f);
      }
    });
  });
  var filtered = allFiltered.slice(0, 250);
  var busyAttr = tagHealthProgress.active ? ' disabled' : '';
  var contextualActions = '';
  if (active.id === 'missing_files') {
    var reviewDisabled = tagHealthProgress.active || !missingFileScanComplete || !checkCounts.missing_files ? ' disabled' : '';
    contextualActions = '<button class="tag-health-action accent" id="tag-health-relink-folder"' + reviewDisabled + ' title="' + (!missingFileScanComplete ? 'Run Scan Missing Files first' : 'Choose a folder and review proposed path changes') + '">Review Moves</button>';
  }
  else if (active.id === 'missing_replaygain') contextualActions = '<button class="tag-health-action accent" id="tag-health-analyze-visible"' + busyAttr + '>Analyze Next Batch</button><button class="tag-health-action" id="tag-health-analyze-all-rg"' + busyAttr + '>Analyze All</button>';
  else if (active.id === 'missing_cover') contextualActions = '<button class="tag-health-action accent" id="tag-health-quick-visible"' + busyAttr + '>Use Folder Images</button>';
  else if (active.id === 'missing_track') contextualActions = '<button class="tag-health-action accent" id="tag-health-quick-visible"' + busyAttr + '>Infer Listed Numbers</button>';
  else contextualActions = '<button class="tag-health-action accent" id="tag-health-quick-visible"' + busyAttr + '>Open Metadata Editor</button>';
  root.innerHTML = '<div class="tag-health-toolbar"><div><div class="tag-health-title">Library Tag Health</div><div class="tag-health-subtitle">Choose an issue category, then use only the actions that apply to it.</div></div><div class="tag-health-actions"><button class="tag-health-action" id="tag-health-album-cleanup"' + busyAttr + '>Album Cleanup</button><button class="tag-health-action" id="tag-health-scan-missing"' + busyAttr + '>Scan Missing Files</button><button class="tag-health-action" id="tag-health-rescan"' + busyAttr + '>Refresh</button>' + contextualActions + '</div></div>' + renderTagHealthProgressHtml() + '<div class="tag-health-cards" id="metadata-health-cards"></div><div id="metadata-health-list"></div>';
  var albumCleanupBtn = $('tag-health-album-cleanup');
  if (albumCleanupBtn) albumCleanupBtn.onclick = renderAlbumCleanupHelper;
  var scanMissingBtn = $('tag-health-scan-missing');
  if (scanMissingBtn) scanMissingBtn.onclick = scanMissingLibraryFiles;
  var relinkFolderBtn = $('tag-health-relink-folder');
  if (relinkFolderBtn) relinkFolderBtn.onclick = relinkMissingFilesFromFolder;
  var refreshBtn = $('tag-health-rescan');
  if (refreshBtn) refreshBtn.onclick = renderMetadataHealthView;
  var analyzeVisibleBtn = $('tag-health-analyze-visible');
  if (analyzeVisibleBtn) analyzeVisibleBtn.onclick = function () { active.id === 'missing_replaygain' ? analyzeReplayGainBatch(filtered) : analyzeLoudnessForFiles(filtered); };
  var analyzeAllRgBtn = $('tag-health-analyze-all-rg');
  if (analyzeAllRgBtn) analyzeAllRgBtn.onclick = function () { analyzeAllMissingReplayGain(); };
  var quickVisibleBtn = $('tag-health-quick-visible');
  if (quickVisibleBtn) quickVisibleBtn.onclick = function () { quickFixMetadataFiles(active.id, filtered); };
  var cards = $('metadata-health-cards');
  checks.forEach(function (check) {
    var count = checkCounts[check.id];
    var card = document.createElement('button');
    card.className = 'tag-health-card' + (check.id === active.id ? ' active' : '');
    card.innerHTML = '<span class="tag-health-card-icon"><i class="ph ' + check.icon + '"></i></span><span class="tag-health-card-body"><span class="tag-health-card-label">' + esc(check.label) + '</span><span class="tag-health-card-count">' + count + '</span></span>';
    card.onclick = function () { root.dataset.filter = check.id; renderMetadataHealthView(); };
    cards.appendChild(card);
  });
  var list = $('metadata-health-list');
  if (!filtered.length) { list.innerHTML = '<div class="tag-health-empty"><i class="ph ph-check-circle"></i><div>No issues in this category.</div></div>'; return; }
  list.innerHTML = '<div class="tag-health-list-head"><h2>' + esc(active.label) + '</h2><span>Showing ' + filtered.length + ' of ' + allFiltered.length + '</span></div><div class="tag-health-rows" id="tag-health-rows"></div>';
  var rows = $('tag-health-rows');
  filtered.forEach(function (f) {
    var row = document.createElement('div');
    row.className = 'tag-health-row';
    var cover = f.picture ? '<img class="tag-health-cover" src="' + esc(f.picture) + '" alt="Artwork for ' + esc(f.album || f.title || 'track') + '">' : '<div class="tag-health-cover placeholder"><i class="ph ph-music-notes"></i></div>';
    var details = [];
    if (libraryMissingFilePaths.has(f.filePath)) details.push('missing file');
    if (!f.year) details.push('no year');
    if (!f.genre) details.push('no genre');
    if (!f.trackNo) details.push('no track #');
    if (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined) details.push('no ReplayGain');
    var quickLabel = active.id === 'missing_replaygain' ? 'Batch Analyze' : (active.id === 'missing_track' ? 'Infer #' : (active.id === 'missing_cover' ? 'Use Image' : 'Auto Tag'));
    var editAlbumBtn = active.id === 'missing_track' ? '<button class="tag-health-action edit-album">Edit Album</button>' : '';
    var quickButton = active.id === 'missing_files' ? '' : '<button class="tag-health-action quick">' + esc(quickLabel) + '</button>';
    row.innerHTML = cover + '<div class="tag-health-track"><div class="tag-health-track-title">' + esc(f.title || f.filename || 'Unknown Track') + '</div><div class="tag-health-track-meta">' + esc(f.artist || 'Unknown Artist') + ' • ' + esc(f.album || 'Unknown Album') + '</div><div class="tag-health-badges">' + details.slice(0, 4).map(function (d) { return '<span>' + esc(d) + '</span>'; }).join('') + '</div></div><div class="tag-health-row-actions"><button class="tag-health-action edit">Edit</button>' + editAlbumBtn + quickButton + '</div>';
    row.querySelector('.edit').onclick = function () { openMetadataEditor([f]); };
    var editAlbum = row.querySelector('.edit-album');
    if (editAlbum) editAlbum.onclick = function () { openMetadataEditor(getAlbumFilesForTrack(f)); };
    var quickButtonEl = row.querySelector('.quick');
    if (quickButtonEl) quickButtonEl.onclick = function () { quickFixMetadataFiles(active.id, [f]); };
    rows.appendChild(row);
  });
}

function getFileFolderPath(file) {
  var fp = stripFileUrl((file && file.filePath) || '') || (file && file.filePath) || '';
  return fp.replace(/[^\/\\]+$/, '');
}
function getAlbumFilesForTrack(file) {
  var key = getAlbumKey(file);
  var album = getLibraryIndex().albumsByKey.get(key);
  var files = album ? album.tracks : [];
  return files.length ? files : [file];
}
function pickBestFolderImage(images) {
  if (!images || !images.length) return '';
  var preferred = ['folder', 'cover', 'front', 'artwork', 'album'];
  var sorted = images.slice().sort(function (a, b) {
    var la = a.toLowerCase(), lb = b.toLowerCase();
    var ia = preferred.findIndex(function (p) { return la.indexOf(p) !== -1; });
    var ib = preferred.findIndex(function (p) { return lb.indexOf(p) !== -1; });
    ia = ia === -1 ? 99 : ia;
    ib = ib === -1 ? 99 : ib;
    return ia - ib;
  });
  return sorted[0] || '';
}
async function scanMissingLibraryFiles() {
  if (!window.api.checkLibraryFiles) return;
  var btn = $('tag-health-scan-missing');
  var oldText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Scanning...'; btn.disabled = true; }
  setTagHealthProgress(true, 'Scanning missing files', 0, 1, '');
  try {
    var res = await window.api.checkLibraryFiles(state.musicFiles);
    if (!res || res.ok !== true) throw new Error((res && res.error) || 'The main process rejected the missing-file scan.');
    libraryMissingFilePaths = new Set((res && res.missing) || []);
    missingFileScanComplete = true;
    var root = $('metadata-health-container');
    if (root) root.dataset.filter = 'missing_files';
    setTagHealthProgress(false, '', 1, 1, 'Missing file scan complete: ' + libraryMissingFilePaths.size + ' missing entr' + (libraryMissingFilePaths.size === 1 ? 'y' : 'ies') + '.');
    renderMetadataHealthView();
    showToast('Missing file scan complete.');
    return res;
  } catch (e) {
    console.error(e);
    missingFileScanComplete = false;
    setTagHealthProgress(false, '', 0, 1, 'Missing file scan failed.');
    notifyUser('Missing file scan failed: ' + (e.message || e));
    return null;
  } finally {
    if (btn) { btn.textContent = oldText || 'Scan Missing Files'; btn.disabled = false; }
  }
}

function setMovedFilesState(message, isError) {
  var stateEl = $('moved-files-state');
  if (!stateEl) return;
  stateEl.textContent = message || '';
  stateEl.classList.toggle('error', !!isError);
}

function updateMovedFileSelection() {
  var selected = Array.from(document.querySelectorAll('#moved-files-rows .moved-file-check:checked:not(:disabled)'));
  var count = $('moved-files-selection-count');
  var apply = $('moved-files-apply');
  if (count) count.textContent = selected.length + ' selected';
  if (apply) {
    apply.disabled = movedFileOperation === 'commit' || selected.length === 0;
    apply.textContent = selected.length ? 'Apply ' + selected.length + ' selected' : 'Apply selected';
  }
}

function setMovedFilesModalBusy(busy) {
  var modal = $('moved-files-modal');
  if (!modal) return;
  modal.querySelectorAll('button, input').forEach(function (control) { control.disabled = !!busy || (control.classList.contains('moved-file-check') && !control.dataset.candidateId); });
  var progress = $('moved-files-progress');
  if (progress) progress.hidden = !busy;
  var apply = $('moved-files-apply');
  if (!busy && apply) updateMovedFileSelection();
  modal.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function updateMovedFilesProgress(data) {
  if (!data) return;
  var total = Number(data.total || 0);
  var current = Number(data.current || 0);
  var pct = total ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
  var label = $('moved-files-progress-label');
  var fill = $('moved-files-progress-fill');
  if (label) label.textContent = (data.label || 'Working') + (total ? ' ' + current + '/' + total : '');
  if (fill) fill.style.width = pct + '%';
}

function renderMovedFilesPreview(preview) {
  var rows = $('moved-files-rows');
  var summary = $('moved-files-summary');
  if (!rows || !summary) return;
  rows.replaceChildren();
  var info = preview.summary || {};
  summary.textContent = (info.suggested || 0) + ' suggestions for ' + (info.missing || 0) + ' missing entries in ' + (preview.searchRoot || 'the selected folder') + '. Ambiguous matches stay unchecked.';
  (preview.proposals || []).forEach(function (proposal, index) {
    var row = document.createElement('tr');
    row.className = proposal.ambiguous ? 'ambiguous' : (proposal.candidateId ? 'proposed' : 'unmatched');

    var selectCell = document.createElement('td');
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'moved-file-check';
    checkbox.dataset.candidateId = proposal.candidateId || '';
    checkbox.dataset.highConfidence = proposal.confidence === 'high' && !proposal.ambiguous ? 'true' : 'false';
    checkbox.disabled = !proposal.candidateId;
    checkbox.checked = !!proposal.autoSelected;
    checkbox.setAttribute('aria-label', 'Apply suggestion for ' + (proposal.title || proposal.oldPath || ('missing entry ' + (index + 1))));
    checkbox.addEventListener('change', updateMovedFileSelection);
    selectCell.appendChild(checkbox);
    row.appendChild(selectCell);

    var trackCell = document.createElement('td');
    var title = document.createElement('strong');
    title.textContent = proposal.title || 'Unknown track';
    var meta = document.createElement('span');
    meta.textContent = [proposal.artist || 'Unknown artist', proposal.album || 'Unknown album'].join(' / ');
    trackCell.append(title, meta);
    row.appendChild(trackCell);

    [proposal.oldPath, proposal.newPath].forEach(function (filePath) {
      var pathCell = document.createElement('td');
      var code = document.createElement('code');
      code.textContent = filePath || 'No plausible candidate';
      code.title = filePath || '';
      pathCell.appendChild(code);
      row.appendChild(pathCell);
    });

    var matchCell = document.createElement('td');
    var confidence = document.createElement('strong');
    confidence.className = 'moved-file-confidence ' + (proposal.confidence || 'low');
    confidence.textContent = proposal.candidateId ? (proposal.confidence || 'low') + ' confidence' : 'unmatched';
    var reason = document.createElement('span');
    var reasonParts = (proposal.reasons || []).slice(0, 3);
    if (proposal.ambiguous) reasonParts = ['Ambiguous match'].concat(reasonParts, proposal.ambiguityReasons || []);
    reason.textContent = reasonParts.join('. ') || 'No reliable evidence';
    matchCell.append(confidence, reason);
    row.appendChild(matchCell);
    rows.appendChild(row);
  });
  setMovedFilesState((preview.warnings || []).length ? 'Scan completed with ' + preview.warnings.length + ' warning(s). Inaccessible items were not proposed.' : '', false);
  setMovedFilesModalBusy(false);
  updateMovedFileSelection();
}

async function cancelMovedFileReview() {
  if (movedFileOperation === 'commit') return;
  var preview = movedFilePreview;
  movedFilePreview = null;
  hideModal($('moved-files-modal'));
  if (preview && preview.token && window.api.cancelMovedFilesPreview) {
    try { await window.api.cancelMovedFilesPreview(preview.token); } catch (e) { console.error(e); }
  }
}

async function relinkMissingFilesFromFolder() {
  if (!missingFileScanComplete) { notifyUser('Run Scan Missing Files first, then review moved-file suggestions.'); return; }
  var missingPaths = Array.from(libraryMissingFilePaths);
  if (!missingPaths.length) { notifyUser('No missing library entries were found in the latest scan.'); return; }
  if (!window.api.previewMovedFiles) { notifyUser('Moved-file review needs a full app restart to load the main-process workflow.'); return; }
  if (hasActiveDownloadQueueJobs()) { notifyUser('Wait for queued or active downloads to finish before reviewing moved files.'); return; }
  var scanGeneration = beginLibraryScan();
  if (!scanGeneration) return;
  movedFileOperation = 'preview';
  setTagHealthProgress(true, 'Preparing moved-file review', 0, 0, '');
  try {
    if (movedFilePreview && movedFilePreview.token && window.api.cancelMovedFilesPreview) window.api.cancelMovedFilesPreview(movedFilePreview.token).catch(function () { });
    movedFilePreview = null;
    var result = await window.api.previewMovedFiles(missingPaths);
    if (!libraryScanIsCurrent(scanGeneration)) return;
    if (!result || !result.ok) {
      if (!(result && result.canceled)) notifyUser('Moved-file scan failed: ' + ((result && result.error) || 'unknown error'));
      setTagHealthProgress(false, '', 0, 0, result && result.canceled ? 'Moved-file search canceled.' : 'Moved-file search failed.');
      return;
    }
    movedFilePreview = result;
    renderMovedFilesPreview(result);
    setTagHealthProgress(false, '', result.summary && result.summary.candidates || 0, result.summary && result.summary.candidates || 0, 'Moved-file review ready: ' + ((result.summary && result.summary.suggested) || 0) + ' suggestion(s).');
    showModal($('moved-files-modal'), { initialFocus: '#moved-files-select-high' });
  } catch (e) {
    if (!libraryScanIsCurrent(scanGeneration)) return;
    console.error(e);
    setTagHealthProgress(false, '', 0, 0, 'Moved-file search failed.');
    notifyUser('Moved-file scan failed: ' + (e.message || e));
  } finally {
    movedFileOperation = '';
    finishLibraryScan();
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
  }
}
function initRadioLibraryControls() {

}
