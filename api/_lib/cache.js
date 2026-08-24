// Distributed cache — Vercel KV / Upstash Redis with in-memory fallback.
//
// Uses @vercel/kv if KV_REST_API_URL + KV_REST_API_TOKEN are set (free tier
// on Vercel Hobby: 256MB, 30K commands/month). Falls back to in-memory
// Map for local dev or when KV is not configured.
//
// Usage:
//   const cache = require('./_lib/cache');
//   await cache.set('key', value, 300); // TTL 300s
//   const val = await cache.get('key'); // null if expired/missing

const HAS_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory fallback (per-instance, persists on warm lambdas)
const memCache = new Map();

async function get(key) {
  if (HAS_KV) {
    try {
      const res = await fetch(process.env.KV_REST_API_URL + '/get/' + encodeURIComponent(key), {
        headers: { 'Authorization': 'Bearer ' + process.env.KV_REST_API_TOKEN }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.result === null) return null;
      try { return JSON.parse(data.result); } catch (_) { return data.result; }
    } catch (e) {
      console.warn('[cache] KV get failed, falling back to memory:', e.message);
    }
  }
  // Memory fallback
  const entry = memCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry.value;
}

async function set(key, value, ttlSeconds) {
  if (HAS_KV) {
    try {
      const body = ttlSeconds
        ? JSON.stringify(['SET', key, JSON.stringify(value), 'EX', ttlSeconds])
        : JSON.stringify(['SET', key, JSON.stringify(value)]);
      const res = await fetch(process.env.KV_REST_API_URL + '/pipeline', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.KV_REST_API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: body
      });
      if (!res.ok) console.warn('[cache] KV set failed:', res.status);
      return;
    } catch (e) {
      console.warn('[cache] KV set failed, falling back to memory:', e.message);
    }
  }
  // Memory fallback
  memCache.set(key, {
    value: value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
  });
  // Cleanup: limit memory cache to 500 entries
  if (memCache.size > 500) {
    const oldest = memCache.keys().next().value;
    memCache.delete(oldest);
  }
}

async function del(key) {
  if (HAS_KV) {
    try {
      await fetch(process.env.KV_REST_API_URL + '/del/' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.KV_REST_API_TOKEN }
      });
      return;
    } catch (e) {
      console.warn('[cache] KV del failed:', e.message);
    }
  }
  memCache.delete(key);
}

module.exports = { get, set, del, HAS_KV };
