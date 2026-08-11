// Telegram OIDC Login — starts Authorization Code Flow + PKCE
// Redirects user to oauth.telegram.org/auth with code_challenge
const crypto = require('crypto');

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

module.exports = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.TELEGRAM_CLIENT_ID;
  const redirectUri = process.env.TELEGRAM_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send('Server misconfigured: missing TELEGRAM_CLIENT_ID or TELEGRAM_REDIRECT_URI');
  }

  // Generate state and PKCE code verifier
  const state = base64url(crypto.randomBytes(32));
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );

  const isProduction = process.env.NODE_ENV === 'production';

  // Store state + verifier in HttpOnly cookies
  const stateCookie = [
    `tg_oauth_state=${encodeURIComponent(state)}`,
    'Max-Age=600',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isProduction ? 'Secure' : ''
  ].filter(Boolean).join('; ');

  const verifierCookie = [
    `tg_oauth_verifier=${encodeURIComponent(codeVerifier)}`,
    'Max-Age=600',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isProduction ? 'Secure' : ''
  ].filter(Boolean).join('; ');

  res.setHeader('Set-Cookie', [stateCookie, verifierCookie]);

  // Build Telegram OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  const telegramUrl = `https://oauth.telegram.org/auth?${params.toString()}`;
  console.log('[auth] Redirecting to Telegram OAuth:', telegramUrl.substring(0, 80) + '...');

  res.redirect(302, telegramUrl);
};
