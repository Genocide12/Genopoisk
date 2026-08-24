// API client module — single source of truth for all API calls.
// Replaces scattered fetch() calls throughout app.js.
//
// Usage:
//   import { api } from './modules/api.js';
//   const films = await api.movies.getPopular(1);
//   const user = await api.user.getState();

const API_BASE = '/api/kinopoisk';

export const api = {
  // Movies / catalog
  movies: {
    async getPopular(page = 1) {
      const url = `${API_BASE}/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=7&ratingTo=10&yearFrom=2020&yearTo=2025&page=${page}`;
      return extractFilms(await apiGet(url));
    },

    async getTop250(page = 1) {
      const url = `${API_BASE}/v2.2/films/top?type=TOP_250_BEST_FILMS&page=${page}`;
      const d = await apiGet(url);
      const f = extractFilms(d);
      if (f.length === 0) {
        const fb = `${API_BASE}/v2.2/films?order=RATING&type=FILM&ratingFrom=8&ratingTo=10&page=${page}`;
        return extractFilms(await apiGet(fb));
      }
      return f;
    },

    async getNew(page = 1) {
      const year = new Date().getFullYear();
      const url = `${API_BASE}/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=${year}&yearTo=${year}&page=${page}`;
      return extractFilms(await apiGet(url));
    },

    async getRandom() {
      const randomPage = Math.floor(Math.random() * 5) + 1;
      const films = await api.movies.getTop250(randomPage);
      if (films && films.length > 0) return films[Math.floor(Math.random() * films.length)];
      return null;
    },

    async search(query) {
      const url = `${API_BASE}/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=1`;
      return extractFilms(await apiGet(url));
    }
  },

  // User state (merged endpoint)
  user: {
    async getState(initData, userId) {
      const res = await fetch('/api/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, userId })
      });
      if (!res.ok) return null;
      return res.json();
    }
  },

  // Tracking
  track: {
    async event(type, data = {}) {
      try {
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, ...data })
        });
      } catch (_) {}
    }
  },

  // Auth
  auth: {
    async qrGenerate() {
      const res = await fetch('/api/auth/qr', { method: 'POST' });
      return res.ok ? res.json() : null;
    },

    async qrStatus(sessionId) {
      const res = await fetch('/api/auth/qr?session=' + encodeURIComponent(sessionId));
      return res.ok ? res.json() : null;
    }
  }
};

// Helper: GET with retry
async function apiGet(url) {
  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      if (res.ok) return await res.json();

      var errData = null;
      try { errData = await res.json(); } catch (_) {}

      var isRetryable = (res.status === 429 || res.status === 403 ||
                         res.status === 500 || res.status === 502 ||
                         res.status === 503 || res.status === 504);
      if (isRetryable && attempt === 0) {
        lastErr = new Error((errData && errData.message) || ('HTTP ' + res.status));
        await new Promise(function(r) { setTimeout(r, 300); });
        continue;
      }
      if (errData && errData.message) throw new Error(errData.message);
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      lastErr = e;
      if (attempt === 0) {
        await new Promise(function(r) { setTimeout(r, 300); });
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Request failed');
}

function extractFilms(data) {
  if (!data) return [];
  return data.films || data.items || data.results || [];
}
