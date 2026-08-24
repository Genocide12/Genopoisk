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
        var poster = filmId ? '/api/poster?id=' + filmId + '&size=small&_v=' + SW : '';
        var isAboveFold = index < eagerCount;
        var loadingAttr = isAboveFold ? 'eager' : 'lazy';
        var fetchPriority = isAboveFold ? 'fetchpriority="high"' : '';

        var card = document.createElement('div');
        card.className = 'film-card';
        if (index < 10) card.style.animationDelay = (index * 0.04) + 's';
        card.innerHTML =
          '<img src="' + poster + '" class="film-poster" alt="' + App.CORE.escapeHtml(title) + '" loading="' + loadingAttr + '" ' + fetchPriority + ' decoding="async" onload="this.classList.add(\'loaded\')" onerror="this.classList.add(\'error\');this.src=\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22><rect fill=%22%232C2C2E%22 width=%22200%22 height=%22300%22/><text x=%22100%22 y=%22160%22 text-anchor=%22middle%22 fill=%22%2398989D%22 font-size=%2214%22>Нет постера</text></svg>\'">' +
          '<div class="film-info"><div class="film-title">' + App.CORE.escapeHtml(title) + '</div><div class="film-meta"><span>' + year + '</span>' + (rating !== 'Н/Д' ? '<span class="rating">⭐ ' + rating + '</span>' : '') + '</div></div>';
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
