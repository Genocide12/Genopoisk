// Supabase helper — single source of truth for user data
// Uses telegram_id as PRIMARY KEY (unique per Telegram account)
// NO more web_ IDs, NO more OIDC sub, NO more duplicates.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

// Upsert user by telegram_id — creates if not exists, updates if exists.
// Defensive: if the request fails (e.g. unknown column because migration
// wasn't applied yet), retry with a smaller payload that only uses the
// original columns. This way the app keeps working even before the SQL
// migration is applied.
async function upsertUser(telegramId, data) {
  if (!telegramId) return null;
  const url = SUPABASE_URL + '/rest/v1/users?on_conflict=telegram_id';
  const body = {
    telegram_id: String(telegramId),
    ...data
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[supabase] upsertUser error:', res.status, errText);
    // Retry without new columns (favorite_films, search_history, sessions)
    // in case the SQL migration hasn't been applied yet.
    const fallbackBody = { ...body };
    delete fallbackBody.favorite_films;
    delete fallbackBody.search_history;
    delete fallbackBody.sessions;
    delete fallbackBody.is_premium;
    delete fallbackBody.premium_since;
    const res2 = await fetch(url, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(fallbackBody)
    });
    if (!res2.ok) {
      console.error('[supabase] upsertUser fallback error:', res2.status, await res2.text());
      return null;
    }
    const rows2 = await res2.json();
    return rows2[0] || null;
  }
  const rows = await res.json();
  return rows[0] || null;
}

// Get user by telegram_id
async function getUser(telegramId) {
  if (!telegramId) return null;
  const url = SUPABASE_URL + '/rest/v1/users?telegram_id=eq.' + encodeURIComponent(telegramId);
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// Get all users
async function getAllUsers() {
  const url = SUPABASE_URL + '/rest/v1/users?order=last_seen.desc&limit=100';
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return [];
  return await res.json();
}

// Get user by username (legacy fallback — prefer telegram_id / oidc_sub lookups)
async function getUserByUsername(username) {
  if (!username) return null;
  const cleanName = username.replace(/^@/, '');
  const url = SUPABASE_URL + '/rest/v1/users?username=eq.' + encodeURIComponent(cleanName) + '&limit=1';
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// Get user by OIDC sub (the long subject identifier from Telegram OIDC id_token).
// Used as a fallback when looking up browser sessions after migration.
async function getUserByOidcSub(oidcSub) {
  if (!oidcSub) return null;
  const url = SUPABASE_URL + '/rest/v1/users?oidc_sub=eq.' + encodeURIComponent(oidcSub) + '&limit=1';
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return (rows && rows[0]) || null;
}

// Update user fields. Same defensive retry as upsertUser.
async function updateUser(telegramId, updates) {
  const url = SUPABASE_URL + '/rest/v1/users?telegram_id=eq.' + encodeURIComponent(telegramId);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[supabase] updateUser error:', res.status, errText);
    // Retry without new columns
    const fallbackUpdates = { ...updates };
    delete fallbackUpdates.favorite_films;
    delete fallbackUpdates.search_history;
    delete fallbackUpdates.sessions;
    delete fallbackUpdates.is_premium;
    delete fallbackUpdates.premium_since;
    const res2 = await fetch(url, {
      method: 'PATCH',
      headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify(fallbackUpdates)
    });
    if (!res2.ok) {
      console.error('[supabase] updateUser fallback error:', res2.status);
      return null;
    }
    const rows2 = await res2.json();
    return rows2[0] || null;
  }
  const rows = await res.json();
  return rows[0] || null;
}

// Parse User-Agent into a compact device description.
// Returns "Safari / iPhone", "Chrome / Windows", "Telegram / Android" etc.
function parseUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return 'неизвестно';
  const uaLower = ua.toLowerCase();

  // Detect Telegram Mini App first (it has Telegram in UA)
  const isTelegram = uaLower.indexOf('telegram') !== -1;

  // Browser
  let browser = 'Браузер';
  if (uaLower.indexOf('edg/') !== -1) browser = 'Edge';
  else if (uaLower.indexOf('chrome') !== -1 || uaLower.indexOf('crios') !== -1) browser = 'Chrome';
  else if (uaLower.indexOf('firefox') !== -1 || uaLower.indexOf('fxios') !== -1) browser = 'Firefox';
  else if (uaLower.indexOf('safari') !== -1) browser = 'Safari';
  else if (uaLower.indexOf('opera') !== -1 || uaLower.indexOf('opr/') !== -1) browser = 'Opera';

  // OS / Device
  let os = 'устройство';
  if (uaLower.indexOf('iphone') !== -1) os = 'iPhone';
  else if (uaLower.indexOf('ipad') !== -1 || (uaLower.indexOf('mac') !== -1 && uaLower.indexOf('mobile') !== -1)) os = 'iPad';
  else if (uaLower.indexOf('android') !== -1) {
    if (uaLower.indexOf('mobile') !== -1) os = 'Android';
    else os = 'Android Tablet';
  }
  else if (uaLower.indexOf('windows') !== -1) os = 'Windows';
  else if (uaLower.indexOf('mac os') !== -1 || uaLower.indexOf('macos') !== -1) os = 'macOS';
  else if (uaLower.indexOf('linux') !== -1) os = 'Linux';

  if (isTelegram) return 'Telegram / ' + os;
  return browser + ' / ' + os;
}

