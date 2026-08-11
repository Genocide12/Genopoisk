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

// Upsert user by telegram_id — creates if not exists, updates if exists
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
    console.error('[supabase] upsertUser error:', res.status, await res.text());
    return null;
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

// Update user fields
async function updateUser(telegramId, updates) {
  const url = SUPABASE_URL + '/rest/v1/users?telegram_id=eq.' + encodeURIComponent(telegramId);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    console.error('[supabase] updateUser error:', res.status);
    return null;
  }
  const rows = await res.json();
  return rows[0] || null;
}

// Record an event for a user
async function recordEvent(telegramId, eventType, data) {
  if (!telegramId) return;
  data = data || {};

  // position_update is special — it does NOT increment events_count,
  // it only updates last_film.position so cross-device resume works.
  if (eventType === 'position_update') {
    const user = await getUser(telegramId);
    if (!user) return; // can't save position for non-existent user
    if (!data.filmId || typeof data.position !== 'number') return;

    const position = Math.max(0, Math.floor(data.position));
    const duration = typeof data.duration === 'number' ? Math.floor(data.duration) : 0;
    const nowIso = new Date().toISOString();

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
        last_seen: nowIso
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
        last_seen: nowIso
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

  // Get current user
  const user = await getUser(telegramId);
  if (!user) {
    // Create user if doesn't exist
    await upsertUser(telegramId, {
      username: data.username || null,
      ip: data.ip || null,
      ip_history: data.ip ? [data.ip] : [],
      events_count: 1,
      events_by_type: { [eventType]: 1 },
      watched_films: [],
      rated_films: []
    });
    // If movies_opened, add to watched_films
    if (eventType === 'movies_opened' && data.filmId) {
      await updateUser(telegramId, {
        last_film: { filmId: data.filmId, title: data.title, ts: new Date().toISOString(), position: 0, duration: 0 },
        watched_films: [{ filmId: data.filmId, title: data.title, ts: new Date().toISOString(), position: 0, duration: 0 }]
      });
    }
    return;
  }

  // Update existing user
  const updates = {
    last_seen: new Date().toISOString(),
    events_count: (user.events_count || 0) + 1
  };

  // Update events_by_type
  const ebt = user.events_by_type || {};
  ebt[eventType] = (ebt[eventType] || 0) + 1;
  updates.events_by_type = ebt;

  // Update IP
  if (data.ip) {
    updates.ip = data.ip;
    const ipHistory = user.ip_history || [];
    if (!ipHistory.includes(data.ip)) {
      ipHistory.unshift(data.ip);
      if (ipHistory.length > 10) ipHistory.pop();
      updates.ip_history = ipHistory;
    }
  }

  // Update username if provided and different
  if (data.username && user.username !== data.username) {
    updates.username = data.username.replace(/^@/, '');
  }

  // Add to watched_films if movies_opened
  if (eventType === 'movies_opened' && data.filmId) {
    const watched = user.watched_films || [];
    // Remove if already exists (dedupe)
    const filtered = watched.filter(f => f.filmId !== String(data.filmId));
    filtered.unshift({ filmId: String(data.filmId), title: data.title, ts: new Date().toISOString(), position: 0, duration: 0 });
    if (filtered.length > 50) filtered.pop();
    updates.watched_films = filtered;
    updates.last_film = { filmId: String(data.filmId), title: data.title, ts: new Date().toISOString(), position: 0, duration: 0 };
  }

  await updateUser(telegramId, updates);
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
  updateUser, recordEvent, deleteAllUsers, deleteUser, rateFilm
};
