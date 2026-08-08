// Bridge script — injected as the FIRST element in <head> of the iframe,
// BEFORE embess.ws's own ad/player scripts run. This is critical: we need to
// intercept window.adsConfig and fetch/XHR before player-venom captures them.

(function() {
  if (window.__genopoiskBridge) return;
  window.__genopoiskBridge = true;

  function log() {
    try { console.log('[Genopoisk]', Array.from(arguments).join(' ')); } catch(_) {}
  }
  log('Bridge loaded (pre-emptive)');

  var videoEl = null;
  var adBlockStarted = false;

  function post(msg) {
    try { parent.postMessage(msg, '*'); } catch(_) {}
  }

  // ====== 1. Pre-emptively neutralize adsConfig ======
  // embess.ws sets window.adsConfig in a <script> that runs after us.
  // We define adsConfig as a getter/setter so the assignment is ignored.
  var EMPTY_ADS_CONFIG = {
    nonLinear: { fallbackOnly: true },
    pre: { vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, maxImpressions: 0, urls: [] },
    middle: { offset: 999999, vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, nonLinearFallback: false, pop: false, total: 0, maxImpressions: 0, urls: [] },
    post: { vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, maxImpressions: 0, urls: [] }
  };

  try {
    Object.defineProperty(window, 'adsConfig', {
      get: function() {
        log('adsConfig accessed → returning empty');
        return EMPTY_ADS_CONFIG;
      },
      set: function(val) {
        log('adsConfig assignment blocked (was:', JSON.stringify(val && val.pre && val.pre.urls), ')');
        // ignore
      },
      configurable: true
    });
  } catch(e) { log('adsConfig override failed', e); }

  // ====== 2. Block ad URLs AND tracking endpoints AND P2P at network level ======
  // adUrlPattern blocks VAST/VPAID ad providers (distribrey.com etc.)
  // trackingPattern blocks embess.ws's stats/telemetry endpoints that slow
  // down player init by waiting on WebSocket connections to s.myangular.life.
  // p2pPattern blocks venoplayer's P2P tracker (t6.zcvh.net) and the broken
  // P2P CDN subdomains (x-bc.interkh.com, ghzbfjzbazc.interkh.com) that
  // timeout after 30s. Without P2P, venoplayer falls back to direct HTTP
  // from hye1eaipby4w.interkh.com (the working CDN).
  var adUrlPattern = /doubleclick|googlesyndication|google_ads|googleads|adserver|vast|vpaid|taboola|outbrain|distribrey|load-xml|admixer|adservice|popads|propellerads|popcash|adsterra/i;
  var trackingPattern = /s\.myangular\.life|stats\.myangular\.life|myangular\.life/i;
  var p2pPattern = /t6\.zcvh\.net|x-bc\.interkh\.com|ghzbfjzbazc\.interkh\.com/i;

  function isBlocked(url) {
    if (typeof url !== 'string') return false;
    return adUrlPattern.test(url) || trackingPattern.test(url) || p2pPattern.test(url);
  }

  // Override fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isBlocked(url)) {
        log('Blocked fetch:', url.slice(0, 100));
        return Promise.resolve(new Response('', { status: 204 }));
      }
      return origFetch.apply(this, arguments);
    };
  } catch(e) {}

  // Override XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (isBlocked(url)) {
        log('Blocked XHR:', url.slice(0, 100));
        url = 'about:blank';
      }
      return origOpen.apply(this, arguments);
    };
  } catch(e) {}

  // Override HTMLMediaElement.src setter
  try {
    var proto = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (proto && proto.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        get: function() { return proto.get.call(this); },
        set: function(val) {
          if (isBlocked(val)) {
            log('Blocked video.src:', val.slice(0, 100));
            return;
          }
          proto.set.call(this, val);
        },
        configurable: true
      });
    }
  } catch(e) { log('src override failed', e); }

  // Override WebSocket to block stats.myangular.life connections.
  // We can't return a fake object — venoplayer checks `instanceof WebSocket`
  // and throws "No valid WebSocket class provided" if it's not a real WebSocket.
  // Instead, we let the real WebSocket constructor run, but rewrite blocked
  // URLs to a non-existent local path → connection fails fast, venoplayer
  // catches the error and continues without stats.
  try {
    var OrigWebSocket = window.WebSocket;
    var WrappedWebSocket = function(url, protocols) {
      if (typeof url === 'string' && trackingPattern.test(url)) {
        log('Blocked WebSocket (rewriting URL):', url.slice(0, 100));
        // Rewrite to invalid URL → instant connection error, no real network attempt
        url = 'ws://localhost:0/blocked';
      }
      if (protocols !== undefined) {
        return new OrigWebSocket(url, protocols);
      }
      return new OrigWebSocket(url);
    };
    // Preserve prototype + static props so instanceof checks pass
    WrappedWebSocket.prototype = OrigWebSocket.prototype;
    WrappedWebSocket.CONNECTING = OrigWebSocket.CONNECTING;
    WrappedWebSocket.OPEN = OrigWebSocket.OPEN;
    WrappedWebSocket.CLOSING = OrigWebSocket.CLOSING;
    WrappedWebSocket.CLOSED = OrigWebSocket.CLOSED;
    window.WebSocket = WrappedWebSocket;
  } catch(e) { log('WebSocket override failed', e); }

  // ====== 3. CSS to hide ad elements ======
  function injectAdCSS() {
    if (document.querySelector('style[data-genopoisk]')) return;
    var adCSS = '' +
      '[class*="ad-container"],[class*="ad-overlay"],[class*="ads-"],' +
      '[class*="vast-"],[class*="vpaid"],[id*="ad-"],[id*="ads-"],' +
      '.vjs-ad,.vjs-ads,.vjs-ad-*,.ad-banner,.pre-roll,.post-roll,.mid-roll,' +
      '[class*="promo-"],[class*="Promo"],' +
      'iframe[src*="doubleclick"],iframe[src*="adserver"],' +
      'iframe[src*="google_ads"],iframe[src*="googleads"],' +
      'iframe[src*="ad."],iframe[src*="/ad/"],iframe[src*="/ads/"],' +
      'iframe[src*="taboola"],iframe[src*="outbrain"],' +
      'iframe[src*="distribrey"],iframe[src*="load-xml"],' +
      '.ytp-ad,.ytp-ad-overlay,[class*="ytp-ad"],' +
      '[class*="AdSlot"],[class*="adSlot"],[class*="ad_"],' +
      '#ad,#ads,#ad-container,#adBanner,' +
      '.adsbygoogle,ins.adsbygoogle,' +
      '[class*="vjs-marker"],[class*="ad-marker"],' +
      '[data-ad],[data-ad-slot],[data-ad-client],' +
      '.vjs-ad-loading,.vjs-ad-playing,.vjs-ad-info,.vjs-ad-progress,' +
      '.vp-ad,.vp-ad-overlay,.vp-ads,' +
      '[class*="vjs-ads-show"]' +
      '{display:none!important;visibility:hidden!important;opacity:0!important;' +
      'pointer-events:none!important;width:0!important;height:0!important;' +
      'position:absolute!important;left:-9999px!important}' +
      'video,video[class]{display:block!important;visibility:visible!important}';
    var style = document.createElement('style');
    style.setAttribute('data-genopoisk', 'adblock');
    style.textContent = adCSS;
    (document.head || document.documentElement).appendChild(style);
    log('Ad CSS injected');
  }

  // Try to inject CSS ASAP (head may not exist yet)
  if (document.head) {
    injectAdCSS();
  } else {
    // Wait for head
    var headObserver = new MutationObserver(function() {
      if (document.head) {
        injectAdCSS();
        headObserver.disconnect();
      }
    });
    headObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ====== 4. Auto-click "Skip ad" buttons ======
  setInterval(function() {
    var skipSelectors = [
      '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
      '[class*="skip-ad"]', '[class*="SkipAd"]',
      '[class*="ad-skip"]', '[class*="adSkip"]',
      'button[class*="Skip"]', 'a[class*="Skip"]',
      '[class*="skip_button"]', '.skip-btn',
      '[aria-label*="Skip"]', '[aria-label*="skip"]',
      '[class*="vjs-skip"]', '.vjs-ad-skip-button',
      '[class*="vp-skip"]'
    ];
    for (var i = 0; i < skipSelectors.length; i++) {
      var btns = document.querySelectorAll(skipSelectors[i]);
      for (var j = 0; j < btns.length; j++) {
        var b = btns[j];
        if (b.offsetParent !== null || b.getClientRects().length > 0) {
          log('Clicking skip button');
          try { b.click(); } catch(_) {}
        }
      }
    }
  }, 300);

  // ====== 5. MutationObserver: remove ad iframes/elements AND tracking pixels ======
  var adObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IFRAME') {
          var src = node.src || '';
          if (isBlocked(src) || /distribrey|load-xml/i.test(src)) {
            log('Removed ad iframe:', src.slice(0, 80));
            node.remove();
          }
        }
        // Remove tracking pixels (1x1 images from s.myangular.life)
        if (node.tagName === 'IMG') {
          var imgSrc = node.src || '';
          if (isBlocked(imgSrc)) {
            log('Removed tracking pixel:', imgSrc.slice(0, 80));
            node.remove();
          }
        }
        if (node.tagName === 'DIV' || node.tagName === 'INS' || node.tagName === 'IMG') {
          var cls = (node.className || '') + ' ' + (node.id || '');
          if (/(?:^|[-_])ad(?:[-_]|$)|adsbygoogle|ad-container|ad-slot|distribrey/i.test(cls)) {
            node.style.display = 'none';
            node.style.visibility = 'hidden';
          }
        }
      }
    }
  });
  adObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ====== 5b. Block WebRTC (P2P peer connections) ======
  // venoplayer uses WebRTC for P2P video segment sharing between users.
  // P2P peers (x-bc.interkh.com, ghzbfjzbazc.interkh.com) timeout because
  // they're unreachable from most client IPs. Blocking RTCPeerConnection
  // forces venoplayer to fetch segments via HTTP from hye1eaipby4w.interkh.com.
  try {
    window.RTCPeerConnection = undefined;
    window.webkitRTCPeerConnection = undefined;
    window.mozRTCPeerConnection = undefined;
    log('WebRTC blocked (RTCPeerConnection undefined)');
  } catch(e) {}

  // ====== 6. Setup video element when it appears ======
  function setupVideo(video) {
    if (videoEl === video) return;
    videoEl = video;
    log('Video element attached');

    // Enable PiP and inline playback (needed for iOS)
    try { video.setAttribute('playsinline', ''); } catch(_) {}
    try { video.setAttribute('webkit-playsinline', ''); } catch(_) {}
    try { video.setAttribute('x-webkit-airplay', 'allow'); } catch(_) {}
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
    // Fullscreen change events — when video enters/exits fullscreen natively
    video.addEventListener('webkitbeginfullscreen', function() {
      post({ type: 'requestFullscreen' });
    });
    video.addEventListener('webkitendfullscreen', function() {
      post({ type: 'exitFullscreen' });
    });

    window.addEventListener('message', function(e) {
      if (!e.data) return;
      var d = e.data;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch(_) { return; }
      }
      if (!d || typeof d !== 'object') return;
      if (d.type === 'seek' && typeof d.time === 'number') {
        try {
          video.currentTime = d.time;
          log('Seeked to', d.time);
          post({ type: 'seeked', currentTime: video.currentTime });
        } catch(err) { log('Seek failed', err); }
      } else if (d.type === 'getTime') {
        post({ type: 'currentTime', currentTime: video.currentTime, duration: video.duration });
      } else if (d.type === 'play') {
        try { video.play(); } catch(_) {}
      } else if (d.type === 'pause') {
        try { video.pause(); } catch(_) {}
      } else if (d.type === 'requestPiP') {
        // Try to enter Picture-in-Picture (Android Chrome only)
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

    if (!adBlockStarted) {
      adBlockStarted = true;
    }
  }

  // ====== 7. Fullscreen handling ======
  // IMPORTANT: We do NOT intercept or override venoplayer's native fullscreen button.
  // venoplayer manages fullscreen entirely on its own using the Fullscreen API on
  // its container element. Our previous attempt to intercept clicks and forward
  // them to the parent caused the "open then immediately close" flicker bug.
  //
  // The iframe has allowfullscreen + allow="fullscreen", so venoplayer can
  // request fullscreen on itself and the browser will expand the iframe to fill
  // the screen. This is the cleanest approach.
  //
  // The "bad :fullscreen styles!" warning from venoplayer was caused by our
  // CSS rules `:fullscreen .player-header { display:none }` etc. — we removed
  // those from player.html so venoplayer is happy.

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
