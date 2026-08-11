// Check if user still exists (after "logout all devices")
// Uses telegram_id (Bot API user.id) as the canonical key.
//
// Both Mini App and Browser now use the same telegram_id, so a single lookup
// is sufficient. Legacy fallbacks via oidc_sub are kept for safety.
//
// IMPORTANT: this endpoint is what powers "logout all devices". When the admin
// deletes all users, every browser that calls this endpoint must detect that
// its user is gone and clear localStorage. So we MUST return reauth: true
// when the user is truly missing — no exceptions.

const { getUser, getUserByOidcSub } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const userId = body.userId;
    const hasInitData = !!body.initData;

    // No identifiers at all → not logged in, nothing to clear
    if (!userId) return res.status(200).json({ reauth: false });

    // Mini App initData is always valid (signed by Telegram) — don't log out
    if (hasInitData) return res.status(200).json({ reauth: false });

    // Try by telegram_id (Bot API ID — canonical key after auth fix)
    let user = null;
    if (userId) user = await getUser(userId);

    // Legacy fallback: userId might be a long OIDC sub from an old session
    if (!user && userId && userId.length > 12) {
      const resolved = await getUserByOidcSub(userId);
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
