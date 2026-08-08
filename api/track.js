// Tracking endpoint — receives events from the site
const { recordEvent } = require('../_lib/stats');

const ALLOWED_TYPES = ['page_views', 'searches', 'movies_opened', 'categories_opened'];

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
      // We don't validate HMAC here for simplicity — add later if needed
      try {
        const params = new URLSearchParams(body.initData);
        const userJson = params.get('user');
        if (userJson) {
          const u = JSON.parse(userJson);
          userId = String(u.id);
          username = u.username;
        }
      } catch (_) {}
    } else if (body.userId) {
      userId = String(body.userId);
    }

    const payload = {
      userId,
      username,
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