// Normalize ip_history entries to {ip, ua, device, ts} format.
// Old format was a string ("1.2.3.4"); new format is an object.
function normalizeIpHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.map(function(entry) {
    if (typeof entry === 'string') {
      return { ip: entry, ua: '', device: 'неизвестно', ts: '' };
    }
    return {
      ip: entry.ip || '',
      ua: entry.ua || '',
      device: entry.device || (entry.ua ? parseUserAgent(entry.ua) : 'неизвестно'),
      ts: entry.ts || ''
    };
  });
}

// Update or insert a session entry. Session key = (platform, device).
// platform: 'miniapp' | 'browser'
// device: parseUserAgent(ua)
function upsertSession(sessions, platform, device, ip, nowIso) {
  if (!Array.isArray(sessions)) sessions = [];
  const key = platform + '|' + device;
  const filtered = sessions.filter(s => (s.platform + '|' + s.device) !== key);
  filtered.unshift({
    platform: platform,
    device: device,
    ip: ip || '',
    last_seen: nowIso,
    first_seen: (sessions.find(s => (s.platform + '|' + s.device) === key) || {}).first_seen || nowIso
  });
  if (filtered.length > 10) filtered.pop();
  return filtered;
}

// Record an event for a user
async function recordEvent(telegramId, eventType, data) {
  if (!telegramId) return { isNewUser: false };
  data = data || {};

  const nowIso = new Date().toISOString();
  const device = data.ua ? parseUserAgent(data.ua) : (data.device || 'неизвестно');
  const platform = data.platform || (data.ua && data.ua.indexOf('Telegram') !== -1 ? 'miniapp' : 'browser');

  // position_update is special — it does NOT increment events_count,
  // it only updates last_film.position so cross-device resume works.
  if (eventType === 'position_update') {
    const user = await getUser(telegramId);
    if (!user) return; // can't save position for non-existent user
    if (!data.filmId || typeof data.position !== 'number') return;

    const position = Math.max(0, Math.floor(data.position));
    const duration = typeof data.duration === 'number' ? Math.floor(data.duration) : 0;

    // Only update last_film if it's the same film — don't override a different film
    const lastFilm = user.last_film;
    if (lastFilm && String(lastFilm.filmId) === String(data.filmId)) {
      // Update position on existing last_film
      await updateUser(telegramId, {
        last_film: {
          filmId: String(data.filmId),
          title: lastFilm.title || data.title || '',
          ts: nowIso,
          position: position,
          duration: duration || lastFilm.duration || 0
        },
        last_seen: nowIso,
        sessions: upsertSession(user.sessions || [], platform, device, data.ip, nowIso)
      });
    } else {
      // Different film — create new last_film entry with position
      await updateUser(telegramId, {
        last_film: {
          filmId: String(data.filmId),
          title: data.title || '',
          ts: nowIso,
          position: position,
          duration: duration
        },
        last_seen: nowIso,
        sessions: upsertSession(user.sessions || [], platform, device, data.ip, nowIso)
      });
    }

    // Also update position inside watched_films array (so /api/my-films shows it)
    const watched = (user.watched_films || []).map(f => {
      if (String(f.filmId) === String(data.filmId)) {
        return { ...f, position: position, duration: duration || f.duration || 0, ts: nowIso };
      }
      return f;
    });
    await updateUser(telegramId, { watched_films: watched });
    return;
  }

  // premium_refund — stars were refunded, remove premium status
  if (eventType === 'premium_refund') {
    const user = await getUser(telegramId);
    if (!user) return;
    var ebt2 = user.events_by_type || {};
    delete ebt2.premium;
    await updateUser(telegramId, {
      events_by_type: ebt2,
      is_premium: false,
      premium_since: null,
      last_seen: nowIso
    });
    console.log('[supabase] Premium removed for user', telegramId, '(refund)');
    return { isNewUser: false };
  }

  // rate — user rates a film 1-5 stars (from player.html end-of-film overlay
  // or from the bot's 'Мои фильмы' star buttons). Updates watched_films[].rating
  // and rated_films[] array. Does NOT increment events_count (rating is a
  // one-time action, not a tracking event).
  if (eventType === 'rate') {
    const user = await getUser(telegramId);
    if (!user) return;
    if (!data.filmId) return;
    const rating = Math.max(1, Math.min(5, parseInt(data.rating, 10) || 0));
    if (rating < 1) return;

    // Update watched_films — set rating on the matching film
    const watched = (user.watched_films || []).map(f => {
      if (String(f.filmId) === String(data.filmId)) {
        return { ...f, rating: rating };
      }
      return f;
    });

    // Update rated_films — dedupe by filmId
    const rated = (user.rated_films || []).filter(r => String(r.filmId) !== String(data.filmId));
    rated.unshift({
      filmId: String(data.filmId),
      title: data.title || '',
      rating: rating,
      ts: nowIso
    });
    if (rated.length > 50) rated.pop();

    await updateUser(telegramId, {
      watched_films: watched,
      rated_films: rated,
      last_seen: nowIso
    });
    console.log('[supabase] Rating saved:', telegramId, '→ film', data.filmId, '→', rating, '⭐');
    return;
  }

  // favorite_added / favorite_removed
  if (eventType === 'favorite_added' || eventType === 'favorite_removed') {
    const user = await getUser(telegramId);
    if (!user) return;
    if (!data.filmId) return;
    let favs = user.favorite_films || [];
    let watched = user.watched_films || [];
    if (eventType === 'favorite_added') {
      // Add to favorites (dedupe)
      const exists = favs.some(f => String(f.filmId) === String(data.filmId));
      if (!exists) {
        favs.unshift({ filmId: String(data.filmId), title: data.title || '', ts: nowIso });
        if (favs.length > 100) favs.pop();
      }
      // Also add to watched_films if not already there — this ensures the
      // film appears in "Мои фильмы" even if user never opened the player
      const watchedExists = watched.some(f => String(f.filmId) === String(data.filmId));
      if (!watchedExists) {
        watched.unshift({ filmId: String(data.filmId), title: data.title || '', ts: nowIso, position: 0, duration: 0 });
        if (watched.length > 50) watched.pop();
      }
    } else {
      // Remove from favorites only (keep in watched_films)
      favs = favs.filter(f => String(f.filmId) !== String(data.filmId));
    }
    await updateUser(telegramId, { favorite_films: favs, watched_films: watched, last_seen: nowIso });
    return;
  }

  // Get current user
  const user = await getUser(telegramId);
  if (!user) {
    // Create user if doesn't exist.
    // Use only the original columns (no favorite_films/search_history/sessions)
    // so the request succeeds even before the SQL migration is applied.
    // Those columns default to [] in the new schema; if absent, the rest of
    // the code uses `|| []` fallbacks.
    const initialIpHistory = data.ip ? [{ ip: data.ip, ua: data.ua || '', device: device, ts: nowIso }] : [];
    const createData = {
      username: data.username || null,
      ip: data.ip || null,
      ip_history: initialIpHistory,
      events_count: 1,
      events_by_type: { [eventType]: 1 },
      watched_films: [],
      rated_films: []
    };
    // Try with new columns first (in case migration was applied)
    createData.sessions = upsertSession([], platform, device, data.ip, nowIso);
    createData.favorite_films = [];
    createData.search_history = [];
    await upsertUser(telegramId, createData); // upsertUser has fallback
    // If movies_opened, add to watched_films
    if (eventType === 'movies_opened' && data.filmId) {
      await updateUser(telegramId, {
        last_film: { filmId: data.filmId, title: data.title, ts: nowIso, position: 0, duration: 0 },
        watched_films: [{ filmId: data.filmId, title: data.title, ts: nowIso, position: 0, duration: 0 }]
      });
    }
    // Note: 'searches' events only increment the events_by_type counter set
    // above — we no longer save the actual query text to search_history
    // (user-requested removal of search query saving).
    return { isNewUser: true, username: data.username, platform: platform, device: device, ip: data.ip, eventType: eventType };
  }

  // Update existing user
  const updates = {
    last_seen: nowIso,
    events_count: (user.events_count || 0) + 1
  };

  // Update events_by_type
  const ebt = user.events_by_type || {};
  ebt[eventType] = (ebt[eventType] || 0) + 1;
  updates.events_by_type = ebt;

  // Update IP + device info (ip_history as objects)
  if (data.ip) {
    updates.ip = data.ip;
    const ipHistory = normalizeIpHistory(user.ip_history || []);
    // Check if this IP already exists
    const existingIdx = ipHistory.findIndex(e => e.ip === data.ip);
    if (existingIdx !== -1) {
      // Update device/ts for existing IP entry
      ipHistory[existingIdx].ua = data.ua || ipHistory[existingIdx].ua;
      ipHistory[existingIdx].device = device;
      ipHistory[existingIdx].ts = nowIso;
    } else {
      // Add new entry at start
      ipHistory.unshift({ ip: data.ip, ua: data.ua || '', device: device, ts: nowIso });
      if (ipHistory.length > 10) ipHistory.pop();
    }
    updates.ip_history = ipHistory;
  }

  // Update sessions
  updates.sessions = upsertSession(user.sessions || [], platform, device, data.ip, nowIso);

  // Update username if provided and different
  if (data.username && user.username !== data.username) {
    updates.username = data.username.replace(/^@/, '');
  }

  // Add to watched_films if movies_opened
  if (eventType === 'movies_opened' && data.filmId) {
    const watched = user.watched_films || [];
    // Remove if already exists (dedupe)
    const filtered = watched.filter(f => f.filmId !== String(data.filmId));
    filtered.unshift({ filmId: String(data.filmId), title: data.title, ts: nowIso, position: 0, duration: 0 });
    if (filtered.length > 50) filtered.pop();
    updates.watched_films = filtered;
    updates.last_film = { filmId: String(data.filmId), title: data.title, ts: nowIso, position: 0, duration: 0 };
  }

  // Note: 'searches' events only increment the events_by_type counter set
  // above — we no longer save the actual query text to search_history
  // (user-requested removal of search query saving).

  await updateUser(telegramId, updates);
  return { isNewUser: false };
}

// Delete all users (logout all devices)
async function deleteAllUsers() {
  const url = SUPABASE_URL + '/rest/v1/users?id=neq.-1';
  const res = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
  return res.ok;
}

// Delete single user
async function deleteUser(telegramId) {
  const url = SUPABASE_URL + '/rest/v1/users?telegram_id=eq.' + encodeURIComponent(telegramId);
  const res = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
  return res.ok;
}

// Rate a film
async function rateFilm(telegramId, filmId, title, rating) {
  const user = await getUser(telegramId);
  if (!user) return;
  
  // Update watched_films with rating
  const watched = (user.watched_films || []).map(f => {
    if (f.filmId === String(filmId)) return { ...f, rating };
    return f;
  });
  
  // Update rated_films
  const rated = (user.rated_films || []).filter(r => r.filmId !== String(filmId));
  rated.unshift({ filmId: String(filmId), title, rating, ts: new Date().toISOString() });
  if (rated.length > 50) rated.pop();
  
  await updateUser(telegramId, { watched_films: watched, rated_films: rated });
}

module.exports = {
  upsertUser, getUser, getAllUsers, getUserByUsername, getUserByOidcSub,
  updateUser, recordEvent, deleteAllUsers, deleteUser, rateFilm, parseUserAgent
};
