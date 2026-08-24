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
