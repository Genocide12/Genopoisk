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
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function(reg) {
        console.log('[sw] registered, scope:', reg.scope);
        setInterval(function() { reg.update().catch(function() {}); }, 60000);
        var hasReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', function() {
          if (!hasReloaded) { hasReloaded = true; window.location.reload(); }
        });
      }).catch(function(e) { console.warn('[sw] registration failed:', e); });
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
