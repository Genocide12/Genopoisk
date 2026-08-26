// Genopoisk Tracking Module — event tracking + resume card
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  var resumeFilm = null;

  App.TRACKING = {
    trackEvent: async function(type, payload) {
      payload = payload || {};
      try {
        var uid = App.CORE.getUserId();
        var initData = App.CORE.getTgInitData();
        var body = { type: type, userId: uid, initData: initData };
        if (payload.filmId) body.filmId = String(payload.filmId);
        if (payload.title) body.title = payload.title;
        if (payload.category) body.category = payload.category;
        if (payload.position !== undefined) body.position = payload.position;
        if (payload.duration !== undefined) body.duration = payload.duration;
        if (payload.rating) body.rating = payload.rating;
        if (payload.query) body.query = payload.query;
        if (payload.path) body.path = payload.path;
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body)
        });
      } catch (e) { console.warn('track error:', e); }
    },

    loadResumeCard: async function() {
      try {
        var uid = App.CORE.getUserId();
        var initData = App.CORE.getTgInitData();
        var filmData = null;

        // Always try server — session cookie may work even for web_* guests
        try {
          var res = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ initData: initData, userId: uid })
          });
          if (res.ok) {
            var data = await res.json();
            if (data.last_film) filmData = data.last_film;
          }
        } catch (e) { console.warn('[resume] server fetch failed:', e); }

        if (!filmData) {
          try {
            var localLast = localStorage.getItem('genopoisk_last_watched_film');
            if (localLast) {
              var parsed = JSON.parse(localLast);
              var age = Date.now() - new Date(parsed.ts).getTime();
              if (age <= 48 * 60 * 60 * 1000) {
                filmData = { filmId: parsed.filmId, title: parsed.title, ts: parsed.ts, position: parsed.position || 0, duration: parsed.duration || 0 };
              }
            }
          } catch (_) {}
        }

        if (!filmData) return;
        var filmAge = Date.now() - new Date(filmData.ts).getTime();
        if (filmAge > 48 * 60 * 60 * 1000) return;

        resumeFilm = filmData;
        var bestPosition = 0;
        if (typeof filmData.position === 'number' && filmData.position > 5) bestPosition = filmData.position;
        if (bestPosition === 0) {
          try {
            var raw = localStorage.getItem('genopoisk_position_' + filmData.filmId);
            if (raw) { var pos = JSON.parse(raw); if (pos && pos.t && pos.t > 5) bestPosition = pos.t; }
          } catch (_) {}
        }

        var resumeCard = document.getElementById('resumeCard');
        var resumeTitle = document.getElementById('resumeTitle');
        var resumeMeta = document.getElementById('resumeMeta');
        if (!resumeCard || !resumeTitle || !resumeMeta) return;

        if (bestPosition > 5) {
          try {
            localStorage.setItem('genopoisk_position_' + filmData.filmId, JSON.stringify({ t: bestPosition, d: filmData.duration || 0, ts: new Date().toISOString(), title: filmData.title }));
          } catch (_) {}
          resumeTitle.textContent = filmData.title;
          resumeMeta.textContent = '▶ с ' + App.TRACKING.formatResumeTime(bestPosition);
        } else {
          resumeTitle.textContent = filmData.title;
          resumeMeta.textContent = 'Продолжить просмотр';
        }

        var posterEl = document.getElementById('resumePoster');
        if (posterEl) {
          posterEl.loading = 'eager';
          posterEl.decoding = 'async';
          posterEl.src = '/api/poster?id=' + encodeURIComponent(filmData.filmId) + '&size=small&_v=' + App.CORE.SW_CACHE_VERSION;
          posterEl.style.display = 'block';
          posterEl.onerror = function() { this.style.display = 'none'; };
        }
        resumeCard.classList.add('visible');
      } catch (e) { console.warn('resume load error:', e); }
    },

    formatResumeTime: function(s) {
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      var sec = Math.floor(s % 60);
      if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    },

    getResumeFilm: function() { return resumeFilm; },

    // --- Tiered prefetch ---
    // Tier 1 (immediate): popular page 1 + poster lambda warm
    // Tier 2 (idle, 2s): top250 + new
    // Tier 3 (idle, 5s): top250 page 2 + posters for all
    prefetchAll: function() {
      var SW = App.CORE.SW_CACHE_VERSION;
      var year = new Date().getFullYear();

      // Tier 1: immediate — most clicked category
      try {
        fetch('/api/poster?id=251733&size=small', { method: 'GET' }).catch(function(){});
        fetch('/api/kinopoisk?q=v2.2/films&order=NUM_VOTE&type=FILM&ratingFrom=7&ratingTo=10&yearFrom=2020&yearTo=2025&page=1')
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) { if (data) App.TRACKING.cacheFilms('popular', 1, data); })
          .catch(function(){});
      } catch(_) {}

      // Tier 2: after 2s idle — top250 + new
      setTimeout(function() {
        try {
          fetch('/api/kinopoisk?q=v2.2/films/top&type=TOP_250_BEST_FILMS&page=1')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
              if (!data) return;
              App.TRACKING.cacheFilms('top250', 1, data);
              // Prefetch posters for first 12 films
              var films = data.films || data.items || [];
              films.slice(0, 12).forEach(function(f) {
                var fid = f.filmId || f.kinopoiskId;
                if (fid) fetch('/api/poster?id=' + fid + '&size=small&_v=' + SW).catch(function(){});
              });
            })
            .catch(function(){});
          fetch('/api/kinopoisk?q=v2.2/films&order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=' + year + '&yearTo=' + year + '&page=1')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) { if (data) App.TRACKING.cacheFilms('new', 1, data); })
            .catch(function(){});
        } catch(_) {}
      }, 2000);

      // Tier 3: after 5s — page 2 of top250 (for scroll)
      setTimeout(function() {
        try {
          fetch('/api/kinopoisk?q=v2.2/films/top&type=TOP_250_BEST_FILMS&page=2')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) { if (data) App.TRACKING.cacheFilms('top250', 2, data); })
            .catch(function(){});
        } catch(_) {}
      }, 5000);
    },

    cacheFilms: function(cat, page, data) {
      try {
        var films = data.films || data.items || data.results || [];
        if (films.length === 0) return;
        localStorage.setItem('genopoisk_films_' + cat + '_' + page, JSON.stringify({ films: films, ts: Date.now() }));
      } catch(_) {}
    }
  };

  // Expose globally
  window.trackEvent = App.TRACKING.trackEvent;
  window.loadResumeCard = App.TRACKING.loadResumeCard;
})();
