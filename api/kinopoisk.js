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
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes — reduces Kinopoisk API calls

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

  // ====== Multi-threaded parallel key racing with fallback ======
  // First batch: race 3 keys in parallel via Promise.any.
  // If ALL 3 fail → fall back to second batch with the remaining keys.
  // This handles both failure modes:
  //   - 429 (rate-limit): different keys have independent quotas, so
  //     remaining keys likely still work
  //   - 403 (IP block): all keys share the same Vercel egress IP, so
  //     second batch may also fail — but at least we tried
  //
  // Per-request timeout: 6s. Promise.any returns as soon as one resolves.
  const REQUEST_TIMEOUT_MS = 6000;

  // Realistic browser headers — Kinopoisk's edge (Cloudflare) returns 403
  // for bot-like User-Agents such as "Mozilla/5.0 (compatible; ...)".
  const BROWSER_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Referer': 'https://kinopoisk.ru/',
    'Origin': 'https://kinopoisk.ru'
  };

  // Helper: race a batch of keys, return first successful or null on all-fail
  async function raceBatch(keys) {
    if (keys.length === 0) return null;
    const controllers = keys.map(() => new AbortController());
    const promises = keys.map((apiKey, idx) => {
      const headers = Object.assign({}, BROWSER_HEADERS, { 'X-API-KEY': apiKey });
      const ctrl = controllers[idx];
      const timeoutId = setTimeout(() => {
        try { ctrl.abort(); } catch (_) {}
      }, REQUEST_TIMEOUT_MS);

      return fetch(targetUrl, {
        headers,
        signal: ctrl.signal
      }).then(async (upstream) => {
        clearTimeout(timeoutId);

        // Rate-limited or payment required → mark key exhausted, throw
        if (isExhaustionStatus(upstream.status)) {
          const body = await upstream.text();
          console.warn(`[kinopoisk] Key ${apiKey.slice(0, 8)}... got ${upstream.status}: ${body.slice(0, 200)}`);
          markKeyExhausted(apiKey);
          throw new Error(`Key ${apiKey.slice(0, 8)} exhausted (${upstream.status})`);
        }

        if (!upstream.ok) {
          const text = await upstream.text();
          console.warn(`[kinopoisk] Key ${apiKey.slice(0, 8)}... got ${upstream.status}: ${text.slice(0, 200)}`);
          if (upstream.status === 403) {
            throw new Error(`Key ${apiKey.slice(0, 8)} IP blocked (403)`);
          }
          throw new Error(`Key ${apiKey.slice(0, 8)} HTTP ${upstream.status}`);
        }

        const data = await upstream.json();
        return { data, winnerIdx: idx, key: apiKey };
      }).catch((e) => {
        clearTimeout(timeoutId);
        throw e;
      });
    });

    try {
      const w = await Promise.any(promises);
      // Abort any still-pending losers
      controllers.forEach(c => { try { c.abort(); } catch (_) {} });
      return w;
    } catch (aggErr) {
      // All promises in this batch rejected
      controllers.forEach(c => { try { c.abort(); } catch (_) {} });
      console.warn('[kinopoisk] Batch failed:',
        (aggErr.errors || []).map(e => e.message).join(' | '));
      return null;
    }
  }

  // First batch: pick 3 available keys (round-robin, skipping exhausted)
  const firstBatch = [];
  for (let i = 0; i < Math.min(3, API_KEYS.length); i++) {
    const k = pickNextAvailableKey();
    if (k) firstBatch.push(k);
  }
  if (firstBatch.length === 0) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(429).json({
      error: 'All API keys exhausted',
      message: 'Попробуйте позже — все ключи исчерпаны.'
    });
  }

  let winner = await raceBatch(firstBatch);

  // Fallback: if first batch failed, try the remaining keys
  if (!winner) {
    const usedSet = new Set(firstBatch);
    const remainingKeys = API_KEYS.filter(k => !usedSet.has(k) && !exhaustedKeys.has(k));
    if (remainingKeys.length > 0) {
      console.warn('[kinopoisk] First batch of ' + firstBatch.length + ' keys failed, trying ' + remainingKeys.length + ' remaining keys as fallback');
      winner = await raceBatch(remainingKeys.slice(0, 3));
    }
  }

  if (!winner) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(429).json({
      error: 'Kinopoisk API unavailable',
      message: 'Попробуйте позже — все ключи вернули ошибку. ' +
               'Возможно, Кинопоиск заблокировал IP — отключите VPN или попробуйте через минуту.',
      tried: API_KEYS.length,
      total: API_KEYS.length
    });
  }

  // Save to cache (limit cache size)
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(cacheKey, { data: winner.data, ts: Date.now() });

  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Race-Winner', winner.key.slice(0, 8));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).json(winner.data);
};
