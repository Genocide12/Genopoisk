// Health check for the notify-commit system.
//
// GET /api/notify-health
//   Returns whether NOTIFY_TOKEN and ADMIN_IDS are configured, so the
//   user can verify the setup is correct without making a commit.
//
//   Response: {
//     ok: true,
//     endpoint: 'notify-commit',
//     ready: true|false,           // true iff both NOTIFY_TOKEN and ADMIN_IDS are set
//     hasToken: true|false,        // whether NOTIFY_TOKEN env var is set
//     hasAdminIds: true|false,    // whether ADMIN_IDS env var is set
//     adminCount: 0,               // number of admin chat IDs configured
//     hasBotToken: true|false      // whether TG_BOT_TOKEN is set
//   }
//
// NOTE: this endpoint never reveals the token value or the actual admin
// IDs — just whether they are configured. Safe to expose publicly.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const hasToken = !!process.env.NOTIFY_TOKEN;
  const hasBotToken = !!process.env.TG_BOT_TOKEN;
  const adminIds = (process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const hasAdminIds = adminIds.length > 0;

  return res.status(200).json({
    ok: true,
    endpoint: 'notify-commit',
    ready: hasToken && hasAdminIds && hasBotToken,
    hasToken,
    hasBotToken,
    hasAdminIds,
    adminCount: adminIds.length,
    hint: !hasToken
      ? 'NOTIFY_TOKEN not set in Vercel env vars'
      : !hasAdminIds
        ? 'ADMIN_IDS not set in Vercel env vars'
        : !hasBotToken
          ? 'TG_BOT_TOKEN not set in Vercel env vars'
          : 'all configured — ready to receive commit notifications'
  });
};
