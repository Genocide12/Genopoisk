// Genopoisk Core Module — constants, helpers, user identification
// Loaded BEFORE app.js. Attaches to window.GenopoiskApp namespace.
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  App.CORE = {
    API_BASE: '/api/kinopoisk',
    SW_CACHE_VERSION: '82',

    // --- User identification ---
    // Priority: 1) Stored TG user ID  2) Stable localStorage web_ ID
    getUserId: function() {
      var tgId = localStorage.getItem('genopoisk_tg_user_id');
      if (tgId) return tgId;
      var id = localStorage.getItem('genopoisk_user_id');
      if (!id) {
        var rand = Math.random().toString(36).slice(2, 11);
        var time = Date.now().toString(36);
        id = 'web_' + time + '_' + rand;
        localStorage.setItem('genopoisk_user_id', id);
      }
      return id;
    },

    getTgInitData: function() {
      try {
        var t = window.Telegram && window.Telegram.WebApp;
        return t && t.initData ? t.initData : '';
      } catch (_) { return ''; }
    },

    // --- Escape HTML ---
    escapeHtml: function(s) {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    // --- Mobile detection ---
    isMobileView: function() {
      return window.innerWidth <= 768;
    },

    // --- Constants for pagination ---
    MOBILE_INITIAL: 8,
    MOBILE_CHUNK: 6
  };

  // Expose globally for app.js
  window.API_BASE = App.CORE.API_BASE;
  window.SW_CACHE_VERSION = App.CORE.SW_CACHE_VERSION;
  window.getUserId = App.CORE.getUserId;
  window.getTgInitData = App.CORE.getTgInitData;
})();
// Genopoisk Device Module — TV/projector/mobile detection, theme system
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  App.DEVICE = {
    // --- TV/Projector detection ---
    isTVDevice: function() {
      var ua = (navigator.userAgent || '').toLowerCase();
      var tvPatterns = ['tv', 'television', 'googletv', 'android tv', 'smarttv', 'smart tv',
                        'projector', 'bravia', 'webos', 'tizen', 'hbbtv', 'roku', 'firetv',
                        'aftt', 'aftm', 'bento'];
      for (var i = 0; i < tvPatterns.length; i++) {
        if (ua.indexOf(tvPatterns[i]) !== -1) return true;
      }
      var isAndroid = ua.indexOf('android') !== -1;
      var hasRealTouch = (navigator.maxTouchPoints || 0) > 0;
      if (isAndroid && window.innerWidth >= 1024 && !hasRealTouch) return true;
      return false;
    },

    // --- Mobile detection ---
    isMobile: function() {
      var ua = (navigator.userAgent || '').toLowerCase();
      if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
      return false;
    },

    isIOS: function() {
      var ua = navigator.userAgent || '';
      var platform = navigator.platform || '';
      if (/iPhone|iPad|iPod/i.test(ua)) return true;
      if (platform === 'MacIntel' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
      return false;
    },

    // --- Theme system ---
    getThemeMode: function() {
      try { return localStorage.getItem('genopoisk_theme') || 'dark'; }
      catch (_) { return 'dark'; }
    },

    setThemeMode: function(mode) {
      try { localStorage.setItem('genopoisk_theme', mode); } catch (_) {}
    },

    applyTheme: function(mode) {
      document.body.classList.remove('light-theme', 'night-theme');
      if (mode === 'light') document.body.classList.add('light-theme');
      else if (mode === 'night') document.body.classList.add('night-theme');
      // 'dark' and 'auto' don't add extra classes
      if (mode === 'auto') {
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (!prefersDark) document.body.classList.add('light-theme');
      }
    },

    getCurrentMode: function() {
      return App.DEVICE.getThemeMode();
    },

    cycleTheme: function() {
      var modes = ['dark', 'light', 'night', 'auto'];
      var current = App.DEVICE.getThemeMode();
      var idx = modes.indexOf(current);
      var next = modes[(idx + 1) % modes.length];
      App.DEVICE.setThemeMode(next);
      App.DEVICE.applyTheme(next);
      return next;
    },

    // --- PWA detection ---
    isStandalone: function() {
      try {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
               (window.navigator.standalone === true);
      } catch (_) { return false; }
    },

    isTelegramMiniApp: function(tg) {
      try {
        if (!tg) return false;
        if (tg.initData && tg.initData.length > 0) return true;
        if (tg.platform && tg.platform !== 'unknown') return true;
        return false;
      } catch (_) { return false; }
    }
  };

  // Expose globally
  window.isTVDevice = App.DEVICE.isTVDevice;
  window.isMobileView = function() { return window.innerWidth <= 768; };
})();
// Genopoisk Auth Module — Telegram init, QR login, session management
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  var tg = null;
  var tgInitData = '';
  var qrPollTimer = null;
  var qrModalEl = null;

  App.AUTH = {
    getTg: function() { return tg; },
    getTgInitData: function() { return tgInitData; },

    initTelegramWebApp: function() {
      tg = window.Telegram && window.Telegram.WebApp;
      if (!tg) return null;
      try {
        tg.ready();
        tg.expand();
        if (tg.setHeaderColor) tg.setHeaderColor('#000000');
        if (tg.setBackgroundColor) tg.setBackgroundColor('#000000');
      } catch (_) {}
      tgInitData = tg.initData || '';
      if (tgInitData) {
        try {
          var params = new URLSearchParams(tgInitData);
          var userJson = params.get('user');
          if (userJson) {
            var u = JSON.parse(userJson);
            localStorage.setItem('genopoisk_tg_user_id', String(u.id));
            if (u.username) localStorage.setItem('genopoisk_tg_username', u.username);
            console.log('[tg] Linked TG user ID:', u.id, 'username:', u.username);
          }
        } catch (_) {}
      }
      console.log('[tg] Telegram WebApp initialized, has initData:', !!tgInitData);
      return tg;
    },

    checkTgLoginBar: function() {
      var tgPlatform = (tg && tg.platform) ? tg.platform : 'unknown';
      var isInTelegram = !!(tg && tg.initData) || (tg && tgPlatform && tgPlatform !== 'unknown');
      var storedTgId = localStorage.getItem('genopoisk_tg_user_id');
      var storedTgUsername = localStorage.getItem('genopoisk_tg_username');
      var isLoggedIn = !!(storedTgId || storedTgUsername);

      var fixedBtn = document.getElementById('fixedTelegramBtn');
      var fixedText = document.getElementById('fixedTelegramText');
      var isTVDevice = App.DEVICE.isTVDevice();

      if (!fixedBtn) return;

      if (isInTelegram) {
        fixedBtn.classList.add('hidden');
        fixedBtn.classList.add('hidden-by-tv');
      } else if (isTVDevice && !isLoggedIn) {
        fixedBtn.classList.remove('hidden');
        fixedBtn.classList.remove('hidden-by-tv');
        if (fixedText) fixedText.textContent = '📱 Войти по QR-коду';
        fixedBtn.href = '#';
        fixedBtn.onclick = function(e) { e.preventDefault(); App.AUTH.showQrLoginModal(); return false; };
      } else if (isTVDevice && isLoggedIn) {
        fixedBtn.classList.add('hidden');
        fixedBtn.classList.add('hidden-by-tv');
      } else {
        fixedBtn.classList.remove('hidden');
        if (fixedText) {
          if (isLoggedIn) {
            fixedText.textContent = 'Открыть Telegram';
            fixedBtn.href = 'https://t.me/Genopoiskbot?start=app';
            fixedBtn.onclick = null;
          } else {
            fixedText.textContent = 'Открыть Telegram';
            var guestId = localStorage.getItem('genopoisk_user_id');
            if (guestId && guestId.indexOf('web_') === 0) {
              fixedBtn.href = '/api/auth/telegram/login?guest_id=' + encodeURIComponent(guestId);
            } else {
              fixedBtn.href = '/api/auth/telegram/login';
            }
            fixedBtn.onclick = null;
          }
        }
      }
    },

    checkAuth: async function() {
      var tgId = localStorage.getItem('genopoisk_tg_user_id');
      var tgUsername = localStorage.getItem('genopoisk_tg_username');
      if (!tgId && !tgUsername) return;
      if (tg && tg.initData) return;
      try {
        var res = await fetch('/api/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ userId: tgId, username: tgUsername, initData: App.CORE.getTgInitData() })
        });
        var data = await res.json();
        if (data.reauth) {
          localStorage.removeItem('genopoisk_tg_user_id');
          localStorage.removeItem('genopoisk_tg_user_name');
          localStorage.removeItem('genopoisk_tg_username');
          window.location.reload();
        }
      } catch (e) { console.warn('[auth] check failed:', e); }
    },

    // --- QR Login ---
    showQrLoginModal: function() {
      App.AUTH.hideQrLoginModal();
      qrModalEl = document.createElement('div');
      qrModalEl.id = 'qrLoginModal';
      qrModalEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
      qrModalEl.innerHTML =
        '<div style="background:#1c1c1e;color:#fff;border-radius:20px;padding:32px 24px;max-width:360px;width:100%;text-align:center;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.5);">' +
          '<div style="font-size:18px;font-weight:700;margin-bottom:8px;">📱 Вход по QR-коду</div>' +
          '<div style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:20px;line-height:1.5;">Отсканируйте код камерой телефона или в Telegram, чтобы войти на проекторе</div>' +
          '<div id="qrCodeContainer" style="background:#fff;padding:16px;border-radius:12px;margin-bottom:16px;display:inline-block;">' +
            '<div style="width:200px;height:200px;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;">Генерация...</div>' +
          '</div>' +
          '<div id="qrStatus" style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:16px;">⏳ Ожидание сканирования...</div>' +
          '<div id="qrTimer" style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:16px;"></div>' +
          '<button id="qrCloseBtn" style="width:100%;background:rgba(255,255,255,0.1);color:#fff;border:none;padding:12px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Отмена</button>' +
        '</div>';
      document.body.appendChild(qrModalEl);
      var closeBtn = qrModalEl.querySelector('#qrCloseBtn');
      if (closeBtn) closeBtn.onclick = function() { App.AUTH.hideQrLoginModal(); };
      qrModalEl.addEventListener('click', function(e) { if (e.target === qrModalEl) App.AUTH.hideQrLoginModal(); });
      App.AUTH.generateQrCode();
    },

    hideQrLoginModal: function() {
      if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
      if (qrModalEl) { qrModalEl.remove(); qrModalEl = null; }
    },

    generateQrCode: async function() {
      try {
        var res = await fetch('/api/auth/qr', { method: 'POST' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        var sessionId = data.sessionId;
        var qrUrl = data.qrUrl;
        var expiresAt = data.expiresAt;
        var qrImg = qrModalEl.querySelector('#qrCodeContainer');
        if (qrImg) {
          var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrUrl);
          qrImg.innerHTML = '<img src="' + qrSrc + '" width="200" height="200" alt="QR" style="display:block;border-radius:4px;" loading="eager">';
        }
        if (qrPollTimer) clearInterval(qrPollTimer);
        qrPollTimer = setInterval(function() { App.AUTH.pollQrStatus(sessionId); }, 2000);
        App.AUTH.updateQrTimer(expiresAt);
        setInterval(function() { App.AUTH.updateQrTimer(expiresAt); }, 1000);
      } catch (e) {
        console.error('[qr] Generate failed:', e);
      }
    },

    updateQrTimer: function(expiresAt) {
      if (!qrModalEl) return;
      var timerEl = qrModalEl.querySelector('#qrTimer');
      if (!timerEl) return;
      var remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      if (remaining <= 0) {
        timerEl.textContent = '⏰ QR-код истёк';
        if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
        return;
      }
      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      timerEl.textContent = 'Действителен ещё: ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
    },

    pollQrStatus: async function(sessionId) {
      try {
        var res = await fetch('/api/auth/qr?session=' + encodeURIComponent(sessionId));
        if (!res.ok) return;
        var data = await res.json();
        if (data.status === 'confirmed' && data.telegramId) {
          if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
          localStorage.setItem('genopoisk_tg_user_id', String(data.telegramId));
          if (data.username) localStorage.setItem('genopoisk_tg_username', data.username);
          if (data.displayName) localStorage.setItem('genopoisk_tg_user_name', data.displayName);
          localStorage.removeItem('genopoisk_user_id');
          if (qrModalEl) {
            var statusEl = qrModalEl.querySelector('#qrStatus');
            if (statusEl) statusEl.innerHTML = '✅ <b style="color:#34C759;">Вход выполнен!</b><br>Перенаправление...';
          }
          setTimeout(function() { window.location.reload(); }, 1500);
        }
      } catch (e) { console.warn('[qr] Poll failed:', e); }
    },

    handleOAuthRedirect: function() {
      var urlParams = new URLSearchParams(window.location.search);
      var telegramLogin = urlParams.get('telegram_login');
      var tgIdFromUrl = urlParams.get('tg_id');
      var tgNameFromUrl = urlParams.get('tg_name');
      var tgUsernameFromUrl = urlParams.get('tg_username');

      if (telegramLogin === 'success' && tgIdFromUrl) {
        localStorage.setItem('genopoisk_tg_user_id', String(tgIdFromUrl));
        if (tgNameFromUrl) localStorage.setItem('genopoisk_tg_user_name', tgNameFromUrl);
        if (tgUsernameFromUrl) localStorage.setItem('genopoisk_tg_username', tgUsernameFromUrl);
        localStorage.removeItem('genopoisk_user_id');
        history.replaceState(null, '', window.location.pathname);
        window.location.reload();
      } else if (telegramLogin === 'error') {
        console.error('[tg] OIDC login error:', urlParams.get('message'));
        history.replaceState(null, '', window.location.pathname);
      } else if (tgIdFromUrl && !telegramLogin) {
        localStorage.setItem('genopoisk_tg_user_id', String(tgIdFromUrl));
        if (tgNameFromUrl) localStorage.setItem('genopoisk_tg_user_name', tgNameFromUrl);
        history.replaceState(null, '', window.location.pathname);
        window.location.reload();
      }
    }
  };

  // Expose globally
  window.checkTgLoginBar = App.AUTH.checkTgLoginBar;
  window.checkAuth = App.AUTH.checkAuth;
  window.showQrLoginModal = App.AUTH.showQrLoginModal;
  window.openPlayer = function(filmId, title) {
    window.location.href = 'player.html?id=' + filmId + '&title=' + encodeURIComponent(title);
  };
})();
// Genopoisk UI Module — loader, empty states, film display, toast
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  App.UI = {
    showLoader: function() {
      var content = document.getElementById('content');
      var loader = document.getElementById('loader');
      if (content) content.classList.remove('hidden');
      if (loader) loader.classList.remove('hidden');
    },

    hideLoader: function() {
      var loader = document.getElementById('loader');
      if (loader) loader.classList.add('hidden');
    },

    showEmptyState: function(msg) {
      var filmGrid = document.getElementById('filmGrid');
      if (filmGrid) {
        filmGrid.innerHTML = '<div class="empty-state">' + (msg || 'Фильмы не найдены') + '</div>';
      }
      App.UI.hideLoader();
    },

    clearFilms: function() {
      var filmGrid = document.getElementById('filmGrid');
      if (filmGrid) {
        filmGrid.innerHTML = '';
        filmGrid.classList.remove('centered');
        filmGrid.classList.remove('random-mode');
      }
    },

    // --- Toast ---
    showToast: function(msg, duration) {
      duration = duration || 3000;
      var toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;z-index:9999;max-width:90%;text-align:center;';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, duration);
    },

    // --- Film card rendering ---
    displayFilms: function(films, forceCenter) {
      if (!films || films.length === 0) {
        if (document.getElementById('filmGrid').children.length === 0) {
          App.UI.showEmptyState('Фильмы не найдены');
        }
        return;
      }
      App.UI.appendFilms(films, forceCenter);
    },

    appendFilms: function(films, forceCenter) {
      var filmGrid = document.getElementById('filmGrid');
      if (!filmGrid) return;
      var SW = window.SW_CACHE_VERSION || '67';
      var isMobile = window.innerWidth <= 768;
      var eagerCount = isMobile ? 6 : 12;

      var frag = document.createDocumentFragment();
      films.forEach(function(film, index) {
        var filmId = film.filmId || film.kinopoiskId;
        var title = film.nameRu || film.nameEn || 'Без названия';
        var year = film.year || 'Н/Д';
        var rating = film.rating || film.ratingKinopoisk || 'Н/Д';
        var genres = '';
        if (film.genres && film.genres.length > 0) {
          genres = film.genres.slice(0, 3).map(function(g) { return g.genre; }).join(', ');
        }
        // Use direct poster URL from API data (faster — no proxy needed).
        // Fallback to /api/poster proxy if direct URL fails.
        var directPoster = film.posterUrlPreview || film.posterUrl || '';
        var proxyPoster = filmId ? '/api/poster?id=' + filmId + '&size=small&_v=' + SW : '';
        var poster = directPoster || proxyPoster;
        var isAboveFold = index < eagerCount;
        var loadingAttr = isAboveFold ? 'eager' : 'lazy';
        var fetchPriority = isAboveFold ? 'fetchpriority="high"' : '';

        var card = document.createElement('div');
        card.className = 'film-card';
        if (index < 10) card.style.animationDelay = (index * 0.04) + 's';

        var img = document.createElement('img');
        img.src = poster;
        img.alt = title;
        img.loading = loadingAttr;
        img.decoding = 'async';
        if (fetchPriority) img.setAttribute('fetchpriority', 'high');
        img.classList.add('film-poster');
        img.onload = function() { this.classList.add('loaded'); };
        img.onerror = function() {
          if (directPoster && proxyPoster) {
            // Try proxy as fallback
            this.onerror = function() {
              this.classList.add('error');
              this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22><rect fill=%22%232C2C2E%22 width=%22200%22 height=%22300%22/><text x=%22100%22 y=%22160%22 text-anchor=%22middle%22 fill=%22%2398989D%22 font-size=%2214%22>Нет постера</text></svg>';
            };
            this.src = proxyPoster;
          } else {
            this.classList.add('error');
            this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22><rect fill=%22%232C2C2E%22 width=%22200%22 height=%22300%22/><text x=%22100%22 y=%22160%22 text-anchor=%22middle%22 fill=%22%2398989D%22 font-size=%2214%22>Нет постера</text></svg>';
          }
        };
        card.appendChild(img);

        var info = document.createElement('div');
        info.className = 'film-info';
        var metaHtml = '<span>' + year + '</span>';
        if (genres) metaHtml += '<span class="film-genres">' + genres + '</span>';
        if (rating !== 'Н/Д') metaHtml += '<span class="rating">⭐ ' + rating + '</span>';
        info.innerHTML = '<div class="film-title">' + App.CORE.escapeHtml(title) + '</div><div class="film-meta">' + metaHtml + '</div>';
        card.appendChild(info);
        card.dataset.filmId = filmId || '';
        card.dataset.title = title;
        card.dataset.year = year;
        card.dataset.rating = (rating !== 'Н/Д') ? rating : '';
        card.dataset.poster = poster || '';
        card.onclick = function() { window.openPlayer(filmId, title); };
        frag.appendChild(card);
      });
      filmGrid.appendChild(frag);
      App.UI.hideLoader();
      if (forceCenter || films.length === 1) {
        filmGrid.classList.add('centered');
      }
    }
  };

  // Expose globally
  window.showLoader = App.UI.showLoader;
  window.hideLoader = App.UI.hideLoader;
  window.showEmptyState = App.UI.showEmptyState;
  window.clearFilms = App.UI.clearFilms;
  window.displayFilms = App.UI.displayFilms;
  window.appendFilms = App.UI.appendFilms;
})();
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
      // Try cached films first (instant — no API call)
      var cachedCats = ['top250', 'popular', 'new'];
      for (var i = 0; i < cachedCats.length; i++) {
        try {
          var raw = localStorage.getItem('genopoisk_films_' + cachedCats[i] + '_1');
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.films && parsed.films.length > 0 && 
                (Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000)) {
              var films = parsed.films;
              return films[Math.floor(Math.random() * films.length)];
            }
          }
        } catch (_) {}
      }
      // No cache — fetch from API (slower, ~1-2s)
      var randomPage = Math.floor(Math.random() * 3) + 1; // pages 1-3 only (cached)
      var films = await App.MOVIES.getTop250(randomPage);
      if (films && films.length > 0) return films[Math.floor(Math.random() * films.length)];
      return null;
    },

    searchFilms: async function(query) {
      // Search returns 20 films per page. Fetch 2 pages = 40 films.
      var allFilms = [];
      for (var page = 1; page <= 2; page++) {
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
// Genopoisk App — Main orchestrator
// Loads modules and wires up UI events. All logic lives in modules.
(function() {
  'use strict';

  // ====== Global error handler ======
  window.addEventListener('error', function(e) {
    if (e.message && e.message.indexOf('Script error') === -1) {
      console.error('[global-error]', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno);
    }
  });
  window.addEventListener('unhandledrejection', function(e) {
    console.error('[unhandled-rejection]', e.reason && e.reason.message ? e.reason.message : e.reason);
  });

  var App = window.GenopoiskApp;
  var tg = null;

  // ====== Init Telegram WebApp ======
  tg = App.AUTH.initTelegramWebApp();

  // ====== Handle OAuth redirect (if returning from Telegram login) ======
  App.AUTH.handleOAuthRedirect();

  // ====== Setup login bar + auth check ======
  if (!window.Telegram) {
    App.AUTH.checkTgLoginBar();
    App.AUTH.checkAuth();
  }
  window.addEventListener('load', function() {
    if (!tg) tg = App.AUTH.initTelegramWebApp();
    App.AUTH.checkTgLoginBar();
    App.AUTH.checkAuth();
  });
  setInterval(function() { if (!(tg && tg.initData)) App.AUTH.checkAuth(); }, 120000);

  // ====== Resume card setup ======
  var resumeClose = document.getElementById('resumeClose');
  if (resumeClose) {
    resumeClose.addEventListener('click', function(e) {
      e.stopPropagation();
      var resumeCard = document.getElementById('resumeCard');
      if (resumeCard) resumeCard.classList.remove('visible');
    });
  }
  var resumeCard = document.getElementById('resumeCard');
  if (resumeCard) {
    resumeCard.addEventListener('click', function() {
      var film = App.TRACKING.getResumeFilm();
      if (film) {
        var startPos = (typeof film.position === 'number' && film.position > 5) ? film.position : 0;
        var tParam = startPos > 0 ? '&t=' + startPos : '';
        setTimeout(function() { window.location.href = 'player.html?id=' + film.filmId + '&title=' + encodeURIComponent(film.title) + tParam; }, 100);
      }
    });
  }
  App.TRACKING.loadResumeCard();
  App.TRACKING.prefetchAll();

  // ====== Track initial page view ======
  App.TRACKING.trackEvent('page_views', { path: '/' });

  // ====== Global openPlayer (also defined in auth.js, but ensure it's available) ======
  if (!window.openPlayer) {
    window.openPlayer = function(filmId, title) {
      window.location.href = 'player.html?id=' + filmId + '&title=' + encodeURIComponent(title);
    };
  }

  // ====== Action card clicks + touch press effect ======
  function setupTouchPressEffect(el) {
    el.addEventListener('touchstart', function() {
      el.classList.add('pressing');
    }, { passive: true });
    el.addEventListener('touchend', function() { el.classList.remove('pressing'); }, { passive: true });
    el.addEventListener('touchcancel', function() { el.classList.remove('pressing'); }, { passive: true });
    el.addEventListener('mousedown', function() { el.classList.add('pressing'); });
    el.addEventListener('mouseup', function() { el.classList.remove('pressing'); });
    el.addEventListener('mouseleave', function() { el.classList.remove('pressing'); });
  }

  document.querySelectorAll('.action-card, .film-card, .resume-card').forEach(function(card) {
    setupTouchPressEffect(card);
    if (card.classList.contains('action-card')) {
      card.addEventListener('click', function() {
        var cat = card.dataset.cat;
        if (cat === 'favorites') App.MOVIES.loadFavorites();
        else App.MOVIES.loadCategory(cat);
      });
    }
  });

  // Re-apply touch press effect to dynamically added film cards
  var filmGrid = document.getElementById('filmGrid');
  if (filmGrid) {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node && node.classList && node.classList.contains('film-card') && !node.dataset.pressSetup) {
            node.dataset.pressSetup = '1';
            setupTouchPressEffect(node);
          }
        });
      });
    });
    observer.observe(filmGrid, { childList: true });
  }

  // ====== Search ======
  var searchInput = document.getElementById('searchInput');
  var searchClear = document.getElementById('searchClear');
  var actionsEl = document.querySelector('.actions');
  var searchTimeout;

  function hideCategories() { if (actionsEl) actionsEl.style.display = 'none'; }
  function showCategories() { if (actionsEl) actionsEl.style.display = ''; }

  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      var query = searchInput.value.trim();
      if (searchClear) searchClear.classList.toggle('visible', !!query);
      if (!query) {
        showCategories();
        App.UI.clearFilms();
        return;
      }
      hideCategories();
      searchTimeout = setTimeout(async function() {
        App.UI.clearFilms();
        App.UI.showLoader();
        try {
          var films = await App.MOVIES.searchFilms(query);
          App.UI.displayFilms(films, films.length === 1);
          App.TRACKING.trackEvent('searches', { query: query });
        } catch (e) { App.UI.showEmptyState('Ошибка поиска: ' + e.message); }
      }, 250);
    });

    searchInput.addEventListener('focus', function() {
      if (searchInput.value.trim()) hideCategories();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', function() {
      searchInput.value = '';
      searchClear.classList.remove('visible');
      showCategories();
      App.UI.clearFilms();
      searchInput.blur();
    });
  }

  // ====== Scroll: hide/show fixed button + infinite scroll ======
  var scrollTimeout;
  var lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimeout);
    var currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var fixedBtn = document.getElementById('fixedTelegramBtn');
    if (fixedBtn && !fixedBtn.classList.contains('hidden-by-tv')) {
      if (currentScrollY > lastScrollY + 5 && currentScrollY > 50) fixedBtn.classList.add('hidden');
      else if (currentScrollY < lastScrollY - 5) fixedBtn.classList.remove('hidden');
    }
    lastScrollY = currentScrollY;
    scrollTimeout = setTimeout(function() {
      var scrollPos = (window.pageYOffset || document.documentElement.scrollTop || 0) + window.innerHeight;
      var threshold = document.documentElement.scrollHeight - 800;
      var state = App.MOVIES.getState();
      if (scrollPos >= threshold && state.currentCategory && state.currentCategory !== 'random' && !state.isLoading && state.hasMore) {
        App.MOVIES.loadMoreFilms();
      }
    }, 100);
  });

  // ====== Service Worker ======
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      // Force unregister old SW versions, then register new one
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        regs.forEach(function(reg) {
          reg.unregister().then(function() {
            console.log('[sw] Unregistered old SW:', reg.scope);
          }).catch(function() {});
        });
        // Register fresh SW
        return navigator.serviceWorker.register('/sw.js', { scope: '/' });
      }).then(function(reg) {
        console.log('[sw] registered, scope:', reg.scope);
        // Check for updates every 5 min
        setInterval(function() { reg.update().catch(function() {}); }, 300000);
        var hasReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', function() {
          if (!hasReloaded) { hasReloaded = true; console.log('[sw] controller changed — reload'); window.location.reload(); }
        });
      }).catch(function(e) { console.warn('[sw] registration failed:', e); });

      // Also clear ALL caches (force fresh start)
      if (window.caches) {
        caches.keys().then(function(names) {
          names.forEach(function(name) {
            caches.delete(name).then(function() {
              console.log('[sw] Deleted cache:', name);
            });
          });
        });
      }
    });
  }

  // ====== PWA install button (mobile only) ======
  function pwaIsStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone === true);
    } catch (_) { return false; }
  }
  function pwaIsTelegramMiniApp() {
    // Check multiple signals — tg may not be ready yet on first call
    if (tg && tg.initData) return true;
    if (tg && tg.platform && tg.platform !== 'unknown') return true;
    try {
      var t = window.Telegram && window.Telegram.WebApp;
      if (t && t.initData) return true;
      if (t && t.platform && t.platform !== 'unknown') return true;
    } catch (_) {}
    return false;
  }
  function pwaIsIOS() { return App.DEVICE.isIOS(); }
  function pwaIsMobile() { return App.DEVICE.isMobile(); }

  function pwaShowInstallInfoButton() {
    if (pwaIsTelegramMiniApp() || pwaIsStandalone() || !pwaIsMobile()) return;
    var btn = document.createElement('button');
    btn.id = 'pwaInstallInfoBtn';
    btn.textContent = '📲';
    btn.title = 'Как установить приложение';
    btn.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#007AFF;color:#fff;border:none;width:52px;height:52px;border-radius:50%;font-size:24px;cursor:pointer;z-index:1000;box-shadow:0 4px 16px rgba(0,122,255,0.5);font-family:inherit;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;justify-content:center;line-height:1;';
    document.body.appendChild(btn);
    var deferredPrompt = null;
    var isIOS = pwaIsIOS();
    window.addEventListener('beforeinstallprompt', function(e) { e.preventDefault(); deferredPrompt = e; });
    window.addEventListener('appinstalled', function() { btn.remove(); });
    btn.addEventListener('click', function() {
      if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function() { deferredPrompt = null; }).catch(function() {}); }
      else if (isIOS) { pwaShowIosInstructions(); }
      else { pwaShowAndroidInstructions(); }
    });
  }

  function pwaShowIosInstructions() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#1c1c1e;color:#fff;border-radius:18px;padding:24px;max-width:340px;width:100%;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
    modal.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:14px;">📲 Установка на iPhone/iPad</div><div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);"><p style="margin:0 0 10px;">1. Нажмите кнопку <b>«Поделиться»</b> внизу Safari (квадрат со стрелкой вверх ▲).</p><p style="margin:0 0 10px;">2. В меню выберите <b>«На экран Домой»</b> (➕).</p><p style="margin:0 0 10px;">3. Нажмите <b>«Добавить»</b> в правом верхнем углу.</p><p style="margin:0;">Приложение появится на главном экране.</p></div><button id="pwaIosClose" style="margin-top:18px;width:100%;background:#007AFF;color:#fff;border:none;padding:12px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Понятно</button>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay || e.target.id === 'pwaIosClose') overlay.remove(); });
  }

  function pwaShowAndroidInstructions() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#1c1c1e;color:#fff;border-radius:18px;padding:24px;max-width:340px;width:100%;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
    var ua = navigator.userAgent || '';
    var browserName = 'браузере';
    if (ua.indexOf('Firefox') !== -1) browserName = 'Firefox';
    else if (ua.indexOf('SamsungBrowser') !== -1) browserName = 'Samsung Internet';
    else if (ua.indexOf('Edg/') !== -1) browserName = 'Edge';
    else if (ua.indexOf('Chrome') !== -1) browserName = 'Chrome';
    modal.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:14px;">📲 Установка на Android</div><div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);"><p style="margin:0 0 10px;">1. Нажмите меню <b>⋮</b> в ' + browserName + '.</p><p style="margin:0 0 10px;">2. Выберите <b>«Установить приложение»</b> или <b>«На главный экран»</b>.</p><p style="margin:0;">Приложение появится на главном экране.</p></div><button id="pwaAndroidClose" style="margin-top:18px;width:100%;background:#007AFF;color:#fff;border:none;padding:12px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Понятно</button>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay || e.target.id === 'pwaAndroidClose') overlay.remove(); });
  }
  // Delay PWA button check — let Telegram script load first
  setTimeout(pwaShowInstallInfoButton, 2000);

  // ====== Long-press film info popup ======
  var LONGPRESS_DURATION = 500;
  var LONGPRESS_MOVE_TOLERANCE = 10;
  var filmInfoOverlay = document.getElementById('filmInfoOverlay');
  var filmInfoPopup = document.getElementById('filmInfoPopup');
  var fipPoster = document.getElementById('fipPoster');
  var fipTitle = document.getElementById('fipTitle');
  var fipMeta = document.getElementById('fipMeta');
  var fipOpenBtn = document.getElementById('fipOpen');
  var fipCloseBtn = document.getElementById('fipClose');
  var pendingFilmId = null;
  var pendingFilmTitle = null;

  function showFilmInfoPopup(card) {
    if (!filmInfoPopup || !filmInfoOverlay) return;
    var filmId = card.dataset.filmId;
    var title = card.dataset.title || 'Без названия';
    var year = card.dataset.year || '';
    var rating = card.dataset.rating || '';
    var poster = card.dataset.poster || '';
    pendingFilmId = filmId;
    pendingFilmTitle = title;
    if (poster) { fipPoster.loading = 'lazy'; fipPoster.decoding = 'async'; fipPoster.src = poster; fipPoster.style.display = 'block'; }
    else { fipPoster.style.display = 'none'; }
    fipTitle.textContent = title;
    var metaHtml = '';
    if (year) metaHtml += '<span>' + year + '</span>';
    if (rating) metaHtml += '<span class="rating">⭐ ' + rating + '</span>';
    fipMeta.innerHTML = metaHtml;
    filmInfoOverlay.classList.add('visible');
    filmInfoPopup.classList.add('visible');
  }

  function hideFilmInfoPopup() {
    if (filmInfoOverlay) filmInfoOverlay.classList.remove('visible');
    if (filmInfoPopup) filmInfoPopup.classList.remove('visible');
  }

  if (fipCloseBtn) fipCloseBtn.addEventListener('click', hideFilmInfoPopup);
  if (fipOpenBtn) fipOpenBtn.addEventListener('click', function() {
    if (pendingFilmId) window.location.href = 'player.html?id=' + pendingFilmId + '&title=' + encodeURIComponent(pendingFilmTitle);
  });
  if (filmInfoOverlay) filmInfoOverlay.addEventListener('click', function(e) { if (e.target === filmInfoOverlay) hideFilmInfoPopup(); });

  function attachLongPress(card) {
    var timer = null;
    var startX = 0, startY = 0;
    var moved = false;
    card.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      moved = false;
      timer = setTimeout(function() {
        if (!moved) { e.preventDefault(); showFilmInfoPopup(card); }
      }, LONGPRESS_DURATION);
    }, { passive: false });
    card.addEventListener('touchmove', function(e) {
      if (e.touches.length !== 1) return;
      var dx = Math.abs(e.touches[0].clientX - startX);
      var dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > LONGPRESS_MOVE_TOLERANCE || dy > LONGPRESS_MOVE_TOLERANCE) {
        moved = true;
        if (timer) { clearTimeout(timer); timer = null; }
      }
    }, { passive: true });
    card.addEventListener('touchend', function() { if (timer) { clearTimeout(timer); timer = null; } });
    card.addEventListener('touchcancel', function() { if (timer) { clearTimeout(timer); timer = null; } });
  }

  // Attach long-press to existing cards (delegated for future cards)
  document.getElementById('filmGrid').addEventListener('DOMNodeInserted', function(e) {
    if (e.target && e.target.classList && e.target.classList.contains('film-card') && !e.target.dataset.longpressAttached) {
      e.target.dataset.longpressAttached = '1';
      attachLongPress(e.target);
    }
  });

  // ====== Theme toggle (click on hero title) ======
  var heroTitle = document.querySelector('.hero-title');
  if (heroTitle) {
    heroTitle.addEventListener('click', function() {
      var mode = App.DEVICE.cycleTheme();
      App.UI.showToast('Тема: ' + mode, 1500);
    });
  }

  // Apply initial theme
  App.DEVICE.applyTheme(App.DEVICE.getThemeMode());

  // Auto theme re-evaluation every 30 min
  setInterval(function() {
    if (App.DEVICE.getThemeMode() === 'auto') App.DEVICE.applyTheme('auto');
  }, 30 * 60 * 1000);

  console.log('[app] Genopoisk initialized, modules loaded');
})();
