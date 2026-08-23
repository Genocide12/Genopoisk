// QR Code Login — Step 2: Poll for login confirmation
//
// Projector polls this endpoint every 2 seconds. When the user confirms
// via the bot (running /qr_login), the session is marked as confirmed
// and this endpoint returns the telegramId.
//
// On confirmation, sets the tg_session cookie (same as OIDC callback)
// so the projector is immediately authenticated for all API calls.

const crypto = require('crypto');

// Import the shared sessions map from generate.js
const { qrSessions } = require('./generate');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.query.session || '';
  if (!sessionId || !/^[a-f0-9]{32}$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  const session = qrSessions.get(sessionId);
  if (!session) {
    return res.status(200).json({ status: 'expired' });
  }

  // Check if session expired
  if (session.expiresAt < Date.now()) {
    qrSessions.delete(sessionId);
    return res.status(200).json({ status: 'expired' });
  }

  // Not confirmed yet
  if (!session.confirmed || !session.telegramId) {
    return res.status(200).json({
      status: 'pending',
      expiresAt: session.expiresAt,
      expiresIn: Math.max(0, session.expiresAt - Date.now())
    });
  }

  // Confirmed! Set session cookie and return user data.
  const telegramId = session.telegramId;
  const username = session.username || '';
  const displayName = session.displayName || '';

  // Create session cookie (same logic as callback.js)
  var sessionSecret = process.env.SESSION_SECRET || process.env.TG_BOT_TOKEN;
  if (!sessionSecret) {
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  var sessionPayload = telegramId + ':' + Date.now();
  var sessionHmac = crypto.createHmac('sha256', sessionSecret).update(sessionPayload).digest('hex');
  var sessionCookie = Buffer.from(sessionPayload).toString('base64') + '.' + sessionHmac;

  var isProduction = process.env.NODE_ENV === 'production';
  var sessionCookieStr = [
    'tg_session=' + encodeURIComponent(sessionCookie),
    'Max-Age=2592000',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isProduction ? 'Secure' : ''
  ].filter(Boolean).join('; ');

  res.setHeader('Set-Cookie', sessionCookieStr);

  // Delete the session (one-time use)
  qrSessions.delete(sessionId);

  console.log('[qr] Login confirmed for:', telegramId, username);

  return res.status(200).json({
    status: 'confirmed',
    telegramId: telegramId,
    username: username,
    displayName: displayName
  });
};
