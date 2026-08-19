// Poster image proxy — fetches film posters through the redirect chain
// (kinopoiskapiunofficial.tech → st.kp.yandex.net → avatars.mds.yandex.net)
// and caches them. Without this, each poster requires 3 HTTP requests
// taking 2-3 seconds. With caching, subsequent loads are instant.
//
// Usage: /api/poster?id=251733&size=small
//   id   = kinopoisk film ID (e.g. 251733)
//   size = "small" (default, ~150x230) | "medium" (~360x556) | "large" (~600x927)
//
// The proxy follows all redirects, fetches the final image bytes, sets
// long-lived Cache-Control headers, and returns the image bytes directly.
// Vercel's Edge Network caches the response globally — first load is slow
// (~2s) but every subsequent load is <50ms.
//
// Uses multiple API keys (from KINOPOISK_API_KEYS env var) to distribute
// load — each request picks a random key, reducing the chance of hitting
// rate limits on any single key.

const KINOPOISK_IMG_BASE = 'https://kinopoiskapiunofficial.tech/images/posters';

// Load API keys — used for poster requests that need authentication.
// The poster endpoint on kinopoiskapiunofficial.tech doesn't actually
// require an API key (it returns 301 without one), but including one
// helps avoid 403 blocks from rate limiting.
function loadApiKeys() {
  const keys = [];
  if (process.env.KINOPOISK_API_KEYS) {
    process.env.KINOPOISK_API_KEYS.split(',').forEach(k => {
      const trimmed = k.trim();
      if (trimmed) keys.push(trimmed);
    });
  }
  if (process.env.KINOPOISK_API_KEY) {
    const single = process.env.KINOPOISK_API_KEY.trim();
    if (single && keys.indexOf(single) === -1) keys.push(single);
  }
  return keys;
}

const API_KEYS = loadApiKeys();
let nextKeyIdx = 0;

// In-memory cache (per lambda instance). Vercel also caches at the edge
// via Cache-Control headers, so this is a secondary cache for warm instances.
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const filmId = (req.query && req.query.id) || '';
  const size = (req.query && req.query.size) || 'small';

  if (!filmId || !/^\d+$/.test(filmId)) {
    return res.status(400).json({ error: 'Invalid or missing film id' });
  }

  // Map size to poster path segment
  let pathSegment;
  if (size === 'large') {
    pathSegment = 'kp';
  } else if (size === 'medium') {
    pathSegment = 'kp';  // Fixed: was 'kp_small' (same as small). Now returns large size.
  } else {
    pathSegment = 'kp_small';
  }

  const upstreamUrl = `${KINOPOISK_IMG_BASE}/${pathSegment}/${filmId}.jpg`;
  const cacheKey = `${filmId}_${size}`;

  // Check in-memory cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('X-Cache', 'HIT-MEMORY');
    return res.status(200).send(cached.buffer);
  }

  // ====== Multi-threaded parallel key racing with fallback ======
  // Same strategy as kinopoisk.js: race 3 keys in parallel, fall back to
  // remaining 3 keys if first batch fails. Reduces poster load failures.
  const REQUEST_TIMEOUT_MS = 6000;

  // Realistic browser headers — bot-like UA gets 403 from Cloudflare.
  const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://kinopoisk.ru/',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site'
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

      return fetch(upstreamUrl, {
        headers,
        redirect: 'follow',
        signal: ctrl.signal
      }).then(async (upstream) => {
        clearTimeout(timeoutId);
        if (!upstream.ok) {
          throw new Error(`Key ${apiKey.slice(0, 6)} HTTP ${upstream.status}`);
        }
        const buffer = Buffer.from(await upstream.arrayBuffer());
        return { buffer, winnerIdx: idx };
      }).catch((e) => {
        clearTimeout(timeoutId);
        throw e;
      });
    });

    try {
      const w = await Promise.any(promises);
      controllers.forEach(c => { try { c.abort(); } catch (_) {} });
      return w;
    } catch (aggErr) {
      controllers.forEach(c => { try { c.abort(); } catch (_) {} });
      console.warn('[poster] Batch failed for', filmId, ':',
        (aggErr.errors || []).map(e => e.message).join(' | '));
      return null;
    }
  }

  // First batch: pick 3 keys round-robin
  const firstBatch = [];
  for (let i = 0; i < Math.min(3, API_KEYS.length); i++) {
    if (API_KEYS.length > 0) {
      firstBatch.push(API_KEYS[(nextKeyIdx + i) % API_KEYS.length]);
    }
  }
  nextKeyIdx = (nextKeyIdx + firstBatch.length) % Math.max(1, API_KEYS.length);

  let winner = await raceBatch(firstBatch);

  // Fallback: if first batch failed, try remaining keys
  if (!winner && API_KEYS.length > firstBatch.length) {
    const usedSet = new Set(firstBatch);
    const remainingKeys = API_KEYS.filter(k => !usedSet.has(k));
    if (remainingKeys.length > 0) {
      console.warn('[poster] First batch failed for', filmId, ', trying', remainingKeys.length, 'remaining keys');
      winner = await raceBatch(remainingKeys.slice(0, 3));
    }
  }

  if (winner) {
    // Save to in-memory cache (limit cache size to 500 posters ~50MB)
    if (cache.size > 500) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(cacheKey, { buffer: winner.buffer, ts: Date.now() });

    // Set aggressive caching
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).send(winner.buffer);
  }

  // All attempts failed — return 1x1 transparent pixel
  console.error('[poster] All attempts failed for', filmId);
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
};
