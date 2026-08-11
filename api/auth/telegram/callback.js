// Telegram OIDC Callback — exchanges code for id_token, verifies JWT,
// extracts user data, redirects back to site with telegram_id in URL.
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
    // Telegram OIDC 'sub' is a DIFFERENT ID than Bot API user ID.
    // sub = 6611475080888633282 (OIDC internal)
    // Bot API user.id = 854765520 (used in Mini App)
    //
    // To link browser (OIDC) with Mini App (Bot API), we use username.
    // The callback URL includes both oidc_sub and username.
    // The site stores username in localStorage.
    // When tracking events, if oidc_sub is used but a Bot API ID with the
    // same username exists in stats, we merge them.
    //
    // For now: use 'sub' as the ID but also pass username so the site
    // can try to find the matching Bot API profile.
    const oidcSub = String(telegramUser.sub);
    const username = telegramUser.preferred_username || '';
    const name = telegramUser.name || '';
    const firstName = telegramUser.given_name || '';
    const lastName = telegramUser.family_name || '';
    const picture = telegramUser.picture || '';

    console.log('[auth] Telegram user authenticated:', {
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

    // Create/update user in Supabase DIRECTLY
    const { upsertUser, getUserByUsername, getUser } = require('../../_lib/supabase');
    const displayName = name || (firstName + (lastName ? ' ' + lastName : '')) || (username ? '@' + username : 'Telegram');
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null;
    
    // KEY: Check if user with same username already exists (from Mini App or previous OIDC)
    // If yes → use THAT telegram_id (don't create new with oidcSub)
    // If no → create new with oidcSub
    let finalTelegramId = oidcSub;
    try {
      const existingUser = await getUserByUsername(username);
      if (existingUser) {
        // User already exists (from Mini App with Bot API ID, or previous OIDC)
        // Use their existing telegram_id — DON'T create a new one
        finalTelegramId = existingUser.telegram_id;
        console.log('[auth] Found existing user by username:', username, '→ telegram_id:', finalTelegramId);
        
        // Update last_seen and IP
        await upsertUser(finalTelegramId, {
          username: username || null,
          ip: clientIp,
          last_seen: new Date().toISOString()
        });
      } else {
        // No existing user → create new with oidcSub
        await upsertUser(oidcSub, {
          username: username || null,
          ip: clientIp,
          last_seen: new Date().toISOString()
        });
        console.log('[auth] Created new user:', oidcSub, username);
      }
    } catch (e) {
      console.error('[auth] Supabase error:', e.message);
    }

    // Redirect to site — pass finalTelegramId (could be oidcSub or existing Bot API ID)
    const redirectUrl = `/?telegram_login=success&tg_id=${encodeURIComponent(finalTelegramId)}&tg_name=${encodeURIComponent(displayName)}&tg_username=${encodeURIComponent(username)}`;

    console.log('[auth] Redirecting to site:', finalTelegramId, username);
    return res.redirect(302, redirectUrl);

  } catch (err) {
    console.error('[auth] Callback error:', err);
    return res.redirect(302, '/?telegram_login=error&message=callback_failed');
  }
};
