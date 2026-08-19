// Check if a request is from an admin (via session cookie or initData)
// Used to protect debug-index.html and debug-player.html

const { extractVerifiedUser } = require('./auth');
const { getUser } = require('./supabase');

async function isAdminRequest(req) {
  try {
    var body = req.body || {};
    var auth = extractVerifiedUser(body, req);
    if (!auth.telegramId) return false;
    
    // Check if this user is in ADMIN_IDS
    var adminIds = (process.env.ADMIN_IDS || '').split(',').map(function(s) { return s.trim(); });
    return adminIds.includes(String(auth.telegramId));
  } catch (e) {
    return false;
  }
}

module.exports = { isAdminRequest };
