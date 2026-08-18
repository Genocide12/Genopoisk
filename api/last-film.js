// Returns the current user's last watched film (cross-device resume).
//
// Auth:
//   - Mini App: initData signature is VERIFIED via api/_lib/auth.js.
//   - Browser: body.userId is accepted (must NOT start with "web_").
//     Still IDOR-vulnerable — see note in api/_lib/auth.js.

const { getUser, getUserByOidcSub } = require('./_lib/supabase');
const { extractVerifiedUser } = require('./_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const auth = extractVerifiedUser(body, process.env.TG_BOT_TOKEN);

    let user = null;
    let telegramId = auth.telegramId;

    // Legacy fallback: long OIDC sub → resolve via oidc_sub
    if (telegramId && telegramId.length > 12 && auth.source === 'browser') {
      const resolved = await getUserByOidcSub(telegramId);
      if (resolved) telegramId = resolved.telegram_id;
    }

    if (telegramId) {
      user = await getUser(telegramId);
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
