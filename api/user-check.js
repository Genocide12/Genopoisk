// Check if user still exists (after "logout all devices")
// Uses telegram_id (Bot API user.id) as the canonical key.
//
// Both Mini App and Browser now use the same telegram_id, so a single lookup
// is sufficient. Legacy fallbacks via oidc_sub / username are kept for safety.

const { getUser, getUserByOidcSub, getUserByUsername } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const userId = body.userId;
    const username = body.username;
    const hasInitData = !!body.initData;

    if (!userId && !username) return res.status(200).json({ reauth: false });
    if (hasInitData) return res.status(200).json({ reauth: false });

    // Try by telegram_id (Bot API ID)
    let user = null;
    if (userId) user = await getUser(userId);

    // Legacy fallback: userId might be a long OIDC sub
    if (!user && userId && userId.length > 12) {
      const resolved = await getUserByOidcSub(userId);
      if (resolved) user = resolved;
    }

    // Last fallback: by username (very old data)
    if (!user && username) user = await getUserByUsername(username);

    // If user not found BUT has username → DON'T reauth (profile will be created on next track)
    if (!user && username) {
      return res.status(200).json({ reauth: false });
    }

    if (!user) {
      return res.status(200).json({ reauth: true });
    }

    return res.status(200).json({ reauth: false });
  } catch (e) {
    return res.status(200).json({ reauth: false });
  }
};
