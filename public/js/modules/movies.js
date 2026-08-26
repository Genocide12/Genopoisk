// Genopoisk Movies Module — catalog loading, search, favorites, pagination
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  var currentCategory = null;
  var currentPage = 1;
  var hasMore = true;
  var isLoading = false;
  var filmBuffer = [];
  var MOBILE_INITIAL = 8;
  var MOBILE_CHUNK = 6;

  App.MOVIES = {
    getState: function() {
      return { currentCategory: currentCategory, currentPage: currentPage, hasMore: hasMore, isLoading: isLoading };
    },
    setCategory: function(cat) { currentCategory = cat; },
    resetPagination: function() { currentPage = 1; hasMore = true; filmBuffer = []; },
    setBuffer: function(buf) { filmBuffer = buf; },
    getBuffer: function() { return filmBuffer; },
    drainBuffer: function() {
      if (filmBuffer.length === 0) return [];
      var chunk = filmBuffer.splice(0, MOBILE_CHUNK);
      return chunk;
    },

    // --- API calls ---
    apiGet: async function(url) {
      var lastErr = null;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          var res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
          if (res.ok) return await res.json();
          var errData = null;
          try { errData = await res.json(); } catch (_) {}
          var isRetryable = (res.status === 429 || res.status === 403 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504);
          if (isRetryable && attempt === 0) {
            lastErr = new Error((errData && errData.message) || ('HTTP ' + res.status));
            await new Promise(function(r) { setTimeout(r, 300); });
            continue;
          }
          if (errData && errData.message) throw new Error(errData.message);
          throw new Error('HTTP ' + res.status);
        } catch (e) {
          lastErr = e;
          if (attempt === 0) { await new Promise(function(r) { setTimeout(r, 300); }); continue; }
          throw e;
        }
      }
      throw lastErr || new Error('Request failed');
    },

    extractFilms: function(data) {
      if (!data) return [];
      return data.films || data.items || data.results || [];
    },

    getPopular: async function(page) {
      page = page || 1;
      var url = App.CORE.API_BASE + '/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=7&ratingTo=10&yearFrom=2020&yearTo=2025&page=' + page;
      return App.MOVIES.extractFilms(await App.MOVIES.apiGet(url));
    },

    getTop250: async function(page) {
      page = page || 1;
      var url = App.CORE.API_BASE + '/v2.2/films/top?type=TOP_250_BEST_FILMS&page=' + page;
      var d = await App.MOVIES.apiGet(url);
      var f = App.MOVIES.extractFilms(d);
      if (f.length === 0) {
        var fb = App.CORE.API_BASE + '/v2.2/films?order=RATING&type=FILM&ratingFrom=8&ratingTo=10&page=' + page;
        return App.MOVIES.extractFilms(await App.MOVIES.apiGet(fb));
      }
      return f;
    },

    getNew: async function(page) {
      page = page || 1;
      var year = new Date().getFullYear();
      var url = App.CORE.API_BASE + '/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=' + year + '&yearTo=' + year + '&page=' + page;
      return App.MOVIES.extractFilms(await App.MOVIES.apiGet(url));
    },

    getRandomFilm: async function() {
      var randomPage = Math.floor(Math.random() * 5) + 1;
      var films = await App.MOVIES.getTop250(randomPage);
      if (films && films.length > 0) return films[Math.floor(Math.random() * films.length)];
      return null;
    },

    searchFilms: async function(query) {
      // Search returns 20 films per page. Fetch first 3 pages = 60 films
      // for better coverage (user complaint: "не находит все фильмы")
      var allFilms = [];
      for (var page = 1; page <= 3; page++) {
        try {
          var url = App.CORE.API_BASE + '/v2.1/films/search-by-keyword?keyword=' + encodeURIComponent(query) + '&page=' + page;
          var data = await App.MOVIES.apiGet(url);
          var films = App.MOVIES.extractFilms(data);
          if (films.length === 0) break;
          allFilms = allFilms.concat(films);
        } catch (e) {
          // If page fails, return what we have
          break;
        }
      }
      return allFilms;
    },

    // --- Category loading ---
    loadCategory: async function(category) {
      currentCategory = category;
      currentPage = 1;
      hasMore = true;
      filmBuffer = [];
      App.UI.clearFilms();
      App.UI.showLoader();
      var searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = '';
      if (window.trackEvent) window.trackEvent('categories_opened', { category: category });
      try {
        if (category === 'random') {
          var film = await App.MOVIES.getRandomFilm();
          if (film) App.UI.displayFilms([film], true);
          else App.UI.showEmptyState('Не удалось загрузить случайный фильм');
        } else {
          // Cache-first: show cached films instantly
          try {
            var cachedRaw = localStorage.getItem('genopoisk_films_' + category + '_1');
            if (cachedRaw) {
              var cached = JSON.parse(cachedRaw);
              if (cached && cached.films && cached.films.length > 0 && (Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000)) {
                if (window.innerWidth <= 768) {
                  var showNow = cached.films.slice(0, MOBILE_INITIAL);
                  filmBuffer = cached.films.slice(showNow.length);
                  App.UI.appendFilms(showNow);
                } else {
                  App.UI.appendFilms(cached.films);
                }
                currentPage = 2;
                App.UI.hideLoader();
                console.log('[cache] Instant load:', category, cached.films.length, 'films');
                App.MOVIES.loadMoreFilms();
                return;
              }
            }
          } catch (_) {}
          await App.MOVIES.loadMoreFilms();
        }
      } catch (e) {
        App.UI.showEmptyState('Ошибка загрузки: ' + e.message);
      }
    },

    loadMoreFilms: async function() {
      if (isLoading || !hasMore || !currentCategory) return;
      if (filmBuffer.length > 0) {
        var chunk = filmBuffer.splice(0, MOBILE_CHUNK);
        App.UI.appendFilms(chunk);
        setTimeout(function() {
          if (currentCategory && hasMore && !isLoading) {
            var scrollPos = window.innerHeight + window.pageYOffset;
            var threshold = document.documentElement.scrollHeight - 800;
            if (scrollPos >= threshold) App.MOVIES.loadMoreFilms();
          }
        }, 100);
        return;
      }
      isLoading = true;
      try {
        var films = [];
        if (currentCategory === 'popular') films = await App.MOVIES.getPopular(currentPage);
        else if (currentCategory === 'top250') films = await App.MOVIES.getTop250(currentPage);
        else if (currentCategory === 'new') films = await App.MOVIES.getNew(currentPage);

        if (films.length > 0) {
          try {
            localStorage.setItem('genopoisk_films_' + currentCategory + '_' + currentPage, JSON.stringify({ films: films, ts: Date.now() }));
          } catch (_) {}
          currentPage++;
          if (window.innerWidth <= 768) {
            var isFirstLoad = document.getElementById('filmGrid').children.length === 0 || document.getElementById('filmGrid').querySelector('.empty-state');
            var showNow = isFirstLoad ? films.slice(0, MOBILE_INITIAL) : films.slice(0, MOBILE_CHUNK);
            filmBuffer = films.slice(showNow.length);
            App.UI.appendFilms(showNow);
          } else {
            App.UI.appendFilms(films);
          }
        } else {
          hasMore = false;
          if (document.getElementById('filmGrid').children.length === 0) App.UI.showEmptyState('Фильмы не найдены');
        }
      } catch (e) {
        // Network errors (ERR_CONNECTION_RESET, AbortError) are common on
        // mobile/VPN/Telegram WebView. Don't show error if films are already
        // on screen from cache — just silently fail the background refresh.
        var cachedFilms = null;
        try {
          var raw = localStorage.getItem('genopoisk_films_' + currentCategory + '_' + currentPage);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.films && (Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000)) cachedFilms = parsed.films;
          }
        } catch (_) {}
        if (cachedFilms && cachedFilms.length > 0) {
          currentPage++;
          App.UI.appendFilms(cachedFilms);
        } else {
          // Only show error if grid is EMPTY — if films already shown (from
          // cache-first), don't disrupt the user with a background error
          var filmGrid = document.getElementById('filmGrid');
          if (filmGrid && filmGrid.children.length === 0) {
            App.UI.showEmptyState('Ошибка загрузки: ' + e.message);
          } else {
            console.warn('[movies] Background fetch failed, films already shown:', e.message);
          }
          hasMore = false;
        }
      } finally {
        isLoading = false;
      }
    },

    loadFavorites: async function() {
      currentCategory = null;
      hasMore = false;
      App.UI.clearFilms();
      App.UI.showLoader();
      var uid = App.CORE.getUserId();
      var initData = App.CORE.getTgInitData();
      // Don't block guests — try /api/me anyway, session cookie may work
      // even if localStorage doesn't have tg_user_id
      try {
        var res = await fetch('/api/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ userId: uid, initData: initData })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        // If user doesn't exist or is guest with no server data
        if (!data.exists && !data.favorites) {
          if (data.is_guest) {
            App.UI.showEmptyState('Войдите через Telegram, чтобы видеть коллекцию');
          } else if (data.reauth) {
            App.UI.showEmptyState('Сессия истекла. Обновите страницу.');
          } else {
            App.UI.showEmptyState('Войдите через Telegram, чтобы видеть коллекцию');
          }
          return;
        }
        var favs = data.favorites || [];
        if (favs.length === 0) {
          App.UI.showEmptyState('В избранном пока пусто. Нажмите ☆ в плеере, чтобы добавить фильм.');
          return;
        }
        var films = favs.map(function(f) {
          return { filmId: f.filmId, nameRu: f.title, year: '—', rating: 'Н/Д' };
        });
        App.UI.displayFilms(films);
      } catch (e) {
        App.UI.showEmptyState('Ошибка загрузки избранного: ' + e.message);
      }
    }
  };

  // Expose globally
  window.loadCategory = App.MOVIES.loadCategory;
  window.loadMoreFilms = App.MOVIES.loadMoreFilms;
  window.loadFavorites = App.MOVIES.loadFavorites;
})();
