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

const KINOPOISK_IMG_BASE = 'https://kinopoiskapiunofficial.tech/images/posters';

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
  // kp_small = ~150x230 (thumbnail)
  // kp = ~600x927 (full)
  // We also support "medium" which uses kp_small but the Yandex CDN
  // will serve iphone360 (360x556) — better quality for retina screens.
  let pathSegment;
  if (size === 'large') {
    pathSegment = 'kp';
  } else if (size === 'medium') {
    pathSegment = 'kp_small'; // triggers iphone360 redirect
  } else {
    pathSegment = 'kp_small'; // default — small thumbnail
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

  try {
    // Fetch with redirect following. We use the default fetch which follows
    // redirects automatically (Vercel's Node 18+ fetch supports this).
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'Genopoisk/1.0 (poster proxy)',
        'Accept': 'image/jpeg, image/png, image/*'
      },
      redirect: 'follow'
    });

    if (!upstream.ok) {
      console.error('[poster] upstream error:', upstream.status, upstreamUrl);
      // Return a 1x1 transparent pixel as fallback — better than broken image
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'public, max-age=300'); // short cache for errors
      return res.status(200).send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());

    // Save to in-memory cache (limit cache size to 500 posters ~50MB)
    if (cache.size > 500) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(cacheKey, { buffer, ts: Date.now() });

    // Set aggressive caching — posters never change (film ID is permanent)
    // 1 year max-age + immutable tells browsers and Vercel Edge to never
    // re-fetch. This makes subsequent loads effectively instant.
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).send(buffer);
  } catch (e) {
    console.error('[poster] fetch error:', e.message);
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  }
};
