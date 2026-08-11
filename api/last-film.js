// Returns the current user's last watched film
// Works cross-device: if user watched on Mini App, browser shows resume card
const { getUser, getUserByUsername, getAllUsers } = require('./_lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    let user = null;

    // 1. Try initData (Mini App)
    if (body.initData) {
      try {
        const params = new URLSearchParams(body.initData);
        const userJson = params.get('user');
        if (userJson) {
          const tgUser = JSON.parse(userJson);
          user = await getUser(String(tgUser.id));
          if (!user) {
            // Try by username
            user = await getUserByUsername(tgUser.username);
          }
        }
      } catch (_) {}
    }

    // 2. Try by username (browser OIDC)
    if (!user && body.username) {
      user = await getUserByUsername(body.username);
    }

    // 3. Try by userId
    if (!user && body.userId) {
      user = await getUser(String(body.userId));
      if (!user) {
        // Maybe userId is OIDC sub, try by searching
        const allUsers = await getAllUsers();
        user = allUsers.find(u => u.telegram_id === body.userId);
      }
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
      film: user.last_film,
      user_id: user.telegram_id,
      username: user.username
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
