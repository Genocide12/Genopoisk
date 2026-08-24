// Genopoisk Core Module — constants, helpers, user identification
// Loaded BEFORE app.js. Attaches to window.GenopoiskApp namespace.
(function() {
  'use strict';
  var App = window.GenopoiskApp = window.GenopoiskApp || {};

  App.CORE = {
    API_BASE: '/api/kinopoisk',
    SW_CACHE_VERSION: '69',

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
