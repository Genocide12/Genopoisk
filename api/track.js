// Tracking endpoint — Supabase, telegram_id (Bot API user.id) as primary key
// ONLY tracks authenticated users. No guest profiles.
//
// Both Mini App (initData) and Browser (OIDC) now use the SAME telegram_id:
//   - Mini App:  user.id from initData (Bot API ID, e.g. 854765520)
//   - Browser:   stored tg_id from localStorage, originally set by OIDC callback
//                using telegramUser.id (Bot API ID — NOT the OIDC sub)
//
// No username-based merging is needed anymore.

const { getUser, recordEvent, getUserByOidcSub, upsertUser } = require('./_lib/supabase');
const crypto = require('crypto');

const ALLOWED_TYPES = ['page_views', 'searches', 'movies_opened', 'categories_opened', 'bot_starts'];

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

    // 1) Mini App: validate initData → Bot API user.id (canonical telegram_id)
    if (body.initData) {
      const validatedUser = validateInitData(body.initData, process.env.TG_BOT_TOKEN);
      if (validatedUser) {
        telegramId = String(validatedUser.id);
        username = validatedUser.username || '';
      }
    }

    // 2) Browser: use stored userId (which is now the Bot API ID, set by OIDC callback)
    if (!telegramId && body.userId) {
      telegramId = String(body.userId);
      username = body.username || '';
    }

    // 3) Legacy fallback: if userId looks like a long OIDC sub (length > 12),
    //    try to resolve the real user via oidc_sub column
    if (telegramId && telegramId.length > 12) {
      const resolved = await getUserByOidcSub(telegramId);
      if (resolved) {
        console.log('[track] Resolved legacy oidc_sub → telegram_id:', telegramId, '→', resolved.telegram_id);
        telegramId = resolved.telegram_id;
        if (!username && resolved.username) username = resolved.username;
      }
    }

    // 4) If still no telegramId → SKIP (guest)
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
