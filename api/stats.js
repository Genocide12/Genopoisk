// Public stats endpoint (read-only, for embedding in Mini App if needed)
const { readStats } = require('../_lib/stats');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const stats = await readStats();
    // Strip sensitive data
    const safe = {
      totals: stats.totals || {},
      daily: stats.daily || {},
      last_updated: stats.last_updated,
      unique_users: Object.keys(stats.users || {}).length
    };
    return res.status(200).json(safe);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
