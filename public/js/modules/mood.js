// Genopoisk Mood Module — "Что посмотреть?" by mood
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  // Mood → genre/rating/year filters for Kinopoisk API
  var MOODS = [
    { id: 'relax', emoji: '😎', label: 'Расслабиться', params: { order: 'NUM_VOTE', ratingFrom: 7, ratingTo: 10, yearFrom: 2015, yearTo: 2026, type: 'FILM' } },
    { id: 'think', emoji: '🧠', label: 'Подумать', params: { order: 'RATING', ratingFrom: 8, ratingTo: 10, yearFrom: 1990, yearTo: 2026, type: 'FILM' } },
    { id: 'laugh', emoji: '😂', label: 'Посмеяться', params: { order: 'NUM_VOTE', ratingFrom: 7, ratingTo: 10, yearFrom: 2000, yearTo: 2026, type: 'FILM', genres: 'комедия' } },
    { id: 'love', emoji: '❤️', label: 'Романтика', params: { order: 'NUM_VOTE', ratingFrom: 7, ratingTo: 10, yearFrom: 2000, yearTo: 2026, type: 'FILM', genres: 'мелодрама' } },
    { id: 'scare', emoji: '💀', label: 'Испугаться', params: { order: 'NUM_VOTE', ratingFrom: 6, ratingTo: 10, yearFrom: 2000, yearTo: 2026, type: 'FILM', genres: 'ужасы' } },
    { id: 'night', emoji: '🌙', label: 'На ночь', params: { order: 'RATING', ratingFrom: 8, ratingTo: 10, yearFrom: 1990, yearTo: 2026, type: 'FILM' } }
  ];

  App.MOOD = {
    getMoods: function() { return MOODS; },

    showMoodSelector: function() {
      // Remove existing
      App.MOOD.hideMoodSelector();

      var overlay = document.createElement('div');
      overlay.id = 'moodSelector';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

      var modal = document.createElement('div');
      modal.style.cssText = 'background:var(--bg-secondary,#1C1C1E);border-radius:24px;padding:32px 24px;max-width:400px;width:100%;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,0.5);';

      var title = document.createElement('div');
      title.style.cssText = 'font-size:22px;font-weight:800;margin-bottom:8px;text-align:center;background:linear-gradient(135deg,#007AFF 0%,#5856D6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';
      title.textContent = 'Что посмотреть?';
      modal.appendChild(title);

      var subtitle = document.createElement('div');
      subtitle.style.cssText = 'font-size:14px;color:rgba(255,255,255,0.6);margin-bottom:24px;text-align:center;';
      subtitle.textContent = 'Выберите настроение';
      modal.appendChild(subtitle);

      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';

      MOODS.forEach(function(mood) {
        var btn = document.createElement('button');
        btn.style.cssText = 'background:var(--bg-tertiary,#2C2C2E);color:#fff;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:18px 12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:6px;transition:all 0.2s;-webkit-tap-highlight-color:transparent;';
        btn.innerHTML = '<div style="font-size:28px;">' + mood.emoji + '</div><div>' + mood.label + '</div>';
        btn.onmouseenter = function() { btn.style.borderColor = '#007AFF'; btn.style.transform = 'translateY(-2px)'; };
        btn.onmouseleave = function() { btn.style.borderColor = 'rgba(255,255,255,0.1)'; btn.style.transform = ''; };
        btn.onclick = function() {
          App.MOOD.hideMoodSelector();
          App.MOOD.loadByMood(mood);
        };
        grid.appendChild(btn);
      });

      modal.appendChild(grid);

      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'margin-top:20px;width:100%;background:rgba(255,255,255,0.08);color:#fff;border:none;padding:12px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;';
      closeBtn.textContent = 'Отмена';
      closeBtn.onclick = function() { App.MOOD.hideMoodSelector(); };
      modal.appendChild(closeBtn);

      overlay.appendChild(modal);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) App.MOOD.hideMoodSelector(); });
      document.body.appendChild(overlay);
    },

    hideMoodSelector: function() {
      var existing = document.getElementById('moodSelector');
      if (existing) existing.remove();
    },

    loadByMood: async function(mood) {
      App.UI.clearFilms();
      App.UI.showLoader();
      var searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = '';
      var actionsEl = document.querySelector('.actions');
      if (actionsEl) actionsEl.style.display = 'none';

      try {
        var params = mood.params;
        var year = new Date().getFullYear();
        var url = App.CORE.API_BASE + '/v2.2/films?order=' + (params.order || 'NUM_VOTE') +
          '&type=' + (params.type || 'FILM') +
          '&ratingFrom=' + (params.ratingFrom || 0) +
          '&ratingTo=' + (params.ratingTo || 10) +
          '&yearFrom=' + (params.yearFrom || 1900) +
          '&yearTo=' + (params.yearTo || year) +
          '&page=1';
        if (params.genres) url += '&genres=' + encodeURIComponent(params.genres);

        var data = await App.MOVIES.apiGet(url);
        var films = App.MOVIES.extractFilms(data);

        // Pick random 12 films from first 2 pages for variety
        if (films.length > 12) {
          films = films.sort(function() { return Math.random() - 0.5; }).slice(0, 12);
        }

        if (films.length > 0) {
          App.UI.displayFilms(films);
          App.TRACKING.trackEvent('categories_opened', { category: 'mood_' + mood.id });
        } else {
          App.UI.showEmptyState('Не нашли фильмов для настроения "' + mood.label + '"');
        }
      } catch (e) {
        App.UI.showEmptyState('Ошибка: ' + e.message);
      }
    }
  };

  // Expose globally
  window.showMoodSelector = App.MOOD.showMoodSelector;
})();
