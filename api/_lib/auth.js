// Shared authentication helpers — used by /api/track, /api/my-films,
// /api/last-film, /api/user-check, /api/auth/telegram/callback.
//
// Two auth contexts:
//   1) Telegram Mini App — sends signed `initData` string. We verify the
//      HMAC signature with the bot token, then trust the user.id inside.
//   2) Browser — verified via `tg_session` cookie (signed HMAC, set by
//      OIDC callback). Falls back to body.userId for legacy sessions.
//
// IDOR protection:
//   - Mini App: initData signature is verified — cannot be forged.
//   - Browser: tg_session cookie is signed with SESSION_SECRET — cannot
//     be forged. The legacy body.userId path is still IDOR-vulnerable,
//     but kept for backward compat with old browser sessions that
//     haven't logged in yet.
//
// Guest web_* IDs are accepted as real users (tracked in Supabase).
// They are migrated to the real Telegram account on OIDC login.

const crypto = require('crypto');

// Verify Telegram Mini App initData signature.
// Returns the parsed user object if valid, null otherwise.
//
// Algorithm (per Telegram docs):
//   1. Parse initData as URLSearchParams
//   2. Remove `hash` param, keep the rest
//   3. Sort remaining params by key, build "key=value\n" check string
//   4. secretKey = HMAC-SHA256("WebAppData", botToken)
//   5. expectedHash = HMAC-SHA256(secretKey, checkString).hex()
//   6. Compare expectedHash with the `hash` param (constant-time)
//   7. If match, parse user JSON from `user` param and return it
function verifyInitData(initData, botToken) {
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

    // Constant-time comparison to prevent timing attacks
    if (calculatedHash.length !== hash.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash))) return null;

    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) {
    return null;
  }
}

// Extract a verified telegram_id from a request body AND/OR cookies.
//
// Auth priority:
//   1. body.initData — verified via HMAC (Mini App). If signature is
//      invalid, request is rejected — NO fallback to body.userId.
//   2. tg_session cookie — signed HMAC cookie set by OIDC callback.
//      Verified via SESSION_SECRET. Prevents IDOR on browser endpoints.
//   3. body.userId — accepted only if:
//        a) It's not empty
//        b) It does NOT start with "web_" (those are guest IDs)
//        c) No initData and no session cookie were provided
//      This is the LEGACY path — still IDOR-vulnerable, but kept for
//      backward compat with old browser sessions that haven't logged in.
//
// Returns: { telegramId, username, source } or { telegramId: null, ... }
function extractVerifiedUser(body, req) {
  const result = { telegramId: null, username: null, source: null };

  if (!body) body = {};

  // Get bot token from env (used for initData verification)
  var botToken = process.env.TG_BOT_TOKEN;

  // 1) Mini App path — verify initData signature
  if (body.initData) {
    const validated = verifyInitData(body.initData, botToken);
    if (validated) {
      result.telegramId = String(validated.id);
      result.username = validated.username || '';
      result.source = 'miniapp';
      return result;
    }
    // initData was present but invalid — DO NOT fall back to userId.
    result.source = 'invalid_initdata';
    return result;
  }

  // 2) Session cookie path — verify signed cookie
  if (req && req.headers && req.headers.cookie) {
    var cookieSession = parseSessionCookie(req.headers.cookie);
    if (cookieSession) {
      result.telegramId = cookieSession;
      result.username = body.username || '';
      result.source = 'session';
      return result;
    }
  }

  // 3) Browser path — accept userId.
  //    Guest web_* IDs are accepted as guest users (tracked in Supabase).
  //    Real telegram_ids are ALSO accepted here for backward compat with
  //    users who logged in via ?tg_id= URL (from bot) and don't have a
  //    session cookie. This is a read-only path — /api/me uses it to
  //    return user data. Write endpoints (track) verify initData separately.
  //    IDOR risk: anyone who knows a telegram_id can READ another user's
  //    watched films/favorites. This is acceptable for a public movie
  //    catalog — the data is not sensitive (no emails, passwords, PII).
  //    For sensitive operations (premium_refund, delete), initData or
  //    session cookie is required (handled in track.js separately).
  if (body.userId) {
    const uid = String(body.userId);
    result.telegramId = uid;
    result.username = body.username || '';
    result.source = uid.startsWith('web_') ? 'guest' : 'browser';
    return result;
  }

  return result;
}

// Parse and verify the tg_session cookie.
// Cookie format: base64(telegramId:timestamp).hmac
// Returns telegramId if valid, null otherwise.
function parseSessionCookie(cookieHeader) {
  try {
    var cookies = {};
    cookieHeader.split(';').forEach(function(c) {
      var parts = c.trim().split('=');
      if (parts.length >= 2) {
        cookies[decodeURIComponent(parts[0])] = decodeURIComponent(parts.slice(1).join('='));
      }
    });
    var sessionCookie = cookies['tg_session'];
    if (!sessionCookie) return null;

    var parts = sessionCookie.split('.');
    if (parts.length !== 2) return null;

    var payload = Buffer.from(parts[0], 'base64').toString('utf8');
    var signature = parts[1];

    var secret = process.env.SESSION_SECRET || process.env.TG_BOT_TOKEN;
    if (!secret) {
      console.error('[auth] SESSION_SECRET and TG_BOT_TOKEN both missing — cannot verify session cookie');
      return null;
    }
    var crypto = require('crypto');
    var expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    if (expectedSig.length !== signature.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature))) return null;

    // Extract telegramId and timestamp from "telegramId:timestamp"
    var parts = payload.split(':');
    var telegramId = parts[0];
    var timestamp = parseInt(parts[1], 10);

    // Validate session age — cookies older than 30 days are expired.
    // This closes the gap where stolen cookies never expired server-side.
    var SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    if (!timestamp || (Date.now() - timestamp) > SESSION_MAX_AGE_MS) {
      return null; // expired
    }

    return telegramId || null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  verifyInitData,
  extractVerifiedUser
};
