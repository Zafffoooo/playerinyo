'use strict';

const { normalizeListenbrainzTrack } = require('./listenbrainz-client');

function createListenbrainzOutbox({ load, save, account, submit, now = Date.now }) {
  let state;
  let tail = Promise.resolve();
  let work;
  let timer;
  let failure = null;

  function serialize(action) {
    const task = tail.then(() => {
      if (!state) {
        const stored = load();
        if (!Array.isArray(stored?.pending) || !Array.isArray(stored?.sent)) throw new Error('Invalid ListenBrainz outbox.');
        state = stored;
      }
      return action();
    });
    tail = task.catch(() => {});
    return task;
  }

  async function commit(next) {
    await save(next);
    state = next;
  }

  function schedule(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => { flush().catch(() => schedule(30000)); }, delay);
    timer.unref();
  }

  function flush() {
    if (work) return work;
    const current = account();
    work = (async () => {
      if (!current) return;
      if (failure?.token === current.token) {
        if (!Number.isFinite(failure.until)) return;
        if (failure.until > now()) {
          schedule(failure.until - now());
          return;
        }
      }
      const row = await serialize(() => state.pending.find(item => item.username === current.username && !item.rejected));
      if (!row || account()?.token !== current.token) return;
      try {
        if (!await submit(current.token, row.track, () => account()?.token === current.token)) throw new Error('ListenBrainz did not accept the listen.');
      } catch (error) {
        if (account()?.token !== current.token) return;
        if ([400, 422].includes(error.status)) {
          await serialize(() => commit({ ...state, pending: state.pending.map(item => item.key === row.key ? { ...item, rejected: true } : item) }));
          schedule();
          return;
        }
        const auth = [401, 403].includes(error.status);
        const delay = Math.max(30000, error.retryAfterMs || 0, failure?.token === current.token ? Math.min(900000, (failure.delay || 0) * 2) : 0);
        failure = { rateLimited: error.status === 429, token: current.token, until: auth ? Infinity : now() + delay, delay };
        if (!auth) schedule(delay);
        return;
      }
      await serialize(() => commit({
        pending: state.pending.filter(item => item.key !== row.key),
        sent: [...state.sent.filter(item => item.username !== row.username), { username: row.username, at: now() }],
      }));
      failure = null;
      schedule();
    })().finally(() => {
      work = null;
      if (current?.token !== account()?.token) schedule();
    });
    return work;
  }

  return {
    wake(reset = false) {
      if (reset && !Number.isFinite(failure?.until)) failure = null;
      schedule();
    },
    async enqueue(raw) {
      const current = account();
      const track = normalizeListenbrainzTrack(raw, false, now());
      if (!current || !track || (raw.username && raw.username !== current.username)) return false;
      const key = JSON.stringify([current.username, track.startedAtSeconds, track.title]);
      await serialize(async () => {
        if (state.pending.some(row => row.key === key)) return;
        await commit({ ...state, pending: [...state.pending, { key, username: current.username, track }] });
      });
      schedule();
      return true;
    },
    status() {
      return serialize(() => {
        const current = account();
        if (!current) return null;
        const rows = state.pending.filter(row => row.username === current.username);
        return {
          pending: rows.filter(row => !row.rejected).length,
          rejected: rows.filter(row => row.rejected).length,
          lastSentAt: state.sent.find(row => row.username === current.username)?.at || 0,
          reconnect: failure?.token === current.token && failure.until === Infinity,
        };
      });
    },
    retry() {
      if (failure && Number.isFinite(failure.until) && !failure.rateLimited) failure.until = now();
      return flush();
    },
    flush,
  };
}

module.exports = { createListenbrainzOutbox };
