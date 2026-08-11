// Check if user still exists in stats (after "logout all devices")
// If not, tell the browser to clear localStorage and show login bar.
const { readStats } = require('./_lib/stats');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const userId = body.userId;
    const hasInitData = !!body.initData;

    if (!userId) {
      return res.status(200).json({ reauth: false });
    }

    // Mini App users (has initData) are always authenticated via Telegram
    // — no need to reauth even if stats were cleared
    if (hasInitData) {
      return res.status(200).json({ reauth: false });
    }

    // Browser users: check if their stored ID still exists in stats
    const stats = await readStats();
    const userExists = stats.users && stats.users[userId];

    if (!userExists) {
      // User was deleted (logout all devices) → browser must reauth
      console.log('[user-check] User not found, reauth required:', userId);
      return res.status(200).json({ reauth: true });
    }

    return res.status(200).json({ reauth: false });
  } catch (e) {
    console.error('[user-check] error:', e);
    return res.status(200).json({ reauth: false });
  }
};
