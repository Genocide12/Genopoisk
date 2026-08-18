// Shared authentication helpers — used by /api/track, /api/my-films,
// /api/last-film, /api/user-check, /api/auth/telegram/callback.
//
// Two auth contexts:
//   1) Telegram Mini App — sends signed `initData` string. We verify the
//      HMAC signature with the bot token, then trust the user.id inside.
//   2) Browser — no signed payload. We rely on the `userId` field which
//      the OIDC callback set in localStorage. This is a weaker guarantee
//      (anyone who knows a telegram_id can read another user's data),
//      but it's the best we can do without adding HttpOnly session cookies.
//      To fully close this gap, a session-token system would be needed.
//
// What this module DOES improve (vs. the previous code):
//   - Mini App requests now have their initData signature VERIFIED in
//     every endpoint (previously only /api/track verified it; my-films,
//     last-film, user-check trusted the unsigned user.id field inside
//     initData).
//   - Guest `web_*` IDs are universally rejected for user-data endpoints.
//
// What it does NOT solve:
//   - Browser IDOR (Insecure Direct Object Reference) on /api/my-films
//     and /api/last-film: an attacker who knows a real telegram_id can
//     still POST { userId: "<that id>" } and read the victim's data.
//     Fixing this requires adding a session cookie issued at OIDC login
//     and verifying it on every user-data request — a larger refactor
//     deferred to a later commit.

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

// Extract a verified telegram_id from a request body.
//
// Order of preference:
//   1. body.initData — verified via HMAC. If signature is invalid or
//      missing, we DON'T fall back to body.userId (an attacker could
//      send a fake initData with the real userId inside).
//   2. body.userId — accepted only if:
//        a) It's not empty
//        b) It does NOT start with "web_" (those are guest IDs)
//        c) No initData was provided at all (pure browser session)
//
// Returns: { telegramId, username, source } or { telegramId: null, ... }
function extractVerifiedUser(body, botToken) {
  const result = { telegramId: null, username: null, source: null };

  if (!body) return result;

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
    // This prevents an attacker from sending a fake initData with a
    // real userId inside to impersonate another user.
    result.source = 'invalid_initdata';
    return result;
  }

  // 2) Browser path — accept userId only if it's not a guest ID
  if (body.userId) {
    const uid = String(body.userId);
    if (uid.startsWith('web_')) {
      result.source = 'guest';
      return result;
    }
    result.telegramId = uid;
    result.username = body.username || '';
    result.source = 'browser';
    return result;
  }

  return result;
}

module.exports = {
  verifyInitData,
  extractVerifiedUser
};
