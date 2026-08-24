// Combined user-state endpoint — replaces /api/user-check + /api/last-film + /api/my-films.
//
// One Supabase getUser() call returns everything the page needs:
//   - exists / reauth (was user-check)
//   - last_film (was last-film)
//   - watched_films + favorites + is_premium (was my-films)
//
// Auth: same extractVerifiedUser as the three original endpoints.
// Called on page load from app.js — ONE request instead of THREE.

const { getUser, getUserByOidcSub } = require('./_lib/supabase');
const { extractVerifiedUser } = require('./_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const auth = extractVerifiedUser(body, req);

    // No identifiers → not logged in, nothing to clear
    if (!auth.telegramId) return res.status(200).json({ exists: false, reauth: false });

    // Guest (web_*) sessions — return empty state, no user data.
    // Guest data (watched films, favorites) is stored in localStorage,
    // not fetched from server. This prevents IDOR on guest accounts.
    if (auth.source === 'guest') {
      return res.status(200).json({ exists: false, reauth: false, is_guest: true });
    }

    // IDOR attempt rejected — return empty
    if (auth.source === 'rejected_idor') {
      return res.status(200).json({ exists: false, reauth: false });
    }

    // Mini App initData is always valid — never force reauth
    if (auth.source === 'miniapp') {
      const user = await getUser(auth.telegramId);
      return res.status(200).json(buildPayload(user));
    }

    // Session cookie auth — resolve legacy OIDC sub if needed
    let telegramId = auth.telegramId;
    if (telegramId.length > 12 && !telegramId.startsWith('web_')) {
      const resolved = await getUserByOidcSub(telegramId);
      if (resolved) telegramId = resolved.telegram_id;
    }

    const user = await getUser(telegramId);

    // User not found → force reauth (was user-check behavior)
    if (!user) return res.status(200).json({ exists: false, reauth: true });

    return res.status(200).json(buildPayload(user));
  } catch (e) {
    console.error('[me] error:', e);
    // Fail-open like user-check (avoid surprise logouts on transient failures)
    return res.status(200).json({ exists: false, reauth: false });
  }
};

function buildPayload(user) {
  if (!user) return { exists: false, reauth: true };

  // last-film: only return if watched within last 48h
  var lastFilm = null;
  if (user.last_film) {
    try {
      var age = Date.now() - new Date(user.last_film.ts).getTime();
      if (age <= 48 * 60 * 60 * 1000) {
        lastFilm = {
          filmId: user.last_film.filmId,
          title: user.last_film.title,
          ts: user.last_film.ts,
          position: typeof user.last_film.position === 'number' ? user.last_film.position : 0,
          duration: typeof user.last_film.duration === 'number' ? user.last_film.duration : 0
        };
      }
    } catch (_) {}
  }

  // Build recommendations from user's watched films (genre affinity)
  var recommendations = buildRecommendations(user);

  return {
    exists: true,
    reauth: false,
    user_id: user.telegram_id,
    username: user.username,
    is_premium: !!(user.is_premium || (user.events_by_type && user.events_by_type.premium)),
    last_film: lastFilm,
    watched_films: user.watched_films || [],
    favorites: user.favorite_films || [],
    search_history: user.search_history || [],
    recommendations: recommendations
  };
}

// Build personalized recommendations based on watched history + ratings.
// Returns array of filmIds that user might like (max 10).
function buildRecommendations(user) {
  var watched = user.watched_films || [];
  var rated = user.rated_films || [];
  var favorites = user.favorite_films || [];

  if (watched.length === 0 && favorites.length === 0) return [];

  // Score films: +3 if favorited, +2 if rated 4-5 stars, +1 if watched
  var scores = {};
  watched.forEach(function(f) {
    var id = String(f.filmId);
    scores[id] = (scores[id] || 0) + 1;
  });
  favorites.forEach(function(f) {
    var id = String(f.filmId);
    scores[id] = (scores[id] || 0) + 3;
  });
  rated.forEach(function(f) {
    var id = String(f.filmId);
    if (f.rating >= 4) scores[id] = (scores[id] || 0) + 2;
  });

  // Return top filmIds sorted by score
  return Object.keys(scores)
    .filter(function(id) { return scores[id] >= 2; }) // only films user engaged with
    .sort(function(a, b) { return scores[b] - scores[a]; })
    .slice(0, 10);
}
