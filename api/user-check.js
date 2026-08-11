// Check if user still exists (after "logout all devices")
const { getUser, getUserByUsername } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const userId = body.userId;
    const hasInitData = !!body.initData;

    if (!userId) return res.status(200).json({ reauth: false });
    if (hasInitData) return res.status(200).json({ reauth: false }); // Mini App always auth'd

    // Try by telegram_id first
    let user = await getUser(userId);
    
    // Try by username if not found
    if (!user && body.username) {
      user = await getUserByUsername(body.username);
    }

    if (!user) {
      console.log('[user-check] User not found, reauth required:', userId);
      return res.status(200).json({ reauth: true });
    }

    return res.status(200).json({ reauth: false });
  } catch (e) {
    return res.status(200).json({ reauth: false });
  }
};
