// Returns the current user's last watched film (cross-device resume).
//
// Auth (via api/_lib/auth.js):
//   - Mini App: initData signature is VERIFIED.
//   - Browser: tg_session cookie (signed HMAC) verified, OR body.userId.
//   - Guest web_* IDs are accepted — they have their own Supabase row.

const { getUser, getUserByOidcSub } = require('./_lib/supabase');
const { extractVerifiedUser } = require('./_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const auth = extractVerifiedUser(body, req);

    let user = null;
    let telegramId = auth.telegramId;

    // Legacy fallback: long OIDC sub → resolve via oidc_sub.
    // Skip for web_* guest IDs (they're not OIDC subs — avoids a wasted DB query).
    if (telegramId && telegramId.length > 12 && !telegramId.startsWith('web_') && auth.source === 'browser') {
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
    console.error('[last-film] error:', e);
    return res.status(500).json({ error: 'internal_error' });
  }
};
