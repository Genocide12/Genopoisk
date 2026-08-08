// GitHub API helper for stats storage
const GH_TOKEN = process.env.GH_STATS_TOKEN || process.env.GITHUB_TOKEN;
const STATS_REPO = process.env.STATS_REPO || 'Genocide12/genopoisk-stats';
const STATS_FILE = 'stats.json';
const GH_API = 'https://api.github.com';

async function ghHeaders() {
  if (!GH_TOKEN) throw new Error('GITHUB_TOKEN not set');
  return {
    'Authorization': `token ${GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
}

async function readStats() {
  const headers = await ghHeaders();
  const res = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, { headers });
  if (res.status === 404) {
    return { totals: { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0 }, users: {}, daily: {}, recent_events: [], last_updated: null, _sha: null };
  }
  if (!res.ok) throw new Error(`GitHub read ${res.status}`);
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  content._sha = data.sha;
  return content;
}

async function writeStats(stats) {
  const headers = await ghHeaders();
  const sha = stats._sha;
  delete stats._sha;
  stats.last_updated = new Date().toISOString();

  const body = {
    message: `chore: update stats ${stats.last_updated}`,
    content: Buffer.from(JSON.stringify(stats, null, 2)).toString('base64'),
    branch: 'main'
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub write ${res.status}: ${err}`);
  }
  const data = await res.json();
  stats._sha = data.content.sha;
  return stats;
}

async function recordEvent(eventType, payload = {}) {
  const stats = await readStats();

  // Increment totals
  if (!stats.totals) {
    stats.totals = { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0 };
  }
  const totalKey = eventType in stats.totals ? eventType : null;
  if (totalKey) stats.totals[totalKey] = (stats.totals[totalKey] || 0) + 1;

  // Track unique users
  if (payload.userId) {
    if (!stats.users) stats.users = {};
    if (!stats.users[payload.userId]) {
      stats.users[payload.userId] = { first_seen: new Date().toISOString(), events: 0 };
    }
    stats.users[payload.userId].events = (stats.users[payload.userId].events || 0) + 1;
    stats.users[payload.userId].last_seen = new Date().toISOString();
  }

  // Daily stats
  const today = new Date().toISOString().slice(0, 10);
  if (!stats.daily) stats.daily = {};
  if (!stats.daily[today]) {
    stats.daily[today] = { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0, unique_users: 0 };
  }
  if (totalKey) stats.daily[today][totalKey] = (stats.daily[today][totalKey] || 0) + 1;

  // Recent events (keep last 50)
  if (!stats.recent_events) stats.recent_events = [];
  stats.recent_events.unshift({
    type: eventType,
    ts: new Date().toISOString(),
    ...payload
  });
  if (stats.recent_events.length > 50) {
    stats.recent_events = stats.recent_events.slice(0, 50);
  }

  // Count unique users today
  const todayUsers = Object.entries(stats.users || {})
    .filter(([_, v]) => v.last_seen && v.last_seen.startsWith(today))
    .length;
  stats.daily[today].unique_users = todayUsers;

  await writeStats(stats);
  return stats;
}

module.exports = { readStats, writeStats, recordEvent };
