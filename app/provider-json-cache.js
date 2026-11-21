'use strict';

function createProviderJsonCache(fetchJson) {
  const cache = new Map();
  const pending = new Map();
  let tail = Promise.resolve();
  let nextAt = 0;
  return function request(path, validate, ttl = 3600000, { refresh = false } = {}) {
    const key = refresh ? Symbol(path) : path;
    const cached = cache.get(path);
    if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    if (pending.has(key)) return pending.get(key);
    const task = tail.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const delay = nextAt - Date.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        nextAt = Date.now() + 1000;
        try {
          const value = validate(await fetchJson(path));
          cache.set(path, { value, expires: Date.now() + ttl });
          if (cache.size > 200) cache.delete(cache.keys().next().value);
          return value;
        } catch (error) {
          if (attempt || !/HTTP (429|502|503|504)/.test(error.message)) throw error;
          nextAt = Math.max(nextAt, Date.now() + 2000);
        }
      }
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    tail = task.catch(() => {});
    return task;
  };
}

module.exports = { createProviderJsonCache };
