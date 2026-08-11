// Validates Telegram Mini App initData server-side.
// Extracts the REAL user.id (Bot API ID) from signed initData.
// This is the ONLY trusted way to get the user's Bot API ID.
const crypto = require('crypto');

function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    // Parse initData
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    // Build data-check string
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // Create secret key: HMAC-SHA256(bot_token, "WebAppData")
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    
    // Calculate hash: HMAC-SHA256(secret_key, data_check_string)
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    // Verify hash
    if (calculatedHash !== hash) {
      console.log('[validate] Hash mismatch');
      return null;
    }

    // Check auth_date (not older than 24h)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (authDate && Date.now() / 1000 - authDate > 86400) {
      console.log('[validate] initData expired');
      return null;
    }

    // Extract user
    const userJson = params.get('user');
    if (!userJson) return null;
    const user = JSON.parse(userJson);
    return user;
  } catch (e) {
    console.error('[validate] Error:', e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const initData = body.initData;
    const botToken = process.env.TG_BOT_TOKEN;

    if (!initData) {
      return res.status(200).json({ valid: false, error: 'no initData' });
    }

    const user = validateInitData(initData, botToken);
    if (!user) {
      return res.status(200).json({ valid: false, error: 'invalid initData' });
    }

    console.log('[validate] Mini App user validated:', {
      id: user.id,
      username: user.username,
      first_name: user.first_name
    });

    return res.status(200).json({
      valid: true,
      user: {
        id: String(user.id),
        username: user.username || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        photo_url: user.photo_url || ''
      }
    });
  } catch (e) {
    console.error('[validate] Error:', e);
    return res.status(200).json({ valid: false, error: e.message });
  }
};
