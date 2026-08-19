// Check if user still exists (after "logout all devices").
//
// Auth:
//   - Mini App: initData signature is VERIFIED via api/_lib/auth.js.
//     If initData is valid, user is logged in — never force reauth.
//   - Browser: body.userId is accepted (must NOT start with "web_").
//
// IMPORTANT: this endpoint is what powers "logout all devices". When the
// admin deletes all users, every browser that calls this endpoint must
// detect that its user is gone and clear localStorage. So we MUST return
// reauth: true when the user is truly missing — no exceptions.

const { getUser, getUserByOidcSub } = require('./_lib/supabase');
const { extractVerifiedUser } = require('./_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const auth = extractVerifiedUser(body, req);

    // No identifiers at all → not logged in, nothing to clear
    if (!auth.telegramId) return res.status(200).json({ reauth: false });

    // Mini App initData is always valid (signed by Telegram) — don't log out
    if (auth.source === 'miniapp') return res.status(200).json({ reauth: false });

    // Try by telegram_id (Bot API ID — canonical key after auth fix)
    let user = null;
    if (auth.telegramId) user = await getUser(auth.telegramId);

    // Legacy fallback: userId might be a long OIDC sub from an old session
    if (!user && auth.telegramId && auth.telegramId.length > 12) {
      const resolved = await getUserByOidcSub(auth.telegramId);
      if (resolved) user = resolved;
    }

    // User not found → force reauth. This is what makes "logout all" work:
    // browser sees reauth:true, clears localStorage, reloads, shows login bar.
    if (!user) {
      return res.status(200).json({ reauth: true });
    }

    return res.status(200).json({ reauth: false });
  } catch (e) {
    // On error, don't log out the user (avoid surprise logouts on transient failures)
    console.error('[user-check] error:', e);
    return res.status(200).json({ reauth: false });
  }
};
