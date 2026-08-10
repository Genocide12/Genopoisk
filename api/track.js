// Tracking endpoint — receives events from the site
const { recordEvent } = require('./_lib/stats');

const ALLOWED_TYPES = ['page_views', 'searches', 'movies_opened', 'categories_opened'];

function getClientIp(req) {
  // Vercel sets these headers — x-forwarded-for contains client IP first
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  if (req.headers['x-vercel-forwarded-for']) {
    return String(req.headers['x-vercel-forwarded-for']).split(',')[0].trim();
  }
  if (req.headers['x-vercel-ip']) return String(req.headers['x-vercel-ip']);
  return null;
}

// Extract human-readable device name from User-Agent
function getDeviceName(ua) {
  if (!ua) return 'Unknown';
  // iOS
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPod/i.test(ua)) return 'iPod';
  // Android
  if (/Android/i.test(ua)) {
    if (/Mobile/i.test(ua)) return 'Android-Phone';
    return 'Android-Tablet';
  }
  // Windows
  if (/Windows NT 10/i.test(ua)) return 'Windows-10';
  if (/Windows NT 6\.3/i.test(ua)) return 'Windows-8.1';
  if (/Windows NT 6\.2/i.test(ua)) return 'Windows-8';
  if (/Windows NT 6\.1/i.test(ua)) return 'Windows-7';
  // Mac
  if (/Mac OS X/i.test(ua)) return 'Mac';
  // Linux
  if (/Linux/i.test(ua)) return 'Linux';
  // Browser
  if (/Edg/i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Unknown';
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const type = body.type;
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid event type', allowed: ALLOWED_TYPES });
    }

    // Get user identifier (Telegram WebApp initData or fallback)
    let userId = 'anon';
    let username = null;
    if (body.initData) {
      try {
        const params = new URLSearchParams(body.initData);
        const userJson = params.get('user');
        if (userJson) {
          const u = JSON.parse(userJson);
          userId = String(u.id);
          username = u.username;
        }
      } catch (_) {}
    }

    // Capture client IP for per-user stats
    const ip = getClientIp(req);

    // Fallback for browser users: use the stable localStorage ID sent by client.
    // This ID persists across VPN changes (stored in browser localStorage),
    // so user history is preserved regardless of network/IP changes.
    if (userId === 'anon') {
      if (body.userId && typeof body.userId === 'string' && body.userId.startsWith('web_')) {
        // Browser user — check if we can merge with a TG user that has the same IP.
        // This handles the case where user first opened in browser (got web_ ID),
        // then opened in Telegram (got TG ID). We link them by IP.
        userId = String(body.userId);
        const ua = req.headers['user-agent'] || 'unknown';
        const deviceName = getDeviceName(ua);
        username = deviceName + ' (браузер)';
      } else if (body.userId) {
        userId = String(body.userId);
      }
    }

    const payload = {
      userId,
      username,
      ...(ip ? { ip } : {}),
      ...(body.query ? { query: String(body.query).slice(0, 100) } : {}),
      ...(body.title ? { title: String(body.title).slice(0, 100) } : {}),
      ...(body.filmId ? { filmId: String(body.filmId).slice(0, 20) } : {}),
      ...(body.category ? { category: String(body.category).slice(0, 20) } : {})
    };

    await recordEvent(type, payload);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Track error:', e);
    return res.status(500).json({ error: e.message });
  }
};
