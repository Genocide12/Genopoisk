// Bridge script — injected as the FIRST element in <head> of the iframe.
// Blocks ad config (prevents "fullscreen disabled during ad" message),
// blocks tracking endpoints, fixes player controls visibility.

(function() {
  if (window.__genopoiskBridge) return;
  window.__genopoiskBridge = true;

  function log() {
    try { console.log('[Genopoisk]', Array.from(arguments).join(' ')); } catch(_) {}
  }
  log('Bridge loaded');

  var videoEl = null;

  function post(msg) {
    try { parent.postMessage(msg, '*'); } catch(_) {}
  }

  // ====== 0a. Pre-emptively neutralize adsConfig ======
  // venoplayer reads window.adsConfig to decide if ads should play.
  // If adsConfig has pre/middle/post roll URLs, venoplayer enters "ad mode"
  // and disables fullscreen + shows "fullscreen disabled during ad".
  // We define adsConfig as a getter that always returns empty config,
  // so venoplayer never enters ad mode → fullscreen works immediately.
  var EMPTY_ADS_CONFIG = {
    nonLinear: { fallbackOnly: true, url: '', total: 0, offset: 0 },
    pre: { vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, maxImpressions: 0, urls: [] },
    middle: { offset: 999999, vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, nonLinearFallback: false, pop: false, total: 0, maxImpressions: 0, urls: [] },
    post: { vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, maxImpressions: 0, urls: [] }
  };
  try {
    Object.defineProperty(window, 'adsConfig', {
      get: function() { return EMPTY_ADS_CONFIG; },
      set: function(val) { log('adsConfig assignment blocked'); },
      configurable: true
    });
  } catch(e) { log('adsConfig override failed', e); }

  // ====== 0. Hide ad / fullscreen-disabled overlays only ======
  // Previously we hid venoplayer's bottom bar, progress bar, fullscreen button
  // AND set `video { pointer-events:none }`. That last rule blocked all
  // touch/click events from reaching venoplayer, so its controls never
  // appeared on tap. Now we let venoplayer manage its own UI and only hide
  // the ad-disabled overlay messages.
  function injectControlsFix() {
    if (document.querySelector('style[data-genopoisk-controls]')) return;
    var css =
      // Hide ad-related overlays and "fullscreen disabled during ad" messages
      '.vp-ad-overlay, .vp-ad-message, .ad-message, [class*="ad-disabled"], [class*="fullscreen-disabled"] { display:none !important; }';
    var style = document.createElement('style');
    style.setAttribute('data-genopoisk-controls', 'true');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    log('Controls fix CSS injected (ad overlays only — venoplayer controls untouched)');
  }
  if (document.head) { injectControlsFix(); }
  else {
    var cObs = new MutationObserver(function() {
      if (document.head) { injectControlsFix(); cObs.disconnect(); }
    });
    cObs.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Periodic check: remove ad messages and ensure center button visible
  setInterval(function() {
    // Remove ad overlay messages
    var adMsgs = document.querySelectorAll('.vp-ad-message, .ad-message, [class*="fullscreen-disabled"]');
    for (var i = 0; i < adMsgs.length; i++) {
      adMsgs[i].style.display = 'none';
      adMsgs[i].remove();
    }
  }, 1000);
  // venoplayer sets #player height:180px inline. We need:
  // 1. html, body { height:100% } so #player can be height:100%
  // 2. #player { height:100% !important } to override inline 180px
  // --vp-vh is computed FROM #player height, so this is safe.
  function injectLayoutCSS() {
    if (document.querySelector('style[data-genopoisk-layout]')) return;
    var css =
      'html { height:100% !important; }' +
      'body { height:100% !important; margin:0 !important; padding:0 !important; }' +
      '#player { height:100% !important; width:100% !important; }';
    var style = document.createElement('style');
    style.setAttribute('data-genopoisk-layout', 'true');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    log('Layout CSS injected (html/body/#player height:100%)');
  }
  if (document.head) {
    injectLayoutCSS();
  } else {
    var headObs = new MutationObserver(function() {
      if (document.head) { injectLayoutCSS(); headObs.disconnect(); }
    });
    headObs.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Re-inject after delays — venoplayer sets inline styles during init
  setTimeout(injectLayoutCSS, 500);
  setTimeout(injectLayoutCSS, 2000);
  setTimeout(injectLayoutCSS, 5000);

  // ====== 1. Block tracking endpoints (s.myangular.life) ======
  // We do NOT block ad domains — ad blocking broke video playback.
  // We do NOT block P2P tracker (t6.zcvh.net) — venoplayer needs it to
  //   discover P2P peers and segment URLs. Blocking it caused
  //   'No video bytes to push' because venoplayer couldn't get segment list.
  // We do NOT block P2P CDN nodes (x-bc, ghzbfjzbazc) — let venoplayer try
  //   them via P2P; if they fail, venoplayer falls back on its own.
  // Only block s.myangular.life (stats/telemetry that slows init).
  var trackingPattern = /s\.myangular\.life|stats\.myangular\.life|myangular\.life/i;

  function isBlocked(url) {
    if (typeof url !== 'string') return false;
    return trackingPattern.test(url);
  }

  function isP2pCdn(url) {
    return false; // don't block P2P CDN
  }

  // Override fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isBlocked(url)) {
        log('Blocked fetch (204):', url.slice(0, 100));
        return Promise.resolve(new Response('', { status: 204 }));
      }
      if (isP2pCdn(url)) {
        log('P2P CDN blocked (network error):', url.slice(0, 100));
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      // Rewrite segment URLs from broken CDNs to working CDN
      if (typeof url === 'string') {
        var newUrl = url.replace(
          /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
          'https://hye1eaipby4w.interkh.com'
        );
        if (newUrl !== url) {
          log('fetch URL rewrite:', url.slice(0, 60), '→', newUrl.slice(0, 60));
          if (typeof input === 'string') {
            input = newUrl;
          } else if (input && input.url) {
            input = new Request(newUrl, input);
          }
        }
      }
      // Intercept MPD manifest responses and rewrite BaseURL from broken
      // P2P CDNs (ghzbfjzbazc, x-bc) to the working CDN (hye1eaipby4w).
      return origFetch.apply(this, arguments).then(function(res) {
        var ct = res.headers.get('content-type') || '';
        if (ct.indexOf('dash+xml') !== -1 || ct.indexOf('xml') !== -1) {
          return res.text().then(function(text) {
            if (text.indexOf('<MPD') === -1) return res;
            var rewritten = text.replace(
              /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
              'https://hye1eaipby4w.interkh.com'
            );
            if (rewritten !== text) {
              log('Rewrote MPD BaseURL (fetch body): ghzbfjzbazc/x-bc → hye1eaipby4w');
            }
            return new Response(rewritten, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          });
        }
        return res;
      });
    };
  } catch(e) {}

  // Override XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._genopoiskBlocked = isBlocked(url);
      this._genopoiskP2p = isP2pCdn(url);
      // Rewrite segment URLs from broken CDNs to working CDN.
      // dash.js constructs segment URLs as BaseURL + SegmentTemplate.
      // We rewrite them here in open() so the actual request goes to the
      // working CDN.
      if (typeof url === 'string') {
        var newUrl = url.replace(
          /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
          'https://hye1eaipby4w.interkh.com'
        );
        if (newUrl !== url) {
          log('XHR URL rewrite:', url.slice(0, 60), '→', newUrl.slice(0, 60));
          url = newUrl;
          arguments[1] = newUrl;
        }
      }
      this._genopoiskUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      var self = this;
      if (this._genopoiskBlocked) {
        setTimeout(function() {
          try {
            Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(self, 'status', { value: 204, configurable: true });
            Object.defineProperty(self, 'responseText', { value: '', configurable: true });
            Object.defineProperty(self, 'response', { value: '', configurable: true });
            if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
            if (typeof self.onload === 'function') self.onload();
            self.dispatchEvent(new Event('load'));
            self.dispatchEvent(new Event('loadend'));
          } catch(e) {}
        }, 0);
        return;
      }
      if (this._genopoiskP2p) {
        setTimeout(function() {
          try {
            Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(self, 'status', { value: 0, configurable: true });
            if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
            if (typeof self.onerror === 'function') self.onerror();
            self.dispatchEvent(new Event('error'));
            self.dispatchEvent(new Event('loadend'));
          } catch(e) {}
        }, 0);
        return;
      }
      // Also intercept MPD manifest responses and rewrite BaseURL in body
      this.addEventListener('readystatechange', function() {
        if (self.readyState === 4 && self.status === 200) {
          var ct = self.getResponseHeader('content-type') || '';
          if ((ct.indexOf('dash+xml') !== -1 || ct.indexOf('xml') !== -1) &&
              self.responseText && self.responseText.indexOf('<MPD') !== -1) {
            var rewritten = self.responseText.replace(
              /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
              'https://hye1eaipby4w.interkh.com'
            );
            if (rewritten !== self.responseText) {
              log('Rewrote MPD BaseURL (XHR body): ghzbfjzbazc/x-bc → hye1eaipby4w');
              try {
                Object.defineProperty(self, 'responseText', { value: rewritten, configurable: true });
                Object.defineProperty(self, 'response', { value: rewritten, configurable: true });
              } catch(e) {}
            }
          }
        }
      });
      return origSend.apply(this, arguments);
    };
  } catch(e) {}

  // Override WebSocket to block tracking connections only (s.myangular.life).
  // Do NOT block t6.zcvh.net (P2P tracker) — venoplayer needs it.
  //
  // For blocked URLs, we return a STUB OBJECT that mimics the WebSocket
  // interface (readyState, send, close, addEventListener, etc.) but does
  // nothing. This is silent — no network attempt, no ERR_UNSAFE_PORT error
  // in console (the previous approach redirected to ws://localhost:0 which
  // Chrome logs as an unsafe-port error, polluting the debug console).
  try {
    var OrigWebSocket = window.WebSocket;
    function BlockedWebSocketStub(url) {
      log('Blocked WebSocket (silent stub):', String(url).slice(0, 100));
      // Mimic WebSocket constants
      this.readyState = OrigWebSocket.CLOSED; // never opens
      this.url = url;
      this.extensions = '';
      this.protocol = '';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
      // Stub methods — all no-ops
      this.send = function() {};
      this.close = function() {};
      this.addEventListener = function() {};
      this.removeEventListener = function() {};
      this.dispatchEvent = function() { return true; };
    }
    var WrappedWebSocket = function(url, protocols) {
      if (typeof url === 'string' && trackingPattern.test(url)) {
        return new BlockedWebSocketStub(url);
      }
      if (protocols !== undefined) {
        return new OrigWebSocket(url, protocols);
      }
      return new OrigWebSocket(url);
    };
    WrappedWebSocket.prototype = OrigWebSocket.prototype;
    WrappedWebSocket.CONNECTING = OrigWebSocket.CONNECTING;
    WrappedWebSocket.OPEN = OrigWebSocket.OPEN;
    WrappedWebSocket.CLOSING = OrigWebSocket.CLOSING;
    WrappedWebSocket.CLOSED = OrigWebSocket.CLOSED;
    window.WebSocket = WrappedWebSocket;
  } catch(e) { log('WebSocket override failed', e); }

  // ====== 2. MutationObserver: remove tracking pixels ======
  var adObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') {
          var imgSrc = node.src || '';
          if (isBlocked(imgSrc)) {
            log('Removed tracking pixel:', imgSrc.slice(0, 80));
            node.remove();
          }
        }
      }
    }
  });
  adObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ====== 3. Setup video element when it appears ======
  function setupVideo(video) {
    if (videoEl === video) return;
    videoEl = video;
    log('Video element attached');

    try { video.setAttribute('playsinline', ''); } catch(_) {}
    try { video.setAttribute('webkit-playsinline', ''); } catch(_) {}
    try { video.disablePictureInPicture = false; } catch(_) {}

    post({ type: 'ready', currentTime: video.currentTime || 0, duration: video.duration || 0 });

    video.addEventListener('timeupdate', function() {
      post({ type: 'timeupdate', currentTime: video.currentTime, duration: video.duration });
    });
    video.addEventListener('durationchange', function() {
      post({ type: 'duration', duration: video.duration });
    });
    video.addEventListener('play', function() {
      post({ type: 'play', currentTime: video.currentTime });
    });
    video.addEventListener('pause', function() {
      post({ type: 'pause', currentTime: video.currentTime });
    });
    video.addEventListener('ended', function() {
      post({ type: 'ended' });
    });
    video.addEventListener('loadedmetadata', function() {
      post({ type: 'loaded', currentTime: video.currentTime, duration: video.duration });
    });
    video.addEventListener('enterpictureinpicture', function() {
      post({ type: 'pip_enter' });
    });
    video.addEventListener('leavepictureinpicture', function() {
      post({ type: 'pip_leave' });
    });

    window.addEventListener('message', function(e) {
      if (!e.data) return;
      var d = e.data;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch(_) { return; }
      }
      if (!d || typeof d !== 'object') return;
      if (d.type === 'seek' && typeof d.time === 'number') {
        var targetTime = d.time;
        log('Seek requested to', targetTime, 'readyState:', video.readyState);

        // venoplayer resets currentTime to 0 after play(). We need to seek
        // MULTIPLE times to win the race: seek, wait, check if reset, re-seek.
        // BUT: only post 'seeked' event ONCE (after the last attempt) to
        // avoid flooding the parent with seeked events that cause infinite
        // loops in the retry logic.
        var seekedSent = false;
        function performSeek(isLast) {
          try {
            video.currentTime = targetTime;
            log('Seek set to', targetTime, '→ actual:', video.currentTime);
            // Only send 'seeked' event on the LAST attempt to avoid
            // flooding parent with events that trigger retry loops
            if (isLast && !seekedSent) {
              seekedSent = true;
              post({ type: 'seeked', currentTime: video.currentTime });
            }
          } catch(err) {
            log('Seek failed', err);
            if (isLast && !seekedSent) {
              seekedSent = true;
              post({ type: 'seeked', currentTime: video.currentTime });
            }
          }
        }

        // Aggressive seek: repeat 3 times with 300ms interval (was 5 —
        // reduced to avoid excessive events). Only the last attempt sends
        // the 'seeked' event.
        var seekCount = 0;
        var MAX_SEEKS = 3;
        var aggressiveSeek = function() {
          seekCount++;
          var isLast = (seekCount >= MAX_SEEKS);
          performSeek(isLast);
          if (!isLast) {
            setTimeout(aggressiveSeek, 300);
          }
        };

        if (video.readyState < 2) {
          log('Video not ready, waiting for canplay...');
          var seekOnCanPlay = function() {
            video.removeEventListener('canplay', seekOnCanPlay);
            video.removeEventListener('loadeddata', seekOnCanPlay);
            setTimeout(aggressiveSeek, 200);
          };
          video.addEventListener('canplay', seekOnCanPlay);
          video.addEventListener('loadeddata', seekOnCanPlay);
          // Safety timeout — if canplay never fires, force aggressive seek
          setTimeout(function() {
            video.removeEventListener('canplay', seekOnCanPlay);
            video.removeEventListener('loadeddata', seekOnCanPlay);
            if (!seekedSent) aggressiveSeek();
          }, 3000);
        } else {
          try {
            var playPromise = video.play();
            if (playPromise && playPromise.then) {
              playPromise.then(function() {
                log('Video playing, aggressive seeking...');
                setTimeout(aggressiveSeek, 100);
              }).catch(function() {
                aggressiveSeek();
              });
            } else {
              aggressiveSeek();
            }
          } catch(_) {
            aggressiveSeek();
          }
        }
      } else if (d.type === 'showControls') {
        // Force venoplayer controls visible (after fullscreen exit)
        log('showControls requested');
        try {
          // Try to find and show venoplayer control bar
          var controls = document.querySelector('.vp-controls, .vjs-control-bar, .player-controls');
          if (controls) {
            controls.style.opacity = '1';
            controls.style.visibility = 'visible';
            controls.style.display = 'flex';
            log('Controls shown:', controls.className);
          }
          // Also try calling venoplayer API if available
          if (window.app && window.app.player) {
            try { window.app.player.controls(true); } catch(_) {}
          }
          // Click on player to trigger controls show
          var playerDiv = document.querySelector('#player');
          if (playerDiv) {
            var ev = new MouseEvent('mousemove', { bubbles: true });
            playerDiv.dispatchEvent(ev);
          }
        } catch(e) { log('showControls failed', e); }
      } else if (d.type === 'getTime') {
        post({ type: 'currentTime', currentTime: video.currentTime, duration: video.duration });
      } else if (d.type === 'play') {
        try { video.play(); } catch(_) {}
      } else if (d.type === 'pause') {
        try { video.pause(); } catch(_) {}
      } else if (d.type === 'requestPiP') {
        try {
          if (video.requestPictureInPicture && document.pictureInPictureEnabled) {
            video.requestPictureInPicture().then(function() {
              post({ type: 'pip_enter' });
            }).catch(function(err) {
              log('PiP failed:', err);
              post({ type: 'pip_error', message: err.message });
            });
          } else {
            post({ type: 'pip_error', message: 'PiP not supported on this device' });
          }
        } catch(e) {
          post({ type: 'pip_error', message: e.message });
        }
      }
    });
  }

  // Poll for video element
  var videoCheckCount = 0;
  var videoCheckInterval = setInterval(function() {
    videoCheckCount++;
    var v = document.querySelector('video');
    if (v) {
      setupVideo(v);
      clearInterval(videoCheckInterval);
    } else if (videoCheckCount > 300) {
      clearInterval(videoCheckInterval);
      log('Video element not found after 60s');
    }
  }, 200);

  var videoObserver = new MutationObserver(function() {
    var v = document.querySelector('video');
    if (v) setupVideo(v);
  });
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  post({ type: 'bridge_ready' });
  log('bridge_ready posted');
})();
