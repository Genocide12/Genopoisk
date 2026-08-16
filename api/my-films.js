// Returns the user's watched films list, favorites, and search history
// Uses telegram_id (Bot API user.id) as the canonical key — same for both
// Mini App (initData → user.id) and Browser OIDC (id_token.id stored as tg_id).

const { getUser, getUserByOidcSub } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    let telegramId = null;

    // 1) Mini App: parse initData → user.id (Bot API ID)
    if (body.initData) {
      try {
        const params = new URLSearchParams(body.initData);
        const userJson = params.get('user');
        if (userJson) telegramId = String(JSON.parse(userJson).id);
      } catch (_) {}
    }

    // 2) Browser: use body.userId (Bot API ID, set by OIDC callback)
    if (!telegramId && body.userId) {
      telegramId = String(body.userId);
    }

    // 3) Legacy fallback: if userId is a long OIDC sub, resolve via oidc_sub
    if (telegramId && telegramId.length > 12) {
      const resolved = await getUserByOidcSub(telegramId);
      if (resolved) telegramId = resolved.telegram_id;
    }

    if (!telegramId) return res.status(200).json({ films: [] });

    const user = await getUser(telegramId);
    if (!user) return res.status(200).json({ films: [] });

    return res.status(200).json({
      films: user.watched_films || [],
      favorites: user.favorite_films || [],
      search_history: user.search_history || [],
      user_id: telegramId,
      username: user.username,
      is_premium: !!(user.is_premium || (user.events_by_type && user.events_by_type.premium))
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
