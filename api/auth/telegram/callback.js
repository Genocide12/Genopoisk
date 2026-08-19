// Telegram OIDC Callback — exchanges code for id_token, verifies JWT,
// extracts user data, redirects back to site with telegram_id in URL.
//
// IMPORTANT: Telegram OIDC returns TWO different IDs in the id_token:
//   - sub  = OIDC subject identifier (e.g. "6611475080888633282") — internal to OIDC
//   - id   = Telegram Bot API user.id (e.g. "854765520") — same as Mini App user.id
//
// We use `id` as `telegram_id` (the canonical key that matches Mini App),
// and store `sub` separately as `oidc_sub` for reference.
//
// This makes Mini App and Browser OIDC resolve to the SAME user record:
//
//                    GrayGendalf
//                         │
//             Telegram ID = 854765520
//                         │
//                  ┌──────┴──────┐
//                  ▼             ▼
//              Mini App       Browser
//                  │             │
//             user.id        OIDC.id
//                  │             │
//                  └──────┬──────┘
//                         ▼
//                   one user row
//
// sub = 6611475080888633282 is saved in oidc_sub but NOT used as the key.

const crypto = require('crypto');

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';')
      .map(v => v.trim())
      .filter(Boolean)
      .map(v => {
        const index = v.indexOf('=');
        return [v.substring(0, index), decodeURIComponent(v.substring(index + 1))];
      })
  );
}

function base64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  return JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
}

