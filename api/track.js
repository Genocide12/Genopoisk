// Tracking endpoint — Supabase, telegram_id as primary key
// ONLY tracks authenticated users. No guest profiles.
const { getUser, recordEvent, getUserByUsername, upsertUser } = require('./_lib/supabase');
const crypto = require('crypto');

const ALLOWED_TYPES = ['page_views', 'searches', 'movies_opened', 'categories_opened'];

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  if (req.headers['x-vercel-ip']) return String(req.headers['x-vercel-ip']);
  return null;
}

function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash !== hash) return null;
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const type = body.type;
    if (!ALLOWED_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });

    const ip = getClientIp(req);
    let telegramId = null;
    let username = null;

    // 1. Mini App: validate initData → Bot API user.id
    if (body.initData) {
      const validatedUser = validateInitData(body.initData, process.env.TG_BOT_TOKEN);
      if (validatedUser) {
        telegramId = String(validatedUser.id);
        username = validatedUser.username || '';
      }
    }

    // 2. Browser: try to find existing user by username
    if (!telegramId && body.username) {
      const existingUser = await getUserByUsername(body.username);
      if (existingUser) {
        telegramId = existingUser.telegram_id;
        console.log('[track] Linked by username:', body.username, '→', telegramId);
      } else if (body.userId) {
        // No existing user → create with body.userId (OIDC sub)
        telegramId = String(body.userId);
        username = body.username;
        await upsertUser(telegramId, { username, ip, last_seen: new Date().toISOString() });
        console.log('[track] Created new user:', telegramId, username);
      }
    }

    // 3. Mini App: also check if user with same username exists with different ID
    // If yes → use existing ID (merge profiles)
    if (telegramId && username) {
      const existingUser = await getUserByUsername(username);
      if (existingUser && existingUser.telegram_id !== telegramId) {
        console.log('[track] Merging:', telegramId, '→', existingUser.telegram_id, '(same username:', username, ')');
        telegramId = existingUser.telegram_id;
      }
    }

    // 4. If still no telegramId → SKIP (guest)
    if (!telegramId) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Record event
    await recordEvent(telegramId, type, {
      username: username || undefined,
      ip: ip || undefined,
      filmId: body.filmId || undefined,
      title: body.title || undefined,
      query: body.query || undefined,
      category: body.category || undefined,
      path: body.path || undefined
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[track] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
