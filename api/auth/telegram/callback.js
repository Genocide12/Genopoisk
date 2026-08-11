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
    // IMPORTANT: Use telegramUser.id (Bot API user ID, same as Mini App)
    // NOT telegramUser.sub (OIDC internal subject, different number)
    const telegramId = String(telegramUser.id || telegramUser.sub);
    const username = telegramUser.preferred_username || '';
    const name = telegramUser.name || '';
    const firstName = telegramUser.given_name || '';
    const lastName = telegramUser.family_name || '';
    const picture = telegramUser.picture || '';

    console.log('[auth] Telegram user authenticated:', {
      id: telegramId,
      sub: telegramUser.sub,
      username: username,
      name: name
    });

    // Clear OAuth cookies
    res.setHeader('Set-Cookie', [
      'tg_oauth_state=; Max-Age=0; Path=/; HttpOnly',
      'tg_oauth_verifier=; Max-Age=0; Path=/; HttpOnly'
    ]);

    // Redirect to site with user data in URL params
    // The site will store this in localStorage
    const displayName = name || (firstName + (lastName ? ' ' + lastName : '')) || (username ? '@' + username : 'Telegram');
    const redirectUrl = `/?telegram_login=success&tg_id=${encodeURIComponent(telegramId)}&tg_name=${encodeURIComponent(displayName)}`;

    console.log('[auth] Redirecting to:', redirectUrl.substring(0, 80) + '...');
    return res.redirect(302, redirectUrl);

  } catch (err) {
    console.error('[auth] Callback error:', err);
    return res.redirect(302, '/?telegram_login=error&message=callback_failed');
  }
};
