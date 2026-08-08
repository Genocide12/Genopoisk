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

function defaultStats() {
  return {
    totals: { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0 },
    users: {},
    daily: {},
    recent_events: [],
    last_updated: null,
    _sha: null
  };
}

function defaultUser() {
  return {
    first_seen: new Date().toISOString(),
    last_seen: null,
    events: 0,
    events_by_type: { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0 },
    username: null,
    ip: null,
    ip_history: [],
    last_film: null
  };
}

async function readStats() {
  const headers = await ghHeaders();
  const res = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, { headers });
  if (res.status === 404) return defaultStats();
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
  // If we have a sha, supply it. If the server says it's stale (422), retry
  // once by re-reading the file to get the latest sha.
  if (sha) body.sha = sha;

  let res = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  });

  // 422 = "sha wasn't supplied" or "sha does not match" — both mean we need
  // to re-read the file first to get the current sha, then retry the write.
  if (res.status === 422 && !sha) {
    // We didn't have a sha — fetch current sha and retry
    const head = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, { headers });
    if (head.ok) {
      const headData = await head.json();
      body.sha = headData.sha;
      res = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body)
      });
    }
  } else if (res.status === 409 || res.status === 422) {
    // Conflict / stale sha — re-read and retry once
    const head = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, { headers });
    if (head.ok) {
      const headData = await head.json();
      body.sha = headData.sha;
      res = await fetch(`${GH_API}/repos/${STATS_REPO}/contents/${STATS_FILE}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body)
      });
    }
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub write ${res.status}: ${err}`);
  }
  const data = await res.json();
  stats._sha = data.content.sha;
  return stats;
}

async function recordEvent(eventType, payload = {}) {
  // Retry the entire read-modify-write cycle on conflict (409/422).
  // This handles concurrent writes from multiple /api/track requests.
  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const stats = await readStats();

      if (!stats.totals) stats.totals = defaultStats().totals;
      const totalKey = eventType in stats.totals ? eventType : null;
      if (totalKey) stats.totals[totalKey] = (stats.totals[totalKey] || 0) + 1;

      // Track unique users with extended info
      if (payload.userId) {
        if (!stats.users) stats.users = {};
        if (!stats.users[payload.userId]) {
          stats.users[payload.userId] = defaultUser();
        }
        const u = stats.users[payload.userId];
        u.events = (u.events || 0) + 1;
        u.last_seen = new Date().toISOString();
        if (payload.username) u.username = payload.username;
        if (!u.events_by_type) u.events_by_type = { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0 };
        if (totalKey) u.events_by_type[totalKey] = (u.events_by_type[totalKey] || 0) + 1;

        // Track IP — keep last known + history of unique IPs (max 10)
        if (payload.ip) {
          u.ip = payload.ip;
          if (!u.ip_history) u.ip_history = [];
          if (!u.ip_history.includes(payload.ip)) {
            u.ip_history.unshift(payload.ip);
            if (u.ip_history.length > 10) u.ip_history = u.ip_history.slice(0, 10);
          }
        }

        // Track last film opened (for "continue watching" feature)
        if (eventType === 'movies_opened' && payload.filmId) {
          u.last_film = {
            filmId: String(payload.filmId).slice(0, 20),
            title: (payload.title || 'Фильм').slice(0, 100),
            ts: new Date().toISOString()
          };
        }
      }

      // Daily stats
      const today = new Date().toISOString().slice(0, 10);
      if (!stats.daily) stats.daily = {};
      if (!stats.daily[today]) {
        stats.daily[today] = { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0, unique_users: 0 };
      }
      if (totalKey) stats.daily[today][totalKey] = (stats.daily[today][totalKey] || 0) + 1;

      // Recent events (keep last 100) — also include IP for audit
      if (!stats.recent_events) stats.recent_events = [];
      stats.recent_events.unshift({
        type: eventType,
        ts: new Date().toISOString(),
        ...payload
      });
      if (stats.recent_events.length > 100) {
        stats.recent_events = stats.recent_events.slice(0, 100);
      }

      // Count unique users today
      const todayUsers = Object.entries(stats.users || {})
        .filter(([_, v]) => v.last_seen && v.last_seen.startsWith(today))
        .length;
      stats.daily[today].unique_users = todayUsers;

      await writeStats(stats);
      return stats;
    } catch (e) {
      lastError = e;
      // If it's a conflict error, wait a bit and retry
      if (e.message && (e.message.includes('409') || e.message.includes('422'))) {
        await new Promise(r => setTimeout(r, 200 * (attempt + 1))); // 200ms, 400ms, 600ms
        continue;
      }
      throw e; // non-conflict error, don't retry
    }
  }
  throw lastError;
}

// Read stats for a single user (sanitized for the response)
async function readUser(userId) {
  const stats = await readStats();
  const user = (stats.users || {})[String(userId)];
  if (!user) return null;
  return { id: String(userId), ...user };
}

module.exports = { readStats, writeStats, recordEvent, readUser, defaultStats, defaultUser };
