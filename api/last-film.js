// Returns the current user's last watched film
// Works cross-device: if user watched on Mini App, browser shows resume card
// with the position saved from the other device.
//
// Both Mini App and Browser now resolve to the SAME user record because both
// use the Bot API user.id as telegram_id (Browser receives it via OIDC id_token.id).

const { getUser, getUserByOidcSub } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    let user = null;

    // 1) Mini App: parse initData → user.id (Bot API ID)
    if (body.initData) {
      try {
        const params = new URLSearchParams(body.initData);
        const userJson = params.get('user');
        if (userJson) {
          const tgUser = JSON.parse(userJson);
          user = await getUser(String(tgUser.id));
        }
      } catch (_) {}
    }

    // 2) Browser: use body.userId (Bot API ID, set by OIDC callback)
    if (!user && body.userId) {
      const userId = String(body.userId);
      // Skip web_* IDs — they are guest browser IDs, no real user behind them
      if (userId.startsWith('web_')) {
        return res.status(200).json({ film: null });
      }
      // Try by telegram_id first
      user = await getUser(userId);
      // Legacy fallback: if userId is a long OIDC sub, try resolving via oidc_sub
      if (!user && userId.length > 12) {
        const resolved = await getUserByOidcSub(userId);
        if (resolved) user = await getUser(resolved.telegram_id);
      }
    }

    if (!user || !user.last_film) {
      return res.status(200).json({ film: null });
    }

    // Check if film was watched within last 48h
    const age = Date.now() - new Date(user.last_film.ts).getTime();
    if (age > 48 * 60 * 60 * 1000) {
      return res.status(200).json({ film: null });
    }

    return res.status(200).json({
      film: {
        filmId: user.last_film.filmId,
        title: user.last_film.title,
        ts: user.last_film.ts,
        position: typeof user.last_film.position === 'number' ? user.last_film.position : 0,
        duration: typeof user.last_film.duration === 'number' ? user.last_film.duration : 0
      },
      user_id: user.telegram_id,
      username: user.username
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
