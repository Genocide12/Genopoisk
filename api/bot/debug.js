// Debug endpoint — returns bot status and recent errors
// Access via: /api/bot/debug
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const TG_TOKEN = process.env.TG_BOT_TOKEN;
  if (!TG_TOKEN) {
    return res.status(500).json({ error: 'TG_BOT_TOKEN not set' });
  }
  
  try {
    // Get webhook info from Telegram
    const webhookInfo = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getWebhookInfo`).then(r => r.json());
    
    // Get bot info
    const botInfo = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getMe`).then(r => r.json());
    
    return res.status(200).json({
      webhook: webhookInfo.ok ? {
        url: webhookInfo.result.url,
        pending_update_count: webhookInfo.result.pending_update_count,
        last_error_date: webhookInfo.result.last_error_date,
        last_error_message: webhookInfo.result.last_error_message,
        max_connections: webhookInfo.result.max_connections
      } : { error: webhookInfo.description },
      bot: botInfo.ok ? {
        username: botInfo.result.username,
        id: botInfo.result.id,
        can_join_groups: botInfo.result.can_join_groups
      } : { error: botInfo.description },
      env: {
        TG_BOT_TOKEN: 'SET (' + TG_TOKEN.length + ' chars)',
        ADMIN_IDS: process.env.ADMIN_IDS || 'NOT SET',
        SITE_URL: process.env.SITE_URL || 'NOT SET',
        WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ? 'SET' : 'NOT SET'
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
