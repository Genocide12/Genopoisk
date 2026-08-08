// Returns the current user's last watched film (for "Continue watching" feature)
// Identifies the user by Telegram WebApp initData in the POST body or by IP+device.
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

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  if (req.headers['x-vercel-forwarded-for']) {
    return String(req.headers['x-vercel-forwarded-for']).split(',')[0].trim();
  }
  if (req.headers['x-vercel-ip']) return String(req.headers['x-vercel-ip']);
  return null;
}

function getDeviceName(ua) {
  if (!ua) return 'Unknown';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPod/i.test(ua)) return 'iPod';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android-Phone' : 'Android-Tablet';
  if (/Windows NT 10/i.test(ua)) return 'Windows-10';
  if (/Windows NT 6\.3/i.test(ua)) return 'Windows-8.1';
  if (/Windows NT 6\.2/i.test(ua)) return 'Windows-8';
  if (/Windows NT 6\.1/i.test(ua)) return 'Windows-7';
  if (/Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Edg/i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Unknown';
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
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const deviceName = getDeviceName(ua);

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.initData) {
        const u = extractUser(body.initData);
        if (u) userId = u.id;
      }
      // Browser fallback: use IP + device (same logic as track.js)
      if (!userId && body.userId) {
        if (typeof body.userId === 'string' && body.userId.startsWith('web_')) {
          userId = (ip || 'unknown') + '_' + deviceName;
        } else {
          userId = String(body.userId);
        }
      }
    } else if (req.method === 'GET') {
      const q = req.query || {};
      if (q.initData) {
        const u = extractUser(q.initData);
        if (u) userId = u.id;
      }
      if (!userId && q.userId) {
        if (typeof q.userId === 'string' && q.userId.startsWith('web_')) {
          userId = (ip || 'unknown') + '_' + deviceName;
        } else {
          userId = String(q.userId);
        }
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
