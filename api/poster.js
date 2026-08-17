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

function pickApiKey() {
  if (API_KEYS.length === 0) return null;
  // Round-robin
  const key = API_KEYS[nextKeyIdx % API_KEYS.length];
  nextKeyIdx++;
  return key;
}

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
    pathSegment = 'kp_small';
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

  // Try fetching — attempt up to 3 times with different API keys
  // to handle 403/IP blocks
  const maxAttempts = Math.min(3, Math.max(1, API_KEYS.length));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = pickApiKey();
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; GenopoiskBot/1.0)',
      'Accept': 'image/jpeg, image/png, image/*'
    };
    // Include API key if available — helps avoid 403 from rate limiting
    if (apiKey) {
      headers['X-API-KEY'] = apiKey;
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        headers: headers,
        redirect: 'follow'
      });

      if (upstream.ok) {
        const buffer = Buffer.from(await upstream.arrayBuffer());

        // Save to in-memory cache (limit cache size to 500 posters ~50MB)
        if (cache.size > 500) {
          const oldest = cache.keys().next().value;
          cache.delete(oldest);
        }
        cache.set(cacheKey, { buffer, ts: Date.now() });

        // Set aggressive caching
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        res.setHeader('X-Cache', 'MISS');
        return res.status(200).send(buffer);
      }

      if (upstream.status === 403) {
        // IP blocked — wait 100ms and try next key
        console.warn('[poster] 403 attempt', attempt + 1, 'of', maxAttempts);
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      // Other errors — return fallback immediately
      break;
    } catch (e) {
      console.warn('[poster] fetch error attempt', attempt + 1, ':', e.message);
      // Try next key
      continue;
    }
  }

  // All attempts failed — return 1x1 transparent pixel
  console.error('[poster] All attempts failed for', filmId);
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
};
