// Bridge script — gets injected into the iframe alongside the embess.ws player HTML.
// This file is fetched from /api/bridge.js and injected as a <script> tag inside the iframe.
// Inside the iframe, it has access to the <video> element (same-origin via srcdoc)
// and posts messages to the parent window for resume + ad blocking.

(function() {
  if (window.__genopoiskBridge) return;
  window.__genopoiskBridge = true;

  function log() {
    try { console.log('[Genopoisk]', Array.from(arguments).join(' ')); } catch(_) {}
  }
  log('Bridge loaded');

  var videoEl = null;
  var adBlockStarted = false;

  function post(msg) {
    try { parent.postMessage(msg, '*'); } catch(_) {}
  }

  function setupVideo(video) {
    if (videoEl === video) return;
    videoEl = video;
    log('Video element attached');

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
      }
    });

    if (!adBlockStarted) {
      adBlockStarted = true;
      startAdBlocking();
    }
  }

  function startAdBlocking() {
    log('Ad blocking started');

    // Ad-blocking CSS — hide known ad containers and overlays.
    // venoplayer (player-venom npm package) uses .vjs-* classes (videojs-like).
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
      // venom player ad elements
      '.vjs-ad-loading,.vjs-ad-playing,.vjs-ad-info,.vjs-ad-progress,' +
      '.vp-ad,.vp-ad-overlay,.vp-ads,' +
      '[class*="vjs-ads-show"],[class*="vjs-loading-spinner"]' +
      '{display:none!important;visibility:hidden!important;opacity:0!important;' +
      'pointer-events:none!important;width:0!important;height:0!important;' +
      'position:absolute!important;left:-9999px!important}' +
      'video,video[class]{display:block!important;visibility:visible!important}';

    var style = document.createElement('style');
    style.setAttribute('data-genopoisk', 'adblock');
    style.textContent = adCSS;
    (document.head || document.documentElement).appendChild(style);

    // Auto-click "Skip ad" buttons every 300ms
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
    setInterval(function() {
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

    // Block ad URLs in video.src setter — including VAST/VPAID ad providers
    var adUrlPattern = /doubleclick|googlesyndication|google_ads|googleads|adserver|vast|vpaid|taboola|outbrain|distribrey|load-xml|admixer|adservice/i;

    try {
      var proto = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
      if (proto && proto.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          get: function() { return proto.get.call(this); },
          set: function(val) {
            if (typeof val === 'string' && adUrlPattern.test(val)) {
              log('Blocked ad URL in src:', val);
              return;
            }
            proto.set.call(this, val);
          },
          configurable: true
        });
      }
    } catch(e) { log('src override failed', e); }

    // Block fetch to ad domains
    try {
      var origFetch = window.fetch;
      window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (adUrlPattern.test(url)) {
          log('Blocked fetch to ad domain:', url);
          return Promise.resolve(new Response('', { status: 204 }));
        }
        return origFetch.apply(this, arguments);
      };
    } catch(e) {}

    // Block XHR to ad domains
    try {
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && adUrlPattern.test(url)) {
          log('Blocked XHR to ad domain:', url);
          throw new Error('blocked');
        }
        return origOpen.apply(this, arguments);
      };
    } catch(e) {}

    // MutationObserver: remove ad iframes/elements as they appear
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IFRAME') {
            var src = node.src || '';
            if (adUrlPattern.test(src) || /distribrey|load-xml/i.test(src)) {
              log('Removed ad iframe:', src);
              node.remove();
            }
          }
          if (node.tagName === 'DIV' || node.tagName === 'INS') {
            var cls = (node.className || '') + ' ' + (node.id || '');
            if (/(?:^|[-_])ad(?:[-_]|$)|adsbygoogle|ad-container|ad-slot|distribrey/i.test(cls)) {
              node.style.display = 'none';
              node.style.visibility = 'hidden';
            }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    log('Ad blocking fully initialized');
  }

  // Poll for video element every 200ms (up to 60s).
  // player-venom creates the <video> element dynamically after JS init,
  // so we may need to wait a few seconds before it appears.
  var videoCheckCount = 0;
  var videoCheckInterval = setInterval(function() {
    videoCheckCount++;
    var v = document.querySelector('video');
    if (v) {
      setupVideo(v);
      clearInterval(videoCheckInterval);
    } else if (videoCheckCount > 300) {
      // Give up after 60s
      clearInterval(videoCheckInterval);
      log('Video element not found after 60s — giving up');
    }
  }, 200);

  // Also observe DOM mutations to catch the video element as soon as it's added
  var videoObserver = new MutationObserver(function() {
    var v = document.querySelector('video');
    if (v) setupVideo(v);
  });
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Notify parent that the bridge is alive (even before video element exists)
  post({ type: 'bridge_ready' });
  log('bridge_ready posted to parent');
})();
