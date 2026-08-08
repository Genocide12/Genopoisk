// Returns the user's watched films list (for "My films" feature in bot).
// Identifies user by Telegram initData or userId (browser fallback).
// Reads from stats.json — users[userId].watched_films array (we'll add this
// to recordEvent when movies_opened fires).
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
      }
      if (!userId && body.userId) {
        userId = String(body.userId);
      }
    } else if (req.method === 'GET') {
      const q = req.query || {};
      if (q.initData) {
        const u = extractUser(q.initData);
        if (u) userId = u.id;
      }
      if (!userId && q.userId) {
        userId = String(q.userId);
      }
    }

    if (!userId) {
      return res.status(200).json({ films: [] });
    }

    const stats = await readStats();
    const user = (stats.users || {})[userId];
    if (!user) {
      return res.status(200).json({ films: [] });
    }

    // watched_films is an array of {filmId, title, ts} — most recent first.
    // Fallback to last_film if watched_films not present.
    const films = user.watched_films || (user.last_film ? [user.last_film] : []);

    return res.status(200).json({
      films: films,
      user_id: userId,
      username: user.username
    });
  } catch (e) {
    console.error('my-films error:', e);
    return res.status(500).json({ error: e.message });
  }
};