module.exports = async (req, res) => {
  try {
    const { code, state, error } = req.query || {};

    if (error) {
      console.error('[auth] Telegram error:', error);
      return res.redirect(302, '/?telegram_login=error&message=' + encodeURIComponent(error));
    }

    if (!code || !state) {
      return res.redirect(302, '/?telegram_login=error&message=missing_params');
    }

    const cookies = parseCookies(req);
    const savedState = cookies.tg_oauth_state;
    const codeVerifier = cookies.tg_oauth_verifier;

    if (!savedState || !codeVerifier) {
      return res.redirect(302, '/?telegram_login=error&message=session_expired');
    }

    // CSRF protection: verify state
    if (!crypto.timingSafeEqual(Buffer.from(state), Buffer.from(savedState))) {
      return res.redirect(302, '/?telegram_login=error&message=invalid_state');
    }

    const clientId = process.env.TELEGRAM_CLIENT_ID;
    const clientSecret = process.env.TELEGRAM_CLIENT_SECRET;
    const redirectUri = process.env.TELEGRAM_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return res.redirect(302, '/?telegram_login=error&message=server_misconfigured');
    }

    // Exchange authorization code for tokens
    console.log('[auth] Exchanging code for tokens...');
    const tokenResponse = await fetch('https://oauth.telegram.org/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier
      })
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.error('[auth] Token exchange failed:', text);
      return res.redirect(302, '/?telegram_login=error&message=token_exchange_failed');
    }

    const tokens = await tokenResponse.json();

    if (!tokens.id_token) {
      console.error('[auth] No id_token in response:', JSON.stringify(tokens));
      return res.redirect(302, '/?telegram_login=error&message=no_id_token');
    }

    // Decode JWT payload (id_token)
    const telegramUser = decodeJwtPayload(tokens.id_token);

    // Log ALL fields from JWT for debugging
    console.log('[auth] Full JWT payload:', JSON.stringify(telegramUser));

    // Verify JWT claims
    if (telegramUser.iss !== 'https://oauth.telegram.org') {
      return res.redirect(302, '/?telegram_login=error&message=invalid_issuer');
    }

    if (String(telegramUser.aud) !== String(clientId)) {
      return res.redirect(302, '/?telegram_login=error&message=invalid_audience');
    }

    if (!telegramUser.exp || telegramUser.exp < Math.floor(Date.now() / 1000)) {
      return res.redirect(302, '/?telegram_login=error&message=token_expired');
    }

    // Extract user data
    //   - telegramId = Bot API user.id (e.g. "854765520") — matches Mini App
    //   - oidcSub    = OIDC sub (e.g. "6611475080888633282") — internal OIDC subject
    //
    // telegram_id is the canonical key. oidc_sub is stored separately for reference.
    //
    // Defensive: if `id` is missing from JWT (older Telegram OIDC scope or
    // future change), we cannot safely link to Mini App. Refuse the login
    // and log the full payload so we can see what Telegram returned.
    if (!telegramUser.id) {
      console.error('[auth] JWT payload is MISSING the `id` field!', JSON.stringify(telegramUser));
      return res.redirect(302, '/?telegram_login=error&message=no_bot_api_id_in_jwt');
    }

    const telegramId = String(telegramUser.id);
    const oidcSub = String(telegramUser.sub);
    const username = telegramUser.preferred_username || '';
    const name = telegramUser.name || '';
    const firstName = telegramUser.given_name || '';
    const lastName = telegramUser.family_name || '';
    const picture = telegramUser.picture || '';

    console.log('[auth] Telegram user authenticated:', {
      telegram_id: telegramId,
      oidc_sub: oidcSub,
      username: username,
      name: name,
      allKeys: Object.keys(telegramUser)
    });

    // Clear OAuth cookies
    res.setHeader('Set-Cookie', [
      'tg_oauth_state=; Max-Age=0; Path=/; HttpOnly',
      'tg_oauth_verifier=; Max-Age=0; Path=/; HttpOnly'
    ]);

    // Create/update user in Supabase.
    // The canonical key is telegram_id (Bot API ID).
    // We also save oidc_sub so future logins can find the same user by either ID.
    const { upsertUser, getUser, getUserByUsername, getUserByOidcSub, deleteUser, updateUser } = require('../../_lib/supabase');
    const displayName = name || (firstName + (lastName ? ' ' + lastName : '')) || (username ? '@' + username : 'Telegram');
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null;

    // 1) Already migrated: row with telegram_id = Bot API ID
    let existingUser = await getUser(telegramId);

    // 2) Already migrated (alternative): row with oidc_sub matching
    if (!existingUser && oidcSub) {
      existingUser = await getUserByOidcSub(oidcSub);
    }

    // 3) LEGACY: row whose telegram_id was incorrectly set to oidc_sub (pre-fix)
    //    Need to migrate: delete old row, recreate with Bot API ID as telegram_id
    if (!existingUser) {
      const legacyUser = await getUser(oidcSub);
      if (legacyUser) {
        console.log('[auth] Migrating legacy user from oidc_sub-as-telegram_id → Bot API ID:', oidcSub, '→', telegramId);
        try {
          // Delete the legacy row first so the new upsert doesn't conflict
          await deleteUser(oidcSub);
        } catch (e) {
          console.warn('[auth] Legacy delete failed (continuing):', e.message);
        }
        // Create new row with Bot API ID, preserving all data
        await upsertUser(telegramId, {
          oidc_sub: oidcSub,
          username: username || legacyUser.username || null,
          ip: clientIp || legacyUser.ip || null,
          ip_history: legacyUser.ip_history || (clientIp ? [clientIp] : []),
          events_count: legacyUser.events_count || 0,
          events_by_type: legacyUser.events_by_type || {},
          watched_films: legacyUser.watched_films || [],
          rated_films: legacyUser.rated_films || [],
          last_film: legacyUser.last_film || null,
          first_seen: legacyUser.first_seen || new Date().toISOString(),
          last_seen: new Date().toISOString()
        });
        existingUser = await getUser(telegramId);
        console.log('[auth] Migration complete:', existingUser ? 'OK' : 'FAILED');
      }
    }

    // 4) Legacy fallback: find by username (very old data without oidc_sub set)
    if (!existingUser && username) {
      const byUsername = await getUserByUsername(username);
      if (byUsername) {
        // If this row's telegram_id is a long OIDC sub → migrate it too
        if (byUsername.telegram_id && byUsername.telegram_id.length > 12 && byUsername.telegram_id !== telegramId) {
          console.log('[auth] Migrating username-matched legacy user:', byUsername.telegram_id, '→', telegramId);
          try { await deleteUser(byUsername.telegram_id); } catch (e) { console.warn('[auth] Legacy delete failed:', e.message); }
          await upsertUser(telegramId, {
            oidc_sub: oidcSub,
            username: username || byUsername.username || null,
            ip: clientIp || byUsername.ip || null,
            ip_history: byUsername.ip_history || (clientIp ? [clientIp] : []),
            events_count: byUsername.events_count || 0,
            events_by_type: byUsername.events_by_type || {},
            watched_films: byUsername.watched_films || [],
            rated_films: byUsername.rated_films || [],
            last_film: byUsername.last_film || null,
            first_seen: byUsername.first_seen || new Date().toISOString(),
            last_seen: new Date().toISOString()
          });
          existingUser = await getUser(telegramId);
        } else {
          // Already has Bot API ID — just update oidc_sub and other fields
          existingUser = byUsername;
        }
      }
    }

    // 5) Final: upsert (create if new, update if existing)
    if (existingUser) {
      // Update existing record with oidc_sub + fresh IP/last_seen
      await updateUser(existingUser.telegram_id, {
        oidc_sub: oidcSub,
        username: username || existingUser.username || null,
        ip: clientIp || existingUser.ip || null,
        last_seen: new Date().toISOString()
      });
      console.log('[auth] Updated existing user:', existingUser.telegram_id);
    } else {
      // Brand new user
      await upsertUser(telegramId, {
        oidc_sub: oidcSub,
        username: username || null,
        ip: clientIp,
        ip_history: clientIp ? [clientIp] : [],
        last_seen: new Date().toISOString(),
        events_count: 0,
        events_by_type: {},
        watched_films: [],
        rated_films: []
      });
      console.log('[auth] Created new user:', telegramId, username);
    }

    // 6) Cleanup ghost users: delete any rows with the same username but
    //    telegram_id starting with "web_" (created by track.js before login
    //    was enforced). These are temp browser IDs that fragment user data.
    if (username) {
      try {
        const { getAllUsers } = require('../../_lib/supabase');
        const allUsers = await getAllUsers();
        const ghosts = allUsers.filter(u =>
          u.username === username &&
          u.telegram_id !== telegramId &&
          String(u.telegram_id || '').startsWith('web_')
        );
        for (const g of ghosts) {
          console.log('[auth] Cleaning up ghost user:', g.telegram_id, '(username:', username, ')');
          try { await deleteUser(g.telegram_id); } catch (e) { console.warn('[auth] Ghost delete failed:', e.message); }
        }
      } catch (e) {
        console.warn('[auth] Ghost cleanup failed (non-fatal):', e.message);
      }
    }

    // Note: welcome message is NOT sent here. It's sent when the user
    // clicks 'Открыть в Telegram' on the website and lands in the bot
    // with /start app (handled in api/bot/webhook.js cmdStart).
    // This avoids the issue where we couldn't message users who hadn't
    // pressed /start in the bot yet.

    // Set a session cookie with the telegram_id. This cookie is HttpOnly
    // (not accessible via JavaScript) and signed with a simple HMAC to
    // prevent tampering. The API endpoints (my-films, last-film,
    // user-check) verify this cookie to prevent IDOR attacks.
    var sessionSecret = process.env.SESSION_SECRET || process.env.TG_BOT_TOKEN || 'fallback-secret';
    var sessionPayload = telegramId + ':' + Date.now();
    var sessionHmac = crypto.createHmac('sha256', sessionSecret).update(sessionPayload).digest('hex');
    var sessionCookie = Buffer.from(sessionPayload).toString('base64') + '.' + sessionHmac;

    var isProduction = process.env.NODE_ENV === 'production';
    var sessionCookieStr = [
      'tg_session=' + encodeURIComponent(sessionCookie),
      'Max-Age=2592000', // 30 days
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      isProduction ? 'Secure' : ''
    ].filter(Boolean).join('; ');

    // Clear OAuth cookies AND set session cookie
    res.setHeader('Set-Cookie', [
      'tg_oauth_state=; Max-Age=0; Path=/; HttpOnly',
      'tg_oauth_verifier=; Max-Age=0; Path=/; HttpOnly',
      sessionCookieStr
    ]);

    // Redirect to site — pass telegramId (Bot API ID, same as Mini App uses)
    const redirectUrl = `/?telegram_login=success&tg_id=${encodeURIComponent(telegramId)}&tg_name=${encodeURIComponent(displayName)}&tg_username=${encodeURIComponent(username)}`;

    console.log('[auth] Redirecting to site:', telegramId, username);
    return res.redirect(302, redirectUrl);

  } catch (err) {
    console.error('[auth] Callback error:', err);
    return res.redirect(302, '/?telegram_login=error&message=callback_failed');
  }
};
