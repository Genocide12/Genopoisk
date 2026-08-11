// Returns the current user's last watched film
const { getUser, getUserByUsername } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    let telegramId = null;

    // Try initData
    if (body.initData) {
      try {
        const params = new URLSearchParams(body.initData);
        const userJson = params.get('user');
        if (userJson) {
          telegramId = String(JSON.parse(userJson).id);
        }
      } catch (_) {}
    }

    // Try by username
    if (!telegramId && body.userId && body.username) {
      const user = await getUserByUsername(body.username);
      if (user) telegramId = user.telegram_id;
    }

    // Fallback to userId
    if (!telegramId && body.userId) {
      telegramId = String(body.userId);
    }

    if (!telegramId) return res.status(200).json({ film: null });

    const user = await getUser(telegramId);
    if (!user || !user.last_film) return res.status(200).json({ film: null });

    return res.status(200).json({ film: user.last_film, user_id: telegramId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
