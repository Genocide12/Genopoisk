// QR Code Login — Step 1: Generate a login session
//
// Returns a token that the projector displays as a QR code.
// The user scans it with their phone, opens the bot, and runs /qr_login <token>.
// The bot verifies the user's Telegram identity and marks the session as confirmed.
//
// Flow:
//   1. Projector → POST /api/auth/qr/generate → { sessionId, qrUrl, expiresAt }
//   2. Projector displays qrUrl as QR code
//   3. User scans QR with phone → opens t.me/Genopoiskbot?start=qr_<sessionId>
//   4. Bot handler validates user, calls confirmQrLogin(sessionId, telegramId)
//   5. Projector polls GET /api/auth/qr/status?session=<sessionId>
//   6. When confirmed → projector gets telegramId → sets session cookie

const crypto = require('crypto');

// In-memory store of pending QR sessions.
// Each entry: { sessionId, telegramId (null until confirmed), createdAt, expiresAt }
// Vercel serverless instances are ephemeral, so this only works within the
// same instance. For production, use Vercel KV or Upstash Redis.
// For now, we use a global Map that persists across warm invocations.
const qrSessions = (global.__qrSessions = global.__qrSessions || new Map());
const QR_TTL_MS = 5 * 60 * 1000; // 5 minutes

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Clean up expired sessions
  const now = Date.now();
  for (const [key, session] of qrSessions.entries()) {
    if (session.expiresAt < now) qrSessions.delete(key);
  }

  // Generate a new session
  const sessionId = crypto.randomBytes(16).toString('hex');
  const botUsername = process.env.BOT_USERNAME || 'Genopoiskbot';
  const deepLink = `https://t.me/${botUsername}?start=qr_${sessionId}`;

  qrSessions.set(sessionId, {
    sessionId,
    telegramId: null,
    username: null,
    displayName: null,
    createdAt: now,
    expiresAt: now + QR_TTL_MS,
    confirmed: false
  });

  console.log('[qr] Generated session:', sessionId.substring(0, 12) + '...');

  return res.status(200).json({
    sessionId,
    qrUrl: deepLink,
    expiresAt: now + QR_TTL_MS,
    expiresIn: QR_TTL_MS
  });
};

// Export the sessions map so the bot handler can access it
module.exports.qrSessions = qrSessions;
module.exports.QR_TTL_MS = QR_TTL_MS;
