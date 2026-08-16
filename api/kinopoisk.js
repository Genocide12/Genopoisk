// Server-side proxy for Kinopoisk API — hides API keys from the browser.
//
// Multi-key support: set KINOPOISK_API_KEYS to a comma-separated list of
// keys, OR set KINOPOISK_API_KEY for a single key (backwards-compatible).
// When a key returns 429 (rate limit) or 402 (payment required), we mark
// it as exhausted and try the next one. Exhausted keys are skipped for
// the remainder of the lambda instance lifetime (typically ~5 min on
// Vercel), then retried again on the next cold start.
//
// Frontend calls: /api/kinopoisk?q=v2.2/films/top&type=TOP_250_BEST_FILMS&page=1
// Forwards to: https://kinopoiskapiunofficial.tech/api/v2.2/films/top?type=...

const KINOPOISK_BASE = 'https://kinopoiskapiunofficial.tech/api';

// Build the list of API keys from env vars.
function loadApiKeys() {
  const keys = [];
  // KINOPOISK_API_KEYS (preferred) — comma-separated list
  if (process.env.KINOPOISK_API_KEYS) {
    process.env.KINOPOISK_API_KEYS.split(',').forEach(k => {
      const trimmed = k.trim();
      if (trimmed) keys.push(trimmed);
    });
  }
  // KINOPOISK_API_KEY (legacy single key) — append if not already in list
  if (process.env.KINOPOISK_API_KEY) {
    const single = process.env.KINOPOISK_API_KEY.trim();
    if (single && keys.indexOf(single) === -1) keys.push(single);
  }
  return keys;
}

const API_KEYS = loadApiKeys();

// In-memory cache (per-instance, lasts for warm function lifetime)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Track which keys are currently exhausted (rate-limited). Maps key →
// timestamp when it can be retried. We use a cooldown of 5 minutes — after
// that we try the key again (the daily quota may not have reset, but the
// per-second/minute rate limit might have).
const exhaustedKeys = new Map(); // key → expiry timestamp
const EXHAUSTION_COOLDOWN = 5 * 60 * 1000; // 5 minutes

// Index of the key to try next (round-robin when no exhaustion).
let nextKeyIndex = 0;

function pickNextAvailableKey() {
  if (API_KEYS.length === 0) return null;
  const now = Date.now();
  // Clean up expired exhaustions
  for (const [k, expiry] of exhaustedKeys.entries()) {
    if (expiry < now) exhaustedKeys.delete(k);
  }
  // Try keys in round-robin order, skipping exhausted ones
  for (let i = 0; i < API_KEYS.length; i++) {
    const idx = (nextKeyIndex + i) % API_KEYS.length;
    const key = API_KEYS[idx];
    if (!exhaustedKeys.has(key)) {
      nextKeyIndex = (idx + 1) % API_KEYS.length;
      return key;
    }
  }
  // All keys exhausted — return the one with the soonest expiry as a
  // last resort (better to try than to fail outright).
  let best = null;
  let bestExpiry = Infinity;
  for (const [k, expiry] of exhaustedKeys.entries()) {
    if (expiry < bestExpiry) {
      bestExpiry = expiry;
      best = k;
    }
  }
  return best || API_KEYS[0];
}

function markKeyExhausted(key) {
  exhaustedKeys.set(key, Date.now() + EXHAUSTION_COOLDOWN);
  console.warn('[kinopoisk] Key', key.slice(0, 8) + '... marked exhausted until', new Date(Date.now() + EXHAUSTION_COOLDOWN).toISOString());
}

function isExhaustionStatus(status) {
  // 429 = Too Many Requests (rate limit)
  // 402 = Payment Required (subscription expired / quota exceeded)
  // NOTE: 403 is NOT treated as exhaustion anymore — Kinopoisk returns 403
  // for two very different reasons:
  //   1. Invalid/expired API key (should mark as exhausted)
  //   2. Blocked IP (VPN, proxy, hosting provider) — the key is FINE, the
  //      request just came from a blocked IP. Marking the key as exhausted
  //      here would waste all our keys on a single VPN-user request.
  // Since we can't reliably tell (1) from (2) from the status alone, we
  // treat 403 as a transient error: return to client with a clear message,
  // do NOT mark the key as exhausted. If the key is truly invalid, the
  // same key will keep failing and the user will see repeated errors —
  // that's a problem the admin needs to investigate manually.
  return status === 429 || status === 402;
}

