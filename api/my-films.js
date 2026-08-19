// Returns the user's watched films list, favorites, and search history.
//
// Auth:
//   - Mini App: initData signature is VERIFIED via api/_lib/auth.js.
//     Invalid signatures are rejected — no fallback to body.userId.
//   - Browser: body.userId is accepted (must NOT start with "web_").
//     This path is still vulnerable to IDOR (an attacker who knows a
//     telegram_id can read the victim's data). A session-cookie system
//     would be needed to fully close this — deferred to a later commit.

const { getUser, getUserByOidcSub } = require('./_lib/supabase');
const { extractVerifiedUser } = require('./_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const auth = extractVerifiedUser(body, req);

    let telegramId = auth.telegramId;

    // Legacy fallback: if userId is a long OIDC sub, resolve via oidc_sub.
    // This is for old browser sessions created before the auth migration.
    if (telegramId && telegramId.length > 12 && auth.source === 'browser') {
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
