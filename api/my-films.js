// Returns the user's watched films list
const { getUser, getUserByUsername } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    let telegramId = null;

    if (body.initData) {
      try {
        const params = new URLSearchParams(body.initData);
        const userJson = params.get('user');
        if (userJson) telegramId = String(JSON.parse(userJson).id);
      } catch (_) {}
    }

    if (!telegramId && body.userId && body.username) {
      const user = await getUserByUsername(body.username);
      if (user) telegramId = user.telegram_id;
    }

    if (!telegramId && body.userId) {
      telegramId = String(body.userId);
    }

    if (!telegramId) return res.status(200).json({ films: [] });

    const user = await getUser(telegramId);
    if (!user) return res.status(200).json({ films: [] });

    return res.status(200).json({
      films: user.watched_films || [],
      user_id: telegramId,
      username: user.username
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