module.exports = async (req, res) => {
  // CORS for browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (API_KEYS.length === 0) {
    console.error('[kinopoisk] No API keys configured (set KINOPOISK_API_KEYS or KINOPOISK_API_KEY)');
    return res.status(500).json({ error: 'Server misconfigured: no API keys' });
  }

  const query = req.query || {};
  const path = query.q || '';
  if (!path) {
    return res.status(400).json({
      error: 'Missing path',
      usage: '/api/kinopoisk/v2.2/films/top?type=TOP_250_BEST_FILMS&page=1'
    });
  }
  // Sanitize path
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(path)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // Rebuild query string from all params except `q`
  const otherParams = Object.entries(query)
    .filter(([k]) => k !== 'q')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const targetUrl = `${KINOPOISK_BASE}/${path.replace(/^\//, '')}${otherParams ? '?' + otherParams : ''}`;

  // Check cache
  const cacheKey = targetUrl;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(cached.data);
  }

  // Try each available key until one works or all are exhausted.
  // We try at most API_KEYS.length times (each key once per request).
  const triedKeys = new Set();
  let lastError = null;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = pickNextAvailableKey();
    if (!apiKey || triedKeys.has(apiKey)) continue;
    triedKeys.add(apiKey);

    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'Genopoisk/1.0 (Vercel serverless)'
        }
      });

      // If the key is rate-limited, mark it and try the next one
      if (isExhaustionStatus(upstream.status)) {
        const body = await upstream.text();
        console.warn(`[kinopoisk] Key ${apiKey.slice(0, 8)}... got ${upstream.status}: ${body.slice(0, 200)}`);
        markKeyExhausted(apiKey);
        lastError = { status: upstream.status, message: body.slice(0, 200) };
        continue;
      }

      if (!upstream.ok) {
        const text = await upstream.text();
        console.error(`[kinopoisk] Key ${apiKey.slice(0, 8)}... got ${upstream.status}: ${text.slice(0, 200)}`);

        // 403 — Kinopoisk blocks the IP (VPN, proxy, or rate-limit).
        // Try the next API key — different keys may route through different
        // Kinopoisk backend nodes, one of them might accept the request.
        // Only return 403 to client if ALL keys fail.
        if (upstream.status === 403) {
          markKeyExhausted(apiKey);
          lastError = { status: 403, message: 'Kinopoisk API 403 (IP blocked or rate-limited)' };
          continue; // try next key
        }

        // Other errors (404, 500, etc.) — return to client, don't try other keys
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(upstream.status).json({
          error: `Kinopoisk API ${upstream.status}`,
          message: upstream.statusText
        });
      }

      const data = await upstream.json();

      // Save to cache (limit cache size)
      if (cache.size > 100) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
      cache.set(cacheKey, { data, ts: Date.now() });

      res.setHeader('X-Cache', 'MISS');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).json(data);
    } catch (e) {
      console.error(`[kinopoisk] Key ${apiKey.slice(0, 8)}... fetch error:`, e.message);
      lastError = { status: 502, message: e.message };
      // Network error — try next key
      continue;
    }
  }

  // All keys exhausted or all returned 403
  console.error('[kinopoisk] All API keys failed. tried:', triedKeys.size, 'of', API_KEYS.length, 'lastError:', lastError);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // If last error was 403, return 403 (IP blocked); otherwise 429 (rate limit)
  const finalStatus = (lastError && lastError.status === 403) ? 403 : 429;
  const finalMessage = (finalStatus === 403)
    ? 'Кинопоиск заблокировал запрос. Попробуйте позже или отключите VPN.'
    : 'Попробуйте позже — лимит запросов исчерпан. ' + API_KEYS.length + ' ключ(ей) были использованы.';
  return res.status(finalStatus).json({
    error: 'Kinopoisk API unavailable',
    message: finalMessage,
    tried: triedKeys.size,
    total: API_KEYS.length
  });
};
