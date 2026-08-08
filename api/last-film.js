// Returns the current user's last watched film (for "Continue watching" feature)
// Identifies the user by Telegram WebApp initData in the POST body or by ?userId= query param.
const { readStats } = require('./_lib/stats');

function extractUser(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userJson = params.get('user');
    if (userJson) {
      const u = JSON.parse(userJson);
      return { id: String(u.id), username: u.username };
    }
  } catch (_) {}
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let userId = null;
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.initData) {
        const u = extractUser(body.initData);
        if (u) userId = u.id;
      } else if (body.userId) {
        userId = String(body.userId);
      }
    } else if (req.method === 'GET') {
      const q = req.query || {};
      if (q.initData) {
        const u = extractUser(q.initData);
        if (u) userId = u.id;
      } else if (q.userId) {
        userId = String(q.userId);
      }
    }

    if (!userId) {
      return res.status(200).json({ film: null });
    }

    const stats = await readStats();
    const user = (stats.users || {})[userId];
    if (!user || !user.last_film) {
      return res.status(200).json({ film: null });
    }

    return res.status(200).json({
      film: user.last_film,
      user_id: userId,
      username: user.username
    });
  } catch (e) {
    console.error('last-film error:', e);
    return res.status(500).json({ error: e.message });
  }
};
