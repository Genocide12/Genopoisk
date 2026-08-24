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
