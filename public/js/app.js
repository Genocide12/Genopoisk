
    // ====== Global error handler — surface JS errors to user ======
    // If any JS error occurs (especially on old Chrome versions on
    // projectors), show it in a small banner so the user knows what's
    // wrong instead of seeing a dead page.
    window.addEventListener('error', function(e) {
      console.error('[global-error]', e.message, e.filename + ':' + e.lineno);
      // Show error to user (but only if it's not a network resource error)
      if (e.message && e.message.indexOf('Script error') === -1) {
        try {
          var errBanner = document.createElement('div');
          errBanner.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;background:#8B0000;color:#fff;padding:10px;border-radius:8px;font-size:12px;z-index:9999;font-family:monospace;max-height:120px;overflow:auto';
          errBanner.textContent = 'JS Error: ' + e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')';
          document.body.appendChild(errBanner);
        } catch (_) {}
      }
    });
    window.addEventListener('unhandledrejection', function(e) {
      var reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
      console.error('[unhandled-rejection]', reason);
    });

    // ====== Copy/inspect protection ======
    // EXCEPT inside the long-press film info popup — there users CAN select
    // and copy the title/year/rating (that's the whole point of the popup).
    function isInsideFilmInfoPopup(el) {
      return !!(el && el.closest && el.closest('.film-info-popup'));
    }
    document.addEventListener('contextmenu', e => {
      if (isInsideFilmInfoPopup(e.target)) return; // allow context menu in popup
      e.preventDefault();
    });
    document.addEventListener('copy', e => {
      if (isInsideFilmInfoPopup(e.target)) return; // allow copy in popup
      e.preventDefault();
    });
    document.addEventListener('cut', e => {
      if (isInsideFilmInfoPopup(e.target)) return;
      e.preventDefault();
    });
    document.addEventListener('selectstart', e => {
      if (isInsideFilmInfoPopup(e.target)) return; // allow text selection in popup
      e.preventDefault();
    });
    document.onkeydown = function(e) {
      // Allow copy/cut shortcuts inside the long-press film info popup
      if (isInsideFilmInfoPopup(e.target)) return;
      const key = e.key || '';
      if (e.ctrlKey && (key === 'c' || key === 'C' || key === 'x' || key === 'X' || key === 'u' || key === 'U' || key === 's' || key === 'S')) {
        e.preventDefault();
        return false;
      }
      if (key === 'F12') {
        e.preventDefault();
        return false;
      }
    };

    const API_BASE = '/api/kinopoisk'; // server-side proxy hides the API key
    const SW_CACHE_VERSION = '67'; // bump when poster cache needs invalidation

    // --- Telegram WebApp init ---
    // Extract TG user ID from initData and store it in localStorage so
    // getUserId() picks it up on subsequent calls.
    let tgInitData = '';
    let tg = null;
    function initTelegramWebApp() {
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
          const params = new URLSearchParams(tgInitData);
          const userJson = params.get('user');
          if (userJson) {
            const u = JSON.parse(userJson);
            localStorage.setItem('genopoisk_tg_user_id', String(u.id));
            if (u.username) localStorage.setItem('genopoisk_tg_username', u.username);
            console.log('[tg] Linked TG user ID:', u.id, 'username:', u.username);
          }
        } catch (_) {}
      }
      console.log('[tg] Telegram WebApp initialized, has initData:', !!tgInitData);
      return tg;
    }
    // Try immediately — in Telegram Mini App, telegram-web-app.js is already loaded
    tg = initTelegramWebApp();

    // --- User identification ---
    // Priority: 1) Stored TG user ID (from previous Telegram visit, in localStorage)
    //           2) Stable localStorage web_ ID (persists across VPN changes)
    // DYNAMIC userId — re-reads localStorage EVERY TIME (not a const!).
    // This handles the case where telegram-web-app.js loads async and stores
    // TG user ID in localStorage AFTER this function was first called.
    function getUserId() {
      const tgId = localStorage.getItem('genopoisk_tg_user_id');
      if (tgId) return tgId;
      let id = localStorage.getItem('genopoisk_user_id');
      if (!id) {
        const rand = Math.random().toString(36).slice(2, 11);
        const time = Date.now().toString(36);
        id = `web_${time}_${rand}`;
        localStorage.setItem('genopoisk_user_id', id);
      }
      return id;
    }

    // --- Telegram login button (bottom fixed bar) ---
    // The old top "tgLoginBar" was removed from HTML; only the bottom
    // #fixedTelegramBtn remains. This function configures it based on
    // login state and device type.
    function checkTgLoginBar() {
      // Detect Telegram Mini App — check multiple signals:
      // 1. tg.initData (signed payload, set after tg.ready())
      // 2. tg.platform !== 'unknown' (set even before initData)
      // 3. window.Telegram.WebApp exists (script loaded)
      var tgPlatform = (tg && tg.platform) ? tg.platform : 'unknown';
      var isInTelegram = !!(tg && tg.initData) ||
                         (tg && tgPlatform && tgPlatform !== 'unknown');
      var storedTgId = localStorage.getItem('genopoisk_tg_user_id');
      var storedTgUsername = localStorage.getItem('genopoisk_tg_username');
      var isLoggedIn = !!(storedTgId || storedTgUsername);

      var fixedBtn = document.getElementById('fixedTelegramBtn');
      var fixedText = document.getElementById('fixedTelegramText');
      var isTVDevice = (function() {
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
      })();

      if (fixedBtn) {
        if (isInTelegram) {
          // Inside Telegram Mini App (including Desktop) — hide bar
          fixedBtn.classList.add('hidden');
          fixedBtn.classList.add('hidden-by-tv');
        } else if (isTVDevice && !isLoggedIn) {
          // TV/projector not logged in — show QR login button
          fixedBtn.classList.remove('hidden');
          fixedBtn.classList.remove('hidden-by-tv');
          if (fixedText) {
            fixedText.textContent = '📱 Войти по QR-коду';
          }
          fixedBtn.href = '#';
          fixedBtn.onclick = function(e) {
            e.preventDefault();
            showQrLoginModal();
            return false;
          };
        } else if (isTVDevice && isLoggedIn) {
          // TV/projector already logged in — hide bar
          fixedBtn.classList.add('hidden');
          fixedBtn.classList.add('hidden-by-tv');
        } else {
          // Regular browser — show login/Telegram button
          fixedBtn.classList.remove('hidden');
          if (fixedText) {
            if (isLoggedIn) {
              fixedText.textContent = 'Открыть Telegram';
              fixedBtn.href = 'https://t.me/Genopoiskbot?start=app';
              fixedBtn.onclick = null;
            } else {
              fixedText.textContent = 'Открыть Telegram';
              // Pass guest_id (web_* ID) to login flow so the OIDC callback
              // can migrate the guest's watched_films/favorites/events to
              // the real Telegram account. Only pass if it's a web_* ID
              // (not a real telegram_id from a previous login).
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
      }
    }

    // ====== QR Login Modal (for projectors/TVs) ======
    // Shows a QR code that the user scans with their phone's Telegram app.
    // The bot confirms the login, and the projector gets authenticated.
    var qrPollTimer = null;
    var qrModalEl = null;

    function showQrLoginModal() {
      // Remove any existing modal
      hideQrLoginModal();

      // Create modal
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

      // Close button
      var closeBtn = qrModalEl.querySelector('#qrCloseBtn');
      if (closeBtn) {
        closeBtn.onclick = function() { hideQrLoginModal(); };
      }
      // Close on overlay click
      qrModalEl.addEventListener('click', function(e) {
        if (e.target === qrModalEl) hideQrLoginModal();
      });

      // Generate QR session
      generateQrCode();
    }

    function hideQrLoginModal() {
      if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
      if (qrModalEl) { qrModalEl.remove(); qrModalEl = null; }
    }

    async function generateQrCode() {
      try {
        var res = await fetch('/api/auth/qr', { method: 'POST' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        var sessionId = data.sessionId;
        var qrUrl = data.qrUrl;
        var expiresAt = data.expiresAt;

        // Render QR code using Google Charts API (reliable, no dependency)
        var qrImg = qrModalEl.querySelector('#qrCodeContainer');
        if (qrImg) {
          var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrUrl);
          qrImg.innerHTML = '<img src="' + qrSrc + '" width="200" height="200" alt="QR код для входа" style="display:block;border-radius:4px;" loading="eager">';
        }

        // Start polling for confirmation
        if (qrPollTimer) clearInterval(qrPollTimer);
        qrPollTimer = setInterval(function() { pollQrStatus(sessionId); }, 2000);

        // Start countdown timer
        updateQrTimer(expiresAt);
        setInterval(function() { updateQrTimer(expiresAt); }, 1000);
      } catch (e) {
        console.error('[qr] Generate failed:', e);
        var container = qrModalEl ? qrModalEl.querySelector('#qrCodeContainer') : null;
        if (container) {
          container.innerHTML = '<div style="color:#ff6b6b;font-size:14px;">Ошибка генерации QR-кода. Попробуйте обновить страницу.</div>';
        }
      }
    }

    function updateQrTimer(expiresAt) {
      if (!qrModalEl) return;
      var timerEl = qrModalEl.querySelector('#qrTimer');
      if (!timerEl) return;
      var remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      if (remaining <= 0) {
        timerEl.textContent = '⏰ QR-код истёк';
        var statusEl = qrModalEl.querySelector('#qrStatus');
        if (statusEl) statusEl.textContent = 'Попросите показать новый QR-код';
        if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
        return;
      }
      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      timerEl.textContent = 'Действителен ещё: ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    async function pollQrStatus(sessionId) {
      try {
        var res = await fetch('/api/auth/qr?session=' + encodeURIComponent(sessionId));
        if (!res.ok) return;
        var data = await res.json();

        if (data.status === 'confirmed' && data.telegramId) {
          // Login confirmed! Store user data and reload.
          if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
          localStorage.setItem('genopoisk_tg_user_id', String(data.telegramId));
          if (data.username) localStorage.setItem('genopoisk_tg_username', data.username);
          if (data.displayName) localStorage.setItem('genopoisk_tg_user_name', data.displayName);
          localStorage.removeItem('genopoisk_user_id');

          // Update UI
          if (qrModalEl) {
            var statusEl = qrModalEl.querySelector('#qrStatus');
            if (statusEl) {
              statusEl.innerHTML = '✅ <b style="color:#34C759;">Вход выполнен!</b><br>Перенаправление...';
            }
            var container = qrModalEl.querySelector('#qrCodeContainer');
            if (container) {
              container.innerHTML = '<div style="width:200px;height:200px;display:flex;align-items:center;justify-content:center;font-size:64px;">✅</div>';
            }
          }

          // Reload after 1.5s
          setTimeout(function() {
            window.location.reload();
          }, 1500);
          return;
        }

        if (data.status === 'expired') {
          if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
          var statusEl2 = qrModalEl ? qrModalEl.querySelector('#qrStatus') : null;
          if (statusEl2) {
            statusEl2.innerHTML = '⏰ <b style="color:#ff6b6b;">QR-код истёк</b><br><button onclick="showQrLoginModal()" style="margin-top:12px;background:var(--ios-blue);color:#fff;border:none;padding:10px 20px;border-radius:10px;font-size:14px;cursor:pointer;">Новый QR-код</button>';
          }
        }
      } catch (e) {
        console.warn('[qr] Poll failed:', e);
      }
    }
    // DON'T call checkTgLoginBar yet — wait for telegram-web-app.js to load
    // (it's async, so tg might be null on first run even in Mini App)

    // Check for ?telegram_login=success&tg_id=... (from OAuth callback redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const telegramLogin = urlParams.get('telegram_login');
    const tgIdFromUrl = urlParams.get('tg_id');
    const tgNameFromUrl = urlParams.get('tg_name');
    const tgUsernameFromUrl = urlParams.get('tg_username');

    if (telegramLogin === 'success' && tgIdFromUrl) {
      // OAuth success — store user data
      localStorage.setItem('genopoisk_tg_user_id', String(tgIdFromUrl));
      if (tgNameFromUrl) localStorage.setItem('genopoisk_tg_user_name', tgNameFromUrl);
      if (tgUsernameFromUrl) localStorage.setItem('genopoisk_tg_username', tgUsernameFromUrl);
      // Clear the guest ID — its data has been migrated server-side by callback.js
      // Keeping it would cause getUserId() to use the old guest ID instead of the
      // new Telegram ID (since getUserId prefers genopoisk_tg_user_id, this isn't
      // strictly necessary, but it's cleaner to remove the stale guest ID).
      localStorage.removeItem('genopoisk_user_id');
      console.log('[tg] OIDC login successful, TG ID:', tgIdFromUrl, 'username:', tgUsernameFromUrl);
      // Clean URL
      history.replaceState(null, '', window.location.pathname);
      window.location.reload();
    } else if (telegramLogin === 'error') {
      const msg = urlParams.get('message') || 'unknown';
      console.error('[tg] OIDC login error:', msg);
      history.replaceState(null, '', window.location.pathname);
    }

    // Also handle ?tg_id= (fallback from bot deep link)
    if (tgIdFromUrl && !telegramLogin) {
      localStorage.setItem('genopoisk_tg_user_id', String(tgIdFromUrl));
      if (tgNameFromUrl) localStorage.setItem('genopoisk_tg_user_name', tgNameFromUrl);
      console.log('[tg] Linked via bot, TG ID:', tgIdFromUrl);
      history.replaceState(null, '', window.location.pathname);
      window.location.reload();
    }

    // --- Check if user still exists in stats (after "logout all devices") ---
    async function checkAuth() {
      const tgId = localStorage.getItem('genopoisk_tg_user_id');
      const tgUsername = localStorage.getItem('genopoisk_tg_username');
      if (!tgId && !tgUsername) return; // not logged in at all
      if (tg && tg.initData) return; // Mini App — always authenticated
      try {
        const res = await fetch('/api/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: tgId, username: tgUsername, initData: getTgInitData() })
        });
        const data = await res.json();
        if (data.reauth) {
          console.log('[auth] User not found, clearing localStorage');
          localStorage.removeItem('genopoisk_tg_user_id');
          localStorage.removeItem('genopoisk_tg_user_name');
          localStorage.removeItem('genopoisk_tg_username');
          window.location.reload();
        }
      } catch (e) { console.warn('[auth] check failed:', e); }
    }

    // --- Wait for telegram-web-app.js to load, then init everything ---
    // This ensures tg is available before checkTgLoginBar and checkAuth
    window.addEventListener('load', function() {
      // Retry TG init (async script should be loaded by now)
      if (!tg) {
        tg = initTelegramWebApp();
      }
      // Now check login bar (tg is set, even in Mini App)
      checkTgLoginBar();
      // Check auth status
      checkAuth();
    });

    // Also try immediately (for browsers without Telegram — checkTgLoginBar shows bar)
    // But only for NON-Mini-App contexts (don't show bar in Mini App)
    if (!window.Telegram) {
      // No Telegram at all — definitely a browser → show login bar
      checkTgLoginBar();
      checkAuth();
    }

    // Periodic auth check — picks up "logout all devices" within ~2 minutes
    // for already-open tabs without requiring a manual page reload.
    // Only runs in browser context (Mini App initData is always authenticated).
    setInterval(function() {
      if (tg && tg.initData) return; // skip Mini App
      checkAuth();
    }, 120000);

    // --- Register service worker for offline PWA support ---
    // Caches the app shell (index.html, icons, manifest, bridge.js) so the
    // main page works offline. Player and API calls always need network.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function(reg) {
          console.log('[sw] registered, scope:', reg.scope);
          // Check for SW updates every 60 seconds — if a new version is
          // deployed, the user gets it within 1 minute instead of next visit.
          // Critical for projectors that stay open 24/7.
          setInterval(function() {
            reg.update().catch(function() {});
          }, 60000);
          // If a new SW takes control, reload the page once to get fresh code
          var hasReloaded = false;
          navigator.serviceWorker.addEventListener('controllerchange', function() {
            if (!hasReloaded) {
              hasReloaded = true;
              console.log('[sw] controller changed — reloading for fresh code');
              window.location.reload();
            }
          });
        }).catch(function(e) {
          console.warn('[sw] registration failed:', e);
        });
      });
    }

    // --- PWA install info (mobile-only) ---
    // Shows a floating "📲 Как установить приложение" button ONLY when:
    //   - NOT in Telegram Mini App
    //   - NOT already running as installed PWA (display-mode: standalone)
    //   - On a mobile device (phone or tablet)
    // Desktop browsers have their own native install prompts (Chrome ⊕ in
    // address bar) so we don't show this button there.
    //
    // Click opens a modal with platform-specific instructions:
    //   - iOS Safari: Share → На экран Домой
    //   - Chrome/Edge Android: uses beforeinstallprompt (native install dialog)
    //     if available, otherwise instructions for menu ⋮
    //   - Firefox / other Android browsers: menu ⋮ → Добавить на главный экран

    function pwaIsStandalone() {
      try {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
               (window.navigator.standalone === true) ||
               (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
      } catch (_) { return false; }
    }

    function pwaIsTelegramMiniApp() {
      try {
        var t = window.Telegram && window.Telegram.WebApp;
        if (!t) return false;
        if (t.initData && t.initData.length > 0) return true;
        if (t.platform && t.platform !== 'unknown') return true;
        return false;
      } catch (_) { return false; }
    }

    function pwaIsIOS() {
      try {
        var ua = navigator.userAgent || '';
        var platform = navigator.platform || '';
        if (/iPhone|iPad|iPod/i.test(ua)) return true;
        // iPadOS 13+ reports as MacIntel with touch
        if (platform === 'MacIntel' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
        return false;
      } catch (_) { return false; }
    }

    function pwaIsMobile() {
      try {
        var ua = navigator.userAgent || '';
        // Android phone, iPhone, iPad, small Windows/Mac touch devices
        if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
        // iPadOS 13+
        if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
        return false;
      } catch (_) { return false; }
    }

    function pwaShowInstallInfoButton() {
      // Skip: Mini App, already-installed PWA, desktop browsers
      if (pwaIsTelegramMiniApp()) return;
      if (pwaIsStandalone()) return;
      if (!pwaIsMobile()) return;

      // Floating button at bottom-right corner (less intrusive than centered bar)
      var btn = document.createElement('button');
      btn.id = 'pwaInstallInfoBtn';
      btn.textContent = '📲';
      btn.title = 'Как установить приложение';
      btn.setAttribute('aria-label', 'Как установить приложение');
      btn.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#007AFF;color:#fff;border:none;width:52px;height:52px;border-radius:50%;font-size:24px;cursor:pointer;z-index:1000;box-shadow:0 4px 16px rgba(0,122,255,0.5);font-family:inherit;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;justify-content:center;line-height:1;';
      document.body.appendChild(btn);

      var deferredPrompt = null;
      var isIOS = pwaIsIOS();

      // Chrome/Edge fire beforeinstallprompt — capture for native flow
      window.addEventListener('beforeinstallprompt', function(e) {
        console.log('[pwa] beforeinstallprompt fired');
        e.preventDefault();
        deferredPrompt = e;
      });

      // If app gets installed (any browser), hide button
      window.addEventListener('appinstalled', function() {
        console.log('[pwa] app installed');
        btn.remove();
      });

      btn.addEventListener('click', function() {
        if (deferredPrompt) {
          // Native Chrome/Edge flow — show install prompt directly
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(function() {
            deferredPrompt = null;
          }).catch(function() {});
        } else if (isIOS) {
          pwaShowIosInstructions();
        } else {
          // Android non-Chrome (Firefox, Samsung Internet, etc.)
          pwaShowAndroidInstructions();
        }
      });
    }

    function pwaShowIosInstructions() {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
      var modal = document.createElement('div');
      modal.style.cssText = 'background:#1c1c1e;color:#fff;border-radius:18px;padding:24px;max-width:340px;width:100%;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
      modal.innerHTML =
        '<div style="font-size:18px;font-weight:700;margin-bottom:14px;">📲 Установка на iPhone/iPad</div>' +
        '<div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);">' +
        '<p style="margin:0 0 10px;">1. Нажмите кнопку <b>«Поделиться»</b> внизу Safari (квадрат со стрелкой вверх ▲).</p>' +
        '<p style="margin:0 0 10px;">2. В меню выберите <b>«На экран&nbsp;Домой»</b> (➕).</p>' +
        '<p style="margin:0 0 10px;">3. Нажмите <b>«Добавить»</b> в правом верхнем углу.</p>' +
        '<p style="margin:0;">Приложение появится на главном экране.</p>' +
        '</div>' +
        '<button id="pwaIosClose" style="margin-top:18px;width:100%;background:#007AFF;color:#fff;border:none;padding:12px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Понятно</button>';
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay || e.target.id === 'pwaIosClose') overlay.remove();
      });
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
      modal.innerHTML =
        '<div style="font-size:18px;font-weight:700;margin-bottom:14px;">📲 Установка на Android</div>' +
        '<div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);">' +
        '<p style="margin:0 0 10px;">В ' + browserName + ':</p>' +
        '<p style="margin:0 0 10px;">1. Нажмите меню браузера (значок <b>⋮</b> в правом верхнем углу).</p>' +
        '<p style="margin:0 0 10px;">2. Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.</p>' +
        '<p style="margin:0 0 10px;">3. Подтвердите установку.</p>' +
        '<p style="margin:0;">Приложение появится на рабочем столе и в списке приложений.</p>' +
        '</div>' +
        '<button id="pwaAndroidClose" style="margin-top:18px;width:100%;background:#007AFF;color:#fff;border:none;padding:12px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Понятно</button>';
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay || e.target.id === 'pwaAndroidClose') overlay.remove();
      });
    }

    // Wait for window load so telegram-web-app.js has a chance to initialize
    // (we need its platform field to detect Mini App).
    window.addEventListener('load', function() {
      setTimeout(pwaShowInstallInfoButton, 300);
    });

    // --- Tracking ---
    // tgInitData is read DYNAMICALLY each time (not cached)
    function getTgInitData() {
      const t = window.Telegram && window.Telegram.WebApp;
      return (t && t.initData) || '';
    }

    async function trackEvent(type, payload = {}) {
      try {
        const tgUsername = localStorage.getItem('genopoisk_tg_username') || '';
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            initData: getTgInitData(),
            userId: getUserId(),
            username: tgUsername,
            ...payload
          })
        });
      } catch (e) { console.warn('track error:', e); }
    }


    // Track initial page view
    trackEvent('page_views', { path: '/' });

    // --- Resume card: load last watched film ---
    const resumeCard = document.getElementById('resumeCard');
    const resumeTitle = document.getElementById('resumeTitle');
    const resumeMeta = document.getElementById('resumeMeta');
    const resumeClose = document.getElementById('resumeClose');
    let resumeFilm = null;

    async function loadResumeCard() {
      try {
        var uid = getUserId();
        var initData = getTgInitData();
        console.log('[resume] loadResumeCard called, uid:', uid, 'initData:', initData ? 'yes' : 'no');

        // Try server first (for logged-in users with cross-device sync)
        var filmData = null;
        if (uid && !uid.startsWith('web_')) {
          try {
            const res = await fetch('/api/me', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ initData: initData, userId: uid })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.last_film) filmData = data.last_film;
            }
          } catch (e) { console.warn('[resume] server fetch failed:', e); }
        }

        // If not logged in OR server returned nothing, check localStorage
        // for a locally-saved last film (guest users)
        if (!filmData) {
          try {
            var localLast = localStorage.getItem('genopoisk_last_watched_film');
            if (localLast) {
              var parsed = JSON.parse(localLast);
              // Check if watched in last 48h
              var age = Date.now() - new Date(parsed.ts).getTime();
              if (age <= 48 * 60 * 60 * 1000) {
                filmData = {
                  filmId: parsed.filmId,
                  title: parsed.title,
                  ts: parsed.ts,
                  position: parsed.position || 0,
                  duration: parsed.duration || 0
                };
                console.log('[resume] Using localStorage film:', filmData.title);
              }
            }
          } catch (_) {}
        }

        if (!filmData) { console.log('[resume] No film found'); return; }

        // Check 48h age
        const filmAge = Date.now() - new Date(filmData.ts).getTime();
        if (filmAge > 48 * 60 * 60 * 1000) { console.log('[resume] Film too old'); return; }

        resumeFilm = filmData;

        // Resolve the best position
        var bestPosition = 0;
        if (typeof filmData.position === 'number' && filmData.position > 5) {
          bestPosition = filmData.position;
        }
        // Also check localStorage for this specific film
        if (bestPosition === 0) {
          try {
            const raw = localStorage.getItem(`genopoisk_position_${filmData.filmId}`);
            if (raw) {
              const pos = JSON.parse(raw);
              if (pos && pos.t && pos.t > 5) bestPosition = pos.t;
            }
          } catch (_) {}
        }

        // Save to localStorage so player.html picks it up
        if (bestPosition > 5) {
          try {
            localStorage.setItem(`genopoisk_position_${filmData.filmId}`, JSON.stringify({
              t: bestPosition,
              d: filmData.duration || 0,
              ts: new Date().toISOString(),
              title: filmData.title
            }));
          } catch (_) {}
          resumeTitle.textContent = filmData.title;
          resumeMeta.textContent = '▶ с ' + formatResumeTime(bestPosition);
        } else {
          resumeTitle.textContent = filmData.title;
          resumeMeta.textContent = 'Продолжить просмотр';
        }

        // Set poster image
        var posterEl = document.getElementById('resumePoster');
        if (posterEl) {
          posterEl.loading = 'eager'; // above the fold
          posterEl.decoding = 'async';
          posterEl.src = '/api/poster?id=' + encodeURIComponent(filmData.filmId) + '&size=small&_v=' + SW_CACHE_VERSION;
          posterEl.style.display = 'block';
          posterEl.onerror = function() { this.style.display = 'none'; };
        }
        resumeCard.classList.add('visible');
      } catch (e) { console.warn('resume load error:', e); }
    }

    function formatResumeTime(s) {
      if (!s || s < 0 || !isFinite(s)) s = 0;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const pad = (n) => n < 10 ? '0' + n : '' + n;
      return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
    }

    resumeCard.addEventListener('click', async (e) => {
      if (e.target === resumeClose) return;
      if (resumeFilm) {
        const tgUsername = localStorage.getItem('genopoisk_tg_username') || '';
        const payload = JSON.stringify({
          type: 'movies_opened',
          initData: getTgInitData(),
          userId: getUserId(),
          username: tgUsername,
          filmId: resumeFilm.filmId,
          title: resumeFilm.title
        });
        try {
          await fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
          });
        } catch (err) {
          console.warn('track error:', err);
          try {
            if (navigator.sendBeacon) {
              const blob = new Blob([payload], { type: 'application/json' });
              navigator.sendBeacon('/api/track', blob);
            }
          } catch (_) {}
        }
        // Pass ?t= so player.html knows the cross-device resume position
        const startPos = (typeof resumeFilm.position === 'number' && resumeFilm.position > 5)
          ? resumeFilm.position
          : 0;
        const tParam = startPos > 0 ? `&t=${startPos}` : '';
        setTimeout(function() {
          window.location.href = `player.html?id=${resumeFilm.filmId}&title=${encodeURIComponent(resumeFilm.title)}${tParam}`;
        }, 100);
      }
    });
    resumeClose.addEventListener('click', (e) => {
      e.stopPropagation();
      resumeCard.classList.remove('visible');
    });

    // Fire async — don't block page load
    loadResumeCard();

    // ====== AGGRESSIVE PREFETCH — warm ALL caches on page load ======
    // Strategy: fire ALL category requests + sample posters IMMEDIATELY
    // when the page loads. By the time user clicks any category, the
    // response is already in Vercel Edge cache → loads in <50ms.
    //
    // Also store results in localStorage so they're available even if
    // the API goes down later.
    //
    // Requests fired (all non-blocking, all .catch to suppress errors):
    //   1. /api/poster?id=251733  — warms poster lambda
    //   2. /api/kinopoisk top-250 page 1  — warms kinopoisk lambda
    //   3. /api/kinopoisk popular page 1  — most clicked category
    //   4. /api/kinopoisk new page 1      — current year films
    //   5. /api/kinopoisk top-250 page 2  — second page (for scroll)
    //   6. Sample posters from top-250    — warm poster cache for first 12 films
    try {
      // Warm lambdas
      fetch('/api/poster?id=251733&size=small', { method: 'GET' }).catch(function(){});

      // Prefetch ALL categories and cache to localStorage
      var prefetchUrls = [
        { cat: 'top250', page: 1, url: '/api/kinopoisk?q=v2.2/films/top&type=TOP_250_BEST_FILMS&page=1' },
        { cat: 'popular', page: 1, url: '/api/kinopoisk?q=v2.2/films&order=NUM_VOTE&type=FILM&ratingFrom=7&ratingTo=10&yearFrom=2020&yearTo=2025&page=1' },
        { cat: 'new', page: 1, url: '/api/kinopoisk?q=v2.2/films&order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=' + new Date().getFullYear() + '&yearTo=' + new Date().getFullYear() + '&page=1' },
        { cat: 'top250', page: 2, url: '/api/kinopoisk?q=v2.2/films/top&type=TOP_250_BEST_FILMS&page=2' }
      ];

      prefetchUrls.forEach(function(p) {
        fetch(p.url, { method: 'GET' })
          .then(function(res) { return res.ok ? res.json() : null; })
          .then(function(data) {
            if (!data) return;
            var films = data.films || data.items || data.results || [];
            if (films.length === 0) return;
            // Cache to localStorage for offline/instant fallback
            try {
              var cacheKey = 'genopoisk_films_' + p.cat + '_' + p.page;
              localStorage.setItem(cacheKey, JSON.stringify({ films: films, ts: Date.now() }));
            } catch (_) {}
            // Prefetch posters for first 12 films (above-the-fold)
            films.slice(0, 12).forEach(function(f) {
              var fid = f.filmId || f.kinopoiskId;
              if (fid) {
                fetch('/api/poster?id=' + fid + '&size=small&_v=' + SW_CACHE_VERSION).catch(function(){});
              }
            });
          })
          .catch(function(){});
      });
    } catch(_) {}

    // Retry after window load — ONLY if we're in Telegram Mini App
    // (telegram-web-app.js loads async, so tgInitData may not be available
    // on first call). In regular browser, initData never appears, so
    // retrying is a waste of a network request.
    window.addEventListener('load', function() {
      // Only retry if we're in Telegram and card is not visible yet
      var isInTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
      if (isInTelegram && !resumeCard.classList.contains('visible')) {
        if (!tg) tg = initTelegramWebApp();
        loadResumeCard();
      }
    });

    let currentCategory = null;
    let currentPage = 1;
    let isLoading = false;
    let hasMore = true;

    // ====== Mobile pagination ======
    // On mobile (Telegram Mini App, phone browsers) loading 20 films at once
    // is wasteful — the screen only shows ~6-8 cards. We fetch a full page
    // (20 films) from Kinopoisk, then display in smaller chunks:
    //   - Initial load: 12 films (visible + a bit of buffer for scroll)
    //   - Each subsequent scroll-load: 8 films
    // On desktop, keep the original behavior (full 20 per page).
    // The "film buffer" holds films fetched but not yet displayed.
    let filmBuffer = [];
    const MOBILE_INITIAL = 8;
    const MOBILE_CHUNK = 6;
    const DESKTOP_PAGE_SIZE = 20;

    function isMobileView() {
      try {
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return true;
      } catch (_) {}
      var ua = navigator.userAgent || '';
      if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
      // iPadOS 13+ reports as MacIntel with touch
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
      return false;
    }

    const content = document.getElementById('content');
    const loader = document.getElementById('loader');
    const filmGrid = document.getElementById('filmGrid');
    const searchInput = document.getElementById('searchInput');

    // ====== Theme system ======
    // Four modes: 'dark' (default), 'light', 'night' (extra dark, low blue),
    // 'auto' (chooses based on time of day + system preference).
    // Click on the 'Genopoisk' title cycles: dark → light → night → auto.
    //
    // Auto mode logic:
    //   - 07:00–19:00 → light (daytime)
    //   - 19:00–22:00 → dark (evening)
    //   - 22:00–07:00 → night (night, low blue light for eye comfort)
    //   - If system prefers-color-scheme is dark, shift one step darker
    //     (day→dark, evening→night, night stays night)
    //
    // Auto mode re-evaluates every 30 minutes (covers sun changing position
    // while the page is open).

    function applyTheme(theme) {
      var body = document.body;
      body.classList.remove('light-theme', 'night-theme');
      if (theme === 'light') {
        body.classList.add('light-theme');
      } else if (theme === 'night') {
        body.classList.add('night-theme');
      }
      // 'dark' = no extra class (default body styles)
      var metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.content = theme === 'light' ? '#F2F2F7' : (theme === 'night' ? '#050510' : '#000000');
      }
    }

    function getAutoTheme() {
      var hour = new Date().getHours();
      var prefersDark = false;
      try {
        prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch (_) {}
      var theme;
      if (hour >= 7 && hour < 19) {
        theme = prefersDark ? 'dark' : 'light';
      } else if (hour >= 19 && hour < 22) {
        theme = prefersDark ? 'night' : 'dark';
      } else {
        theme = 'night';
      }
      return theme;
    }

    function getCurrentThemeMode() {
      return localStorage.getItem('theme_mode') || 'dark';
    }

    function resolveTheme() {
      var mode = getCurrentThemeMode();
      if (mode === 'auto') {
        return getAutoTheme();
      }
      return mode; // 'dark', 'light', or 'night'
    }

    function applyCurrentTheme() {
      applyTheme(resolveTheme());
    }

    function toggleTheme() {
      // Cycle: dark → light → night → auto → dark
      var modes = ['dark', 'light', 'night', 'auto'];
      var current = getCurrentThemeMode();
      var idx = modes.indexOf(current);
      if (idx === -1) idx = 0;
      var next = modes[(idx + 1) % modes.length];
      localStorage.setItem('theme_mode', next);
      applyCurrentTheme();
      // Show a brief toast so user knows which mode they're on
      var labels = window.__themeLabels || { dark: '🌙 Тёмная', light: '☀️ Светлая', night: '🌌 Ночная', auto: '🔄 Авто (по времени)' };
      if (typeof showToast === 'function') {
        showToast(labels[next] || next, 1500);
      } else {
        console.log('[theme] Switched to:', next);
      }
    }

    // Apply theme on load
    applyCurrentTheme();

    // Apply translations based on detected language
    function applyTranslations() {
      var lang = window.__genopoiskLang || 'ru';
      console.log('[i18n] Language:', lang);
      // Hero subtitle
      var hs = document.getElementById('heroSubtitle');
      if (hs) hs.textContent = t('heroSubtitle');
      // Search input placeholder
      var si = document.getElementById('searchInput');
      if (si) si.placeholder = t('searchPlaceholder');
      // Search clear button title
      var sc = document.getElementById('searchClear');
      if (sc) sc.title = t('searchClear');
      // Category cards
      var cards = document.querySelectorAll('.action-card .action-title');
      if (cards.length >= 5) {
        cards[0].textContent = t('catPopular');
        cards[1].textContent = t('catTop250');
        cards[2].textContent = t('catNew');
        cards[3].textContent = t('catRandom');
        cards[4].textContent = t('catFavorites');
      }
      // Resume label
      var rl = document.querySelector('.resume-label');
      if (rl) rl.textContent = t('resumeLabel');
      // Loader text
      var lt = document.querySelector('.loader-text');
      if (lt) lt.textContent = t('loading');
      // Login buttons (legacy — elements may not exist)
      var loginBtn = document.getElementById('tgLoginBtn');
      if (loginBtn) {
        // Find text node inside (after SVG)
        var textNode = null;
        loginBtn.childNodes.forEach(function(n) {
          if (n.nodeType === 3 && n.textContent.trim()) textNode = n;
        });
        if (textNode) textNode.textContent = ' ' + t('loginTelegram') + ' ';
      }
      // Theme toggle labels
      window.__themeLabels = {
        dark: t('themeDark'),
        light: t('themeLight'),
        night: t('themeNight'),
        auto: t('themeAuto')
      };
      // Hero title tooltip
      var ht = document.querySelector('.hero-title');
      if (ht) {
        if (lang === 'en') ht.title = 'Cycle: dark → light → night → auto';
        else ht.title = 'Цикл: тёмная → светлая → ночная → авто';
      }
      // Auto-translate any element with data-i18n attribute
      document.querySelectorAll('[data-i18n]').forEach(function(el) {
        var key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
      });
    }
    applyTranslations();

    // ====== Action card holographic tracking (DESKTOP ONLY) ======
    // Cards ONLY move when:
    //   - Desktop: cursor hovers DIRECTLY over the card (no press needed)
    //     Mousemove within card bounds updates tilt + glow.
    //     Mouseleave → spring back to neutral.
    //   - Mobile (Telegram Mini App, phones, tablets, any touch device):
    //     cards are COMPLETELY STATIC. Touch does nothing — no tilt,
    //     no glow, no tracking. This matches the user's request:
    //     "remove finger-tracking on mobile".
    //
    // Detection: isMobileView() (same helper used for pagination).
    function setupActionCardEffects() {
      // MOBILE = no effects at all on action cards
      if (isMobileView()) {
        return;
      }

      var cards = document.querySelectorAll('.action-card');
      cards.forEach(function(card) {
        var raf = null;

        function updateFromPoint(clientX, clientY) {
          var rect = card.getBoundingClientRect();
          var x = clientX - rect.left;
          var y = clientY - rect.top;
          var px = Math.max(0, Math.min(100, (x / rect.width) * 100));
          var py = Math.max(0, Math.min(100, (y / rect.height) * 100));
          // Reduced tilt: ±6° instead of ±10° — subtler reaction
          var rx = ((y / rect.height) - 0.5) * -12;
          var ry = ((x / rect.width) - 0.5) * 12;
          card.style.setProperty('--mx', px + '%');
          card.style.setProperty('--my', py + '%');
          card.style.setProperty('--rx', rx.toFixed(2) + 'deg');
          card.style.setProperty('--ry', ry.toFixed(2) + 'deg');
        }

        function startTracking() {
          card.classList.add('tracking');
        }
        function stopTracking() {
          card.classList.remove('tracking');
          card.style.setProperty('--mx', '50%');
          card.style.setProperty('--my', '50%');
          card.style.setProperty('--rx', '0deg');
          card.style.setProperty('--ry', '0deg');
        }

        // Desktop: hover-tracking (no button press needed).
        // mousemove over the card itself updates position 1:1.
        card.addEventListener('mouseenter', function(e) {
          startTracking();
          updateFromPoint(e.clientX, e.clientY);
        });
        card.addEventListener('mousemove', function(e) {
          if (raf) cancelAnimationFrame(raf);
          var x = e.clientX, y = e.clientY;
          raf = requestAnimationFrame(function() {
            updateFromPoint(x, y);
          });
        });
        card.addEventListener('mouseleave', stopTracking);
      });
    }

    // ====== Hero title cursor-following glow (DESKTOP ONLY) ======
    // On desktop, the Genopoisk hero title glows brighter where the
    // cursor is. The .cursor-glow class is added on mouseenter over
    // the hero (or any ancestor), and the --cursor-x/y/--cursor-strength
    // CSS vars update on mousemove. On mobile: no effect, just the
    // base animated glow.
    function setupHeroTitleGlow() {
      if (isMobileView()) return;
      var heroTitle = document.querySelector('.hero-title');
      var hero = document.querySelector('.hero');
      if (!heroTitle || !hero) return;
      var raf = null;

      hero.addEventListener('mouseenter', function() {
        heroTitle.classList.add('cursor-glow');
        heroTitle.style.setProperty('--cursor-strength', '1');
      });
      hero.addEventListener('mousemove', function(e) {
        if (raf) cancelAnimationFrame(raf);
        var x = e.clientX, y = e.clientY;
        raf = requestAnimationFrame(function() {
          var rect = heroTitle.getBoundingClientRect();
          // Position relative to hero-title's bounding box
          var px = ((x - rect.left) / rect.width) * 100;
          var py = ((y - rect.top) / rect.height) * 100;
          // Clamp to [-20, 120] so glow extends slightly beyond title
          px = Math.max(-20, Math.min(120, px));
          py = Math.max(-20, Math.min(120, py));
          heroTitle.style.setProperty('--cursor-x', px + '%');
          heroTitle.style.setProperty('--cursor-y', py + '%');
          // Strength = 1 when cursor is near the title, fades to 0.3
          // when cursor is at the edge of the hero section
          var cx = (rect.left + rect.width / 2);
          var cy = (rect.top + rect.height / 2);
          var dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
          var maxDist = 400; // pixels
          var strength = Math.max(0.3, 1 - dist / maxDist);
          heroTitle.style.setProperty('--cursor-strength', strength.toFixed(2));
        });
      });
      hero.addEventListener('mouseleave', function() {
        heroTitle.style.setProperty('--cursor-strength', '0');
        // Keep .cursor-glow class so the fade-out is visible
        setTimeout(function() {
          if (heroTitle.style.getPropertyValue('--cursor-strength') === '0') {
            heroTitle.classList.remove('cursor-glow');
          }
        }, 400);
      });
    }

    // ====== Action card click handler with debounce ======
    // Prevents double-fire in Telegram Mini App where click event can
    // fire twice (once from touchstart→click, once from synthetic click).
    // Also prevents rapid double-tap from triggering the category twice.
    var lastCategoryClick = 0;
    var lastCategoryTarget = null;

    // ====== Touch press effect ======
    // iOS Safari doesn't reliably fire :active CSS pseudo-class.
    // We use touchstart/touchend to add a .pressing class which gives
    // guaranteed visual feedback on ALL mobile browsers.
    function setupTouchPressEffect() {
      // Action cards
      document.querySelectorAll('.action-card, .film-card, .resume-card').forEach(function(el) {
        el.addEventListener('touchstart', function() {
          this.classList.add('pressing');
        }, { passive: true });
        el.addEventListener('touchend', function() {
          this.classList.remove('pressing');
        }, { passive: true });
        el.addEventListener('touchcancel', function() {
          this.classList.remove('pressing');
        }, { passive: true });
        // Also handle mousedown/mouseup for mouse on touch devices
        el.addEventListener('mousedown', function() {
          this.classList.add('pressing');
        });
        el.addEventListener('mouseup', function() {
          this.classList.remove('pressing');
        });
        el.addEventListener('mouseleave', function() {
          this.classList.remove('pressing');
        });
      });
    }

    function setupActionCardClicks() {
      var cards = document.querySelectorAll('.action-card[data-cat]');
      cards.forEach(function(card) {
        card.addEventListener('click', function(e) {
          var cat = card.dataset.cat;
          var now = Date.now();
          if (lastCategoryTarget === card && (now - lastCategoryClick) < 500) {
            return;
          }
          lastCategoryClick = now;
          lastCategoryTarget = card;
          if (cat === 'favorites') {
            loadFavorites();
          } else {
            loadCategory(cat);
          }
        });
        card.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            card.click();
          }
        });
      });
    }

    // Run after DOM is ready (cards must exist before attaching handlers)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setupActionCardEffects();
        setupActionCardClicks();
        setupTouchPressEffect();
        setupHeroTitleGlow();
      });
    } else {
      setupActionCardEffects();
      setupActionCardClicks();
      setupTouchPressEffect();
      setupHeroTitleGlow();
    }

    // Check premium status and show crown badge if premium
    async function checkPremiumStatus() {
      try {
        var uid = getUserId();
        if (!uid || String(uid).indexOf('web_') === 0) return; // guest
        var res = await fetch('/api/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, initData: getTgInitData() })
        });
        if (!res.ok) return;
        var data = await res.json();
        if (data.is_premium) {
          var badge = document.getElementById('premiumBadge');
          if (badge) {
            badge.style.display = 'inline';
            console.log('[premium] Crown badge shown');
          }
        }
      } catch (e) {
        console.warn('[premium] check failed:', e);
      }
    }
    checkPremiumStatus();

    // In auto mode, re-evaluate every 30 minutes
    setInterval(function() {
      if (getCurrentThemeMode() === 'auto') {
        applyCurrentTheme();
      }
    }, 30 * 60 * 1000);

    // Also re-evaluate when system color scheme changes (e.g. user toggles
    // OS dark mode while page is open)
    try {
      var mql = window.matchMedia('(prefers-color-scheme: dark)');
      if (mql && typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', function() {
          if (getCurrentThemeMode() === 'auto') applyCurrentTheme();
        });
      } else if (mql && typeof mql.addListener === 'function') {
        mql.addListener(function() {
          if (getCurrentThemeMode() === 'auto') applyCurrentTheme();
        });
      }
    } catch (_) {}

    // apiGet with automatic retry on 429/403 (Cloudflare IP block from VPN).
    // Uses ES5 syntax (var, function) for compatibility with old Chrome
    // versions on Android projectors (some run Chrome 50-70 which doesn't
    // support let/const/arrow functions).
    //
    // NO TIMEOUT — user wants instant loading. Instead of timing out, we
    // rely on:
    //   1. Aggressive prefetch on page load (warms Vercel Edge cache)
    //   2. Cached films in localStorage (instant fallback if API is slow)
    //   3. Vercel's own 25s maxDuration as the natural upper bound
    async function apiGet(url) {
      var lastErr = null;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          var res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' }
          });
          if (res.ok) return await res.json();

          // Try to parse JSON error response
          var errData = null;
          try { errData = await res.json(); } catch (_) {}

          // Retry on 429, 403, 5xx — all could be transient (VPN block,
          // Cloudflare rate-limit, lambda cold start, etc.)
          var isRetryable = (res.status === 429 || res.status === 403 ||
                             res.status === 500 || res.status === 502 ||
                             res.status === 503 || res.status === 504);
          if (isRetryable && attempt === 0) {
            var msg = (errData && errData.message) || ('HTTP ' + res.status);
            lastErr = new Error(msg);
            console.warn('[apiGet] Got ' + res.status + ', retrying...', msg);
            await new Promise(function(resolve) { setTimeout(resolve, 300); });
            continue;
          }

          // Other errors — throw immediately
          if (errData && errData.message) throw new Error(errData.message);
          throw new Error('HTTP ' + res.status + ': ' + res.statusText);
        } catch (e) {
          // Network error — retry once
          lastErr = e;
          if (attempt === 0) {
            console.warn('[apiGet] Network error, retrying:', e.message);
            await new Promise(function(resolve) { setTimeout(resolve, 300); });
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

    async function getPopular(page = 1) {
      const url = `${API_BASE}/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=7&ratingTo=10&yearFrom=2020&yearTo=2025&page=${page}`;
      return extractFilms(await apiGet(url));
    }

    async function getTop250(page = 1) {
      const url = `${API_BASE}/v2.2/films/top?type=TOP_250_BEST_FILMS&page=${page}`;
      const d = await apiGet(url);
      const f = extractFilms(d);
      if (f.length === 0) {
        const fb = `${API_BASE}/v2.2/films?order=RATING&type=FILM&ratingFrom=8&ratingTo=10&page=${page}`;
        return extractFilms(await apiGet(fb));
      }
      return f;
    }

    async function getNew(page = 1) {
      const currentYear = new Date().getFullYear();
      const url = `${API_BASE}/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=${currentYear}&yearTo=${currentYear}&page=${page}`;
      return extractFilms(await apiGet(url));
    }

    async function getRandomFilm() {
      const randomPage = Math.floor(Math.random() * 5) + 1;
      const films = await getTop250(randomPage);
      if (films && films.length > 0) return films[Math.floor(Math.random() * films.length)];
      return null;
    }

    // In-flight search request — if user types another character while the
    // previous search is still loading, we abort it and start a new one.
    // This prevents stale results from overwriting newer ones, and avoids
    // wasting bandwidth on requests the user no longer cares about.
    let currentSearchController = null;

    async function searchFilms(query) {
      // Abort previous in-flight search
      if (currentSearchController) {
        try { currentSearchController.abort(); } catch (_) {}
      }
      currentSearchController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const url = `${API_BASE}/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=1`;
      try {
        const data = await apiGet(url);
        return extractFilms(data);
      } finally {
        currentSearchController = null;
      }
    }

    function showLoader() {
      content.classList.remove('hidden');
      loader.classList.remove('hidden');
    }

    function hideLoader() {
      loader.classList.add('hidden');
    }

    function clearFilms() {
      filmGrid.innerHTML = '';
      filmGrid.classList.remove('centered');
      filmBuffer = []; // reset mobile pagination buffer
    }

    function showEmptyState(msg) {
      hideLoader();
      filmGrid.classList.remove('centered');
      filmGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">🎬</div><div class="empty-text">${msg}</div></div>`;
    }

    function displayFilms(films, forceCenter = false) {
      clearFilms();
      appendFilms(films, forceCenter);
    }

    // Append films to grid without clearing (for infinite scroll)
    function appendFilms(films, forceCenter = false) {
      if (!films || films.length === 0) {
        if (filmGrid.children.length === 0) showEmptyState('Фильмы не найдены');
        return;
      }
      filmGrid.classList.remove('centered');
      filmGrid.classList.remove('random-mode');
      const frag = document.createDocumentFragment();
      films.forEach((film, index) => {
        const filmId = film.filmId || film.kinopoiskId;
        const title = film.nameRu || film.nameEn || 'Без названия';
        const year = film.year || 'Н/Д';
        const rating = film.rating || film.ratingKinopoisk || 'Н/Д';
        const poster = filmId ? `/api/poster?id=${filmId}&size=small&_v=${SW_CACHE_VERSION}` : '';
        // On mobile: first 6 posters eager (visible above fold), rest lazy.
        // On desktop: first 12 eager (larger screen shows more).
        // This prevents Safari from trying to load 12 posters simultaneously
        // (which causes random load order and slow rendering).
        var eagerCount = isMobileView() ? 6 : 12;
        const isAboveFold = index < eagerCount;
        const loadingAttr = isAboveFold ? 'eager' : 'lazy';
        const fetchPriority = isAboveFold ? 'fetchpriority="high"' : '';
        const card = document.createElement('div');
        card.className = 'film-card';
        if (index < 10) card.style.animationDelay = `${index * 0.04}s`;
        card.innerHTML = `
          <img src="${poster}" class="film-poster" alt="${title}" loading="${loadingAttr}" ${fetchPriority} decoding="async" onload="this.classList.add('loaded')" onerror="this.classList.add('error');this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22><rect fill=%22%232C2C2E%22 width=%22200%22 height=%22300%22/><text x=%22100%22 y=%22160%22 text-anchor=%22middle%22 fill=%22%2398989D%22 font-size=%2214%22>Нет постера</text></svg>'">
          <div class="film-info">
            <div class="film-title">${title}</div>
            <div class="film-meta">
              <span>${year}</span>
              ${rating !== 'Н/Д' ? `<span class="rating">⭐ ${rating}</span>` : ''}
            </div>
          </div>`;
        // Store film data on the card for long-press popup use
        card.dataset.filmId = filmId || '';
        card.dataset.title = title;
        card.dataset.year = year;
        card.dataset.rating = (rating !== 'Н/Д') ? rating : '';
        card.dataset.poster = poster || '';
        card.onclick = () => openPlayer(filmId, title);
        // Attach long-press handler for mobile info popup
        attachLongPress(card);
        frag.appendChild(card);
      });
      filmGrid.appendChild(frag);
      // Hide loader IMMEDIATELY — don't wait for posters.
      // Posters load in background and appear as they arrive.
      hideLoader();
      if (forceCenter || films.length === 1) {
        // Single film (random or search with 1 result) — center it
        filmGrid.classList.add('centered');
      }
      // Show long-press hint once on first batch (touch devices only)
    }

    // ====== Long-press film info popup (mobile) ======
    // On touch devices, :hover doesn't work so film-info is invisible.
    // Long-press (touchstart + hold 500ms without significant move)
    // opens a popup with film details. Inside the popup, text is
    // SELECTABLE so users can copy the title/year (overriding the
    // body-wide copy protection).
    //
    // Also works on desktop: right-click shows the same popup
    // (since contextmenu is prevented globally outside the popup).
    var LONGPRESS_DURATION = 500; // ms
    var LONGPRESS_MOVE_TOLERANCE = 10; // px

    function attachLongPress(card) {
      var pressTimer = null;
      var startX = 0, startY = 0;
      var triggered = false;

      function clearPress() {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      }

      card.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) return;
        var touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        triggered = false;
        clearPress();
        pressTimer = setTimeout(function() {
          triggered = true;
          // Prevent the subsequent click (which would open the player)
          // by calling preventDefault on the touchend.
          showFilmInfoPopup(card);
          // Haptic feedback if available (Telegram Mini App, supported browsers)
          if (tg && tg.HapticFeedback) {
            try { tg.HapticFeedback.notificationOccurred('success'); } catch (_) {}
          } else if (navigator.vibrate) {
            try { navigator.vibrate(15); } catch (_) {}
          }
        }, LONGPRESS_DURATION);
      }, { passive: true });

      card.addEventListener('touchmove', function(e) {
        if (!pressTimer) return;
        var touch = e.touches[0];
        var dx = Math.abs(touch.clientX - startX);
        var dy = Math.abs(touch.clientY - startY);
        if (dx > LONGPRESS_MOVE_TOLERANCE || dy > LONGPRESS_MOVE_TOLERANCE) {
          // User is scrolling — cancel the long-press
          clearPress();
        }
      }, { passive: true });

      card.addEventListener('touchend', function(e) {
        if (triggered) {
          // Long-press fired — prevent the click that follows touchend
          e.preventDefault();
          e.stopPropagation();
          triggered = false;
        }
        clearPress();
      }, { capture: true });

      card.addEventListener('touchcancel', clearPress);

      // Desktop: right-click also shows the popup (since context menu is
      // blocked globally, right-click is otherwise a no-op).
      card.addEventListener('contextmenu', function(e) {
        // On touch devices, the contextmenu event fires AFTER the long-press
        // already handled it — skip to avoid showing popup twice.
        if (isMobileView()) return;
        e.preventDefault();
        e.stopPropagation();
        showFilmInfoPopup(card);
      });
    }

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
      var filmId = card.dataset.filmId;
      var title = card.dataset.title || 'Без названия';
      var year = card.dataset.year || '';
      var rating = card.dataset.rating || '';
      var poster = card.dataset.poster || '';

      pendingFilmId = filmId;
      pendingFilmTitle = title;

      if (poster) {
        fipPoster.loading = 'lazy'; // popup is below fold + on-demand
        fipPoster.decoding = 'async';
        fipPoster.src = poster;
        fipPoster.style.display = 'block';
      } else {
        fipPoster.style.display = 'none';
      }
      fipTitle.textContent = title;
      // Build meta HTML
      var metaHtml = '';
      if (year) metaHtml += '<span>' + escapeHtml(year) + '</span>';
      if (rating) metaHtml += '<span class="fip-rating">⭐ ' + escapeHtml(rating) + '</span>';
      if (!metaHtml) metaHtml = '<span style="opacity:0.6;">—</span>';
      fipMeta.innerHTML = metaHtml;

      filmInfoOverlay.classList.add('visible');
      // Haptic feedback
      if (tg && tg.HapticFeedback) {
        try { tg.HapticFeedback.impactOccurred('light'); } catch (_) {}
      }
    }

    function hideFilmInfoPopup() {
      filmInfoOverlay.classList.remove('visible');
      pendingFilmId = null;
      pendingFilmTitle = null;
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Close on overlay click (outside popup)
    filmInfoOverlay.addEventListener('click', function(e) {
      if (e.target === filmInfoOverlay) hideFilmInfoPopup();
    });
    fipCloseBtn.addEventListener('click', hideFilmInfoPopup);
    // "Смотреть" button → open player (same as clicking the card)
    fipOpenBtn.addEventListener('click', function() {
      if (pendingFilmId) {
        hideFilmInfoPopup();
        openPlayer(pendingFilmId, pendingFilmTitle);
      }
    });
    // ESC closes popup (desktop)
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && filmInfoOverlay.classList.contains('visible')) {
        hideFilmInfoPopup();
      }
    });

    async function openPlayer(filmId, title) {
      const tgUsername = localStorage.getItem('genopoisk_tg_username') || '';
      // Save to localStorage for guest users (resume without login)
      try {
        localStorage.setItem('genopoisk_last_watched_film', JSON.stringify({
          filmId: String(filmId),
          title: title,
          ts: new Date().toISOString(),
          position: 0,
          duration: 0
        }));
      } catch (_) {}
      const payload = JSON.stringify({
        type: 'movies_opened',
        initData: getTgInitData(),
        userId: getUserId(),
        username: tgUsername,
        filmId: filmId,
        title: title
      });
      try {
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
      } catch (e) {
        console.warn('track error:', e);
        // Fallback: sendBeacon (may not parse as JSON on server, but better than nothing)
        try {
          if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon('/api/track', blob);
          }
        } catch (_) {}
      }
      // Navigate to player immediately — no loading overlay
      window.location.href = `player.html?id=${filmId}&title=${encodeURIComponent(title)}`;
    }

    async function loadCategory(category) {
      currentCategory = category;
      currentPage = 1;
      hasMore = true;
      clearFilms();
      showLoader();
      searchInput.value = '';
      trackEvent('categories_opened', { category });
      try {
        if (category === 'random') {
          const film = await getRandomFilm();
          if (film) displayFilms([film], true);
          else showEmptyState('Не удалось загрузить случайный фильм');
        } else {
          // INSTANT: show cached films immediately (if available)
          // This makes the category feel instant — user sees films in <50ms
          // even on a slow projector. The actual API fetch happens in
          // loadMoreFilms() and updates the grid when it completes.
          try {
            var cachedRaw = localStorage.getItem('genopoisk_films_' + category + '_1');
            if (cachedRaw) {
              var cached = JSON.parse(cachedRaw);
              if (cached && cached.films && cached.films.length > 0) {
                // Cache valid for 7 days
                if (Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000) {
                  // Show cached films INSTANTLY
                  if (isMobileView()) {
                    var showNow = cached.films.slice(0, MOBILE_INITIAL);
                    filmBuffer = cached.films.slice(showNow.length);
                    appendFilms(showNow);
                  } else {
                    appendFilms(cached.films);
                  }
                  currentPage = 2; // already showed page 1
                  hideLoader();
                  console.log('[cache] Instant load from cache:', category, cached.films.length, 'films');
                  // Now fetch fresh data in background — update if different
                  loadMoreFilms();
                  return;
                }
              }
            }
          } catch (_) {}
          // No cache — load from API (will cache result for next time)
          await loadMoreFilms();
        }
      } catch (e) {
        showEmptyState('Ошибка загрузки: ' + e.message);
      }
    }

    // Load user's favorites from backend and display as a grid.
    // Each favorite has filmId + title; we fetch poster from kinopoisk by id.
    async function loadFavorites() {
      currentCategory = null;
      hasMore = false;
      clearFilms();
      showLoader();
      searchInput.value = '';
      const uid = getUserId();
      if (!uid || uid.startsWith('web_')) {
        showEmptyState('Войдите через Telegram, чтобы видеть коллекцию');
        return;
      }
      try {
        const res = await fetch('/api/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, initData: getTgInitData() })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const favs = data.favorites || [];
        if (favs.length === 0) {
          showEmptyState('В избранном пока пусто. Нажмите ☆ в плеере, чтобы добавить фильм.');
          return;
        }
        // Build film objects directly from favorites data — no need to
        // call kinopoisk API for each film (which may be blocked by 403).
        // Poster is loaded via /api/poster proxy (different endpoint, works).
        const films = favs.map(function(f) {
          return {
            filmId: f.filmId,
            nameRu: f.title,
            year: '—',
            rating: 'Н/Д'
          };
        });
        displayFilms(films);
      } catch (e) {
        showEmptyState('Ошибка загрузки избранного: ' + e.message);
      }
    }

    async function loadMoreFilms() {
      if (isLoading || !hasMore || !currentCategory) return;

      // Mobile pagination: drain the buffer first before fetching a new page.
      // On desktop, the buffer is always empty (we display the whole page at
      // once), so this branch is skipped and we proceed to fetch.
      if (filmBuffer.length > 0) {
        const chunk = filmBuffer.splice(0, MOBILE_CHUNK);
        appendFilms(chunk);
        // Schedule a check: if user is still near the bottom after the
        // buffer drain, load more (prevents "stuck" when only 8 films are
        // shown and screen is tall).
        setTimeout(function() {
          if (currentCategory && hasMore && !isLoading) {
            var scrollPos = window.innerHeight + window.scrollY;
            var threshold = document.documentElement.scrollHeight - 800;
            if (scrollPos >= threshold) loadMoreFilms();
          }
        }, 100);
        return;
      }

      isLoading = true;
      try {
        let films = [];
        switch (currentCategory) {
          case 'popular':
            films = await getPopular(currentPage);
            break;
          case 'top250':
            films = await getTop250(currentPage);
            break;
          case 'new':
            films = await getNew(currentPage);
            break;
        }
        if (films.length > 0) {
          // Cache films in localStorage for offline/fallback use.
          // Key: category_page, Value: films array.
          // TTL: 24 hours (films don't change often).
          try {
            var cacheKey = 'genopoisk_films_' + currentCategory + '_' + currentPage;
            localStorage.setItem(cacheKey, JSON.stringify({ films: films, ts: Date.now() }));
          } catch (_) {}

          currentPage++;
          if (isMobileView()) {
            // Mobile: show MOBILE_INITIAL on first load (empty grid),
            // otherwise MOBILE_CHUNK from this fresh page.
            const isFirstLoad = filmGrid.children.length === 0 ||
                                filmGrid.querySelector('.empty-state');
            const showNow = isFirstLoad
              ? films.slice(0, MOBILE_INITIAL)
              : films.slice(0, MOBILE_CHUNK);
            // Buffer the rest for subsequent scroll-loads.
            filmBuffer = films.slice(showNow.length);
            appendFilms(showNow);
            // If buffer is empty (page had fewer films than initial), allow
            // next scroll to fetch the next page.
          } else {
            // Desktop: show all 20, no buffering.
            appendFilms(films);
          }
        } else {
          hasMore = false;
          if (filmGrid.children.length === 0) showEmptyState('Фильмы не найдены');
        }
      } catch (e) {
        // Fallback: try to load cached films from localStorage
        var cachedFilms = null;
        try {
          var ck = 'genopoisk_films_' + currentCategory + '_' + currentPage;
          var raw = localStorage.getItem(ck);
          if (raw) {
            var parsed = JSON.parse(raw);
            // Cache valid for 7 days (films don't change much)
            if (parsed && parsed.films && (Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000)) {
              cachedFilms = parsed.films;
              console.log('[cache] Using cached films for', currentCategory, 'page', currentPage);
            }
          }
        } catch (_) {}

        if (cachedFilms && cachedFilms.length > 0) {
          currentPage++;
          if (isMobileView()) {
            const isFirstLoad = filmGrid.children.length === 0 ||
                                filmGrid.querySelector('.empty-state');
            const showNow = isFirstLoad
              ? cachedFilms.slice(0, MOBILE_INITIAL)
              : cachedFilms.slice(0, MOBILE_CHUNK);
            filmBuffer = cachedFilms.slice(showNow.length);
            appendFilms(showNow);
          } else {
            appendFilms(cachedFilms);
          }
        } else {
          showEmptyState('Ошибка загрузки: ' + e.message + '<br><br><small>Попробуйте обновить страницу или зайдите позже.</small>');
          hasMore = false;
        }
      } finally {
        isLoading = false;
      }
    }

    // --- Search behavior ---
    // When user types, search results REPLACE the category buttons (actions)
    // instead of appearing in a separate dropdown. When search is cleared,
    // categories reappear.
    // 250ms debounce — fast enough to feel live, slow enough to avoid
    // hammering the API on every keystroke.
    const actionsEl = document.querySelector('.actions');

    function hideCategories() {
      if (actionsEl) actionsEl.style.display = 'none';
    }
    function showCategories() {
      if (actionsEl) actionsEl.style.display = '';
    }

    let searchTimeout;
    // Clear button: clears the field AND dismisses the keyboard on mobile
    // (blur() is what actually triggers keyboard dismissal on iOS Safari
    // and Android Chrome). Also restores the previous category view.
    const searchClearBtn = document.getElementById('searchClear');
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', function() {
        searchInput.value = '';
        searchInput.blur(); // dismiss keyboard
        showCategories();
        if (currentCategory) {
          loadCategory(currentCategory);
        } else {
          content.classList.add('hidden');
          clearFilms();
        }
      });
    }
    // Enter key on mobile keyboard = "Готово"/Done → dismiss keyboard
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchInput.blur();
      }
    });
    searchInput.addEventListener('input', function(e) {
      clearTimeout(searchTimeout);
      const val = e.target.value.trim();
      if (!val || val.length < 2) {
        // Too short — show categories again, hide grid
        showCategories();
        if (!currentCategory) {
          content.classList.add('hidden');
          clearFilms();
        }
        return;
      }
      // Search results replace the category buttons
      hideCategories();
      // 250ms debounce — fast live search feel
      searchTimeout = setTimeout(async () => {
        currentCategory = null;
        currentPage = 1;
        hasMore = false;
        clearFilms();
        showLoader();
        trackEvent('searches', { query: val });
        try {
          const films = await searchFilms(val);
          displayFilms(films);
        } catch (e) {
          showEmptyState('Ошибка поиска: ' + e.message);
        }
      }, 250);
    });

    let scrollTimeout;
    let lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    window.addEventListener('scroll', function() {
      clearTimeout(scrollTimeout);
      // Hide/show fixed Telegram button based on scroll direction
      // Use pageYOffset for iOS Safari compatibility (scrollY can be 0
      // when body has overflow-x:hidden on iOS)
      var currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      var fixedBtn = document.getElementById('fixedTelegramBtn');
      if (fixedBtn && !fixedBtn.classList.contains('hidden-by-tv')) {
        if (currentScrollY > lastScrollY + 5 && currentScrollY > 50) {
          fixedBtn.classList.add('hidden');
        } else if (currentScrollY < lastScrollY - 5) {
          fixedBtn.classList.remove('hidden');
        }
      }
      lastScrollY = currentScrollY;

      scrollTimeout = setTimeout(function() {
        var scrollPosition = (window.pageYOffset || document.documentElement.scrollTop || 0) + window.innerHeight;
        var threshold = document.documentElement.scrollHeight - 800;
        if (scrollPosition >= threshold &&
            currentCategory &&
            currentCategory !== 'random' &&
            !isLoading &&
            hasMore) {
          loadMoreFilms();
        }
      }, 100);
    });

    // Note: avoid optional chaining (?.) here — old Chrome on Android
    // projectors (Chrome 50-70) doesn't support ES2020 syntax and the
    // entire script will fail with SyntaxError, breaking all buttons.
    if (window.Telegram && window.Telegram.WebApp) {
      var themeParams = window.Telegram.WebApp.themeParams;
      if (themeParams && themeParams.bg_color) {
        var metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.content = themeParams.bg_color;
      }
      // Apply Telegram theme to body
      if (themeParams && themeParams.text_color) document.documentElement.style.setProperty('--text-primary', themeParams.text_color);
      if (themeParams && themeParams.bg_color) document.documentElement.style.setProperty('--bg-primary', themeParams.bg_color);
    }

    // Main button for Mini App back navigation
    if (tg && tg.BackButton) {
      tg.BackButton.hide();
    }

    // Auto-focus the hero title ONLY on detected TV/projector devices.
    // Previously this fired on any non-touch device (including desktop PCs),
    // causing an unwanted focus ring around "Genopoisk" title on desktop.
    // Now we only auto-focus if the device matches TV/projector heuristics.
    if (!(tg && tg.initData)) {
      var uaLower = (navigator.userAgent || '').toLowerCase();
      var isDetectedTV = false;
      var tvKw = ['tv','television','smarttv','googletv','android tv','webos','tizen',
                  'hbbtv','roku','firetv','aftt','aftm','bento','projector','thundeal',
                  'thundea','xgimi','wanbo','jmgo','dangbei','nebula','epson','benq',
                  'optoma','magbox','minix','hk1','x88','t95','tx3','tx6','h96','a95x'];
      for (var ti = 0; ti < tvKw.length; ti++) {
        if (uaLower.indexOf(tvKw[ti]) !== -1) { isDetectedTV = true; break; }
      }
      // Also auto-focus if user previously saved device as projector
      if (!isDetectedTV) {
        try {
          if (localStorage.getItem('genopoisk_device_type') === 'projector') isDetectedTV = true;
        } catch (_) {}
      }
      // Also auto-focus on Android + large screen (likely projector)
      if (!isDetectedTV) {
        var isAndroidUA = uaLower.indexOf('android') !== -1;
        if (isAndroidUA && window.innerWidth >= 800) isDetectedTV = true;
      }
      if (isDetectedTV) {
        setTimeout(function() {
          var heroTitleEl = document.querySelector('.hero-title');
          if (heroTitleEl) heroTitleEl.focus();
        }, 600);
      }
    }

