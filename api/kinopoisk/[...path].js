// Server-side proxy for Kinopoisk API — hides the API key from the browser
// All requests to /api/kinopoisk/* are forwarded to https://kinopoiskapiunofficial.tech/api/*

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

  // Extract the path after /api/kinopoisk/
  // req.url looks like: /v2.2/films/top?type=TOP_250_BEST_FILMS&page=1
  const path = req.url || '';

  // Build target URL
  const targetUrl = `${KINOPOISK_BASE}${path}`;

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

    // Save to cache
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
