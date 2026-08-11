// Tracking endpoint — receives events from the site
const { recordEvent, readStats } = require('./_lib/stats');
const crypto = require('crypto');

const ALLOWED_TYPES = ['page_views', 'searches', 'movies_opened', 'categories_opened'];

// Validate Telegram Mini App initData server-side
// Returns the REAL Bot API user ID (trusted)
function validateAndExtractUser(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash !== hash) return null;
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) { return null; }
}

function getClientIp(req) {
  // Vercel sets these headers — x-forwarded-for contains client IP first
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

// Extract human-readable device name from User-Agent
function getDeviceName(ua) {
  if (!ua) return 'Unknown';
  // iOS
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPod/i.test(ua)) return 'iPod';
  // Android
  if (/Android/i.test(ua)) {
    if (/Mobile/i.test(ua)) return 'Android-Phone';
    return 'Android-Tablet';
  }
  // Windows
  if (/Windows NT 10/i.test(ua)) return 'Windows-10';
  if (/Windows NT 6\.3/i.test(ua)) return 'Windows-8.1';
  if (/Windows NT 6\.2/i.test(ua)) return 'Windows-8';
  if (/Windows NT 6\.1/i.test(ua)) return 'Windows-7';
  // Mac
  if (/Mac OS X/i.test(ua)) return 'Mac';
  // Linux
  if (/Linux/i.test(ua)) return 'Linux';
  // Browser
  if (/Edg/i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Unknown';
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const type = body.type;
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid event type', allowed: ALLOWED_TYPES });
    }

    // Get user identifier — server-side validation
    let userId = 'anon';
    let username = null;
    
    // 1. Mini App: validate initData server-side (trusted)
    if (body.initData) {
      const botToken = process.env.TG_BOT_TOKEN;
      const validatedUser = validateAndExtractUser(body.initData, botToken);
      if (validatedUser) {
        userId = String(validatedUser.id);  // Bot API user ID (trusted)
        username = validatedUser.username || '';
        console.log('[track] Mini App validated user:', userId, username);
      }
    }

    // Capture client IP for per-user stats
    const ip = getClientIp(req);

    // Fallback for browser users: use the stable localStorage ID sent by client.
    // This ID persists across VPN changes (stored in browser localStorage),
    // so user history is preserved regardless of network/IP changes.
    if (userId === 'anon') {
      if (body.userId && typeof body.userId === 'string' && body.userId.startsWith('web_')) {
        userId = String(body.userId);
        const ua = req.headers['user-agent'] || 'unknown';
        const deviceName = getDeviceName(ua);
        username = deviceName + ' (браузер)';
      } else if (body.userId) {
        userId = String(body.userId);
        // For OIDC users: use username from body (stored in localStorage)
        if (body.username) {
          username = body.username;
        }
      }
    }

    // 2. OIDC browser users: userId is OIDC sub (long number).
    // Try to find matching Bot API user by username → use Bot API ID instead.
    // This links browser (OIDC) and Mini App (Bot API) profiles.
    const linkUsername = username || body.username || '';
    if (userId !== 'anon' && userId.length > 12 && linkUsername) {
      try {
        const stats = await readStats();
        for (const [uid, u] of Object.entries(stats.users || {})) {
          if (u && uid.length <= 12) {
            // Match by username (with or without @)
            if (u.username === linkUsername || u.username === '@' + linkUsername ||
                '@' + u.username === linkUsername) {
              console.log('[track] Linked OIDC sub to Bot API ID:', userId, '→', uid, 'via username:', linkUsername);
              userId = uid;
              if (!username) username = u.username;
              break;
            }
          }
        }
      } catch (_) {}
    }

    // If still OIDC sub and no match found, use body.username for display
    if (userId !== 'anon' && userId.length > 12 && !username && body.username) {
      username = body.username;
    }

    const payload = {
      userId,
      username,
      ...(ip ? { ip } : {}),
      ...(body.query ? { query: String(body.query).slice(0, 100) } : {}),
      ...(body.title ? { title: String(body.title).slice(0, 100) } : {}),
      ...(body.filmId ? { filmId: String(body.filmId).slice(0, 20) } : {}),
      ...(body.category ? { category: String(body.category).slice(0, 20) } : {})
    };

    await recordEvent(type, payload);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Track error:', e);
    return res.status(500).json({ error: e.message });
  }
};
