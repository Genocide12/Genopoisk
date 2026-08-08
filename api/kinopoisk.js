// Server-side proxy for Kinopoisk API — hides the API key from the browser
// Routes: rewritten from /api/kinopoisk/<path>?<query> to /api/kinopoisk?q=<path>&<query>
// Forwards to: https://kinopoiskapiunofficial.tech/api/<path>?<query>

const KINOPOISK_API_KEY = process.env.KINOPOISK_API_KEY;
const KINOPOISK_BASE = 'https://kinopoiskapiunofficial.tech/api';

// Simple in-memory cache (per-instance, lasts for warm function lifetime)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

module.exports = async (req, res) => {
  // CORS for browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!KINOPOISK_API_KEY) {
    console.error('KINOPOISK_API_KEY env var is not set');
    return res.status(500).json({ error: 'Server misconfigured: missing API key' });
  }

  // req.query.q contains the path portion (e.g., "v2.2/films/top" or "v2.1/films/search-by-keyword")
  // Other query params (type, page, keyword, etc.) come from the original request
  const query = req.query || {};
  const path = query.q || '';

  if (!path) {
    return res.status(400).json({
      error: 'Missing path',
      usage: '/api/kinopoisk/v2.2/films/top?type=TOP_250_BEST_FILMS&page=1'
    });
  }

  // Sanitize path: only allow alphanumeric, slashes, dashes, underscores, dots
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

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'X-API-KEY': KINOPOISK_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Genopoisk/1.0 (Vercel serverless)'
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error(`Kinopoisk API ${upstream.status}: ${text.slice(0, 200)}`);
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
    console.error('Proxy error:', e.message);
    return res.status(502).json({ error: 'Bad gateway', message: e.message });
  }
};
