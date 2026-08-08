// This endpoint is now a fallback when browser fetch is blocked.
// The primary approach is browser-side: fetch embess.ws HTML directly (CORS is enabled),
// inject bridge script, and set as iframe.srcdoc. See player.html for the implementation.
//
// This server-side proxy is kept as a fallback but may return 410 if embess.ws blocks
// Vercel's datacenter IPs. In that case, the client will retry with browser fetch.

const EMBESS_BASE = 'https://api.embess.ws';

module.exports = async (req, res) => {
  const id = req.query?.id;
  if (!id || !/^\d+$/.test(String(id))) {
    return res.status(400).send('Invalid id');
  }

  try {
    const upstream = await fetch(`${EMBESS_BASE}/embed/kp/${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Referer': EMBESS_BASE + '/',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`Upstream ${upstream.status}`);
    }

    let html = await upstream.text();
    html = injectBridge(html);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.status(200).send(html);
  } catch (e) {
    console.error('Embed proxy error:', e.message);
    res.status(500).send('Proxy error');
  }
};

// Shared bridge injection — also used by the client-side fetch fallback.
// Exported via global for re-use, but in Vercel this is just a local helper.
function injectBridge(html) {
  const baseTag = '<base href="https://api.embess.ws/">';
  if (/<head>/i.test(html)) {
    html = html.replace(/<head>/i, '<head>' + baseTag);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/(<html[^>]*>)/i, '$1<head>' + baseTag + '</head>');
  } else {
    html = baseTag + html;
  }

  const bridge = `
<script>
(function() {
  if (window.__genopoiskBridge) return;
  window.__genopoiskBridge = true;

  function log() {
    try { console.log('[Genopoisk]', Array.from(arguments).join(' ')); } catch(_) {}
  }
  log('Bridge loaded');

  let videoEl = null;
  let adBlockStarted = false;

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

    var adCSS = \`
      [class*="ad-container"], [class*="ad-overlay"], [class*="ads-"],
      [class*="vast-"], [class*="vpaid"], [id*="ad-"], [id*="ads-"],
      .vjs-ad, .vjs-ads, .vjs-ad-*, .ad-banner, .pre-roll, .post-roll, .mid-roll,
      [class*="promo-"], [class*="Promo"],
      iframe[src*="doubleclick"], iframe[src*="adserver"],
      iframe[src*="google_ads"], iframe[src*="googleads"],
      iframe[src*="ad."], iframe[src*="/ad/"], iframe[src*="/ads/"],
      iframe[src*="taboola"], iframe[src*="outbrain"],
      .ytp-ad, .ytp-ad-overlay, [class*="ytp-ad"],
      [class*="AdSlot"], [class*="adSlot"], [class*="ad_"],
      #ad, #ads, #ad-container, #adBanner,
      .adsbygoogle, ins.adsbygoogle,
      [class*="vjs-marker"], [class*="ad-marker"],
      [data-ad], [data-ad-slot], [data-ad-client] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        position: absolute !important;
        left: -9999px !important;
      }
      video, video[class] { display: block !important; visibility: visible !important; }
    \`;
    var style = document.createElement('style');
    style.setAttribute('data-genopoisk', 'adblock');
    style.textContent = adCSS;
    (document.head || document.documentElement).appendChild(style);

    setInterval(function() {
      var selectors = [
        '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
        '[class*="skip-ad"]', '[class*="SkipAd"]',
        '[class*="ad-skip"]', '[class*="adSkip"]',
        'button[class*="Skip"]', 'a[class*="Skip"]',
        '[class*="skip_button"]', '.skip-btn',
        '[aria-label*="Skip"]', '[aria-label*="skip"]',
        '[class*="vjs-skip"]'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var btns = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < btns.length; j++) {
          var b = btns[j];
          if (b.offsetParent !== null || b.getClientRects().length > 0) {
            log('Clicking skip button');
            try { b.click(); } catch(_) {}
          }
        }
      }
    }, 300);

    try {
      var proto = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
      if (proto && proto.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          get: function() { return proto.get.call(this); },
          set: function(val) {
            if (typeof val === 'string' &&
                /doubleclick|googlesyndication|google_ads|googleads|adserver|vast|vpaid|taboola|outbrain/i.test(val)) {
              log('Blocked ad URL in src:', val);
              return;
            }
            proto.set.call(this, val);
          },
          configurable: true
        });
      }
    } catch(e) { log('src override failed', e); }

    try {
      var origFetch = window.fetch;
      window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/doubleclick|googlesyndication|google_ads|googleads|adserver|vast|vpaid|taboola|outbrain/i.test(url)) {
          log('Blocked fetch to ad domain:', url);
          return Promise.resolve(new Response('', { status: 204 }));
        }
        return origFetch.apply(this, arguments);
      };
    } catch(e) {}

    try {
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' &&
            /doubleclick|googlesyndication|google_ads|googleads|adserver|vast|vpaid|taboola|outbrain/i.test(url)) {
          log('Blocked XHR to ad domain:', url);
          throw new Error('blocked');
        }
        return origOpen.apply(this, arguments);
      };
    } catch(e) {}

    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IFRAME') {
            var src = node.src || '';
            if (/doubleclick|googlesyndication|google_ads|googleads|adserver|taboola|outbrain/i.test(src)) {
              log('Removed ad iframe:', src);
              node.remove();
            }
          }
          if (node.tagName === 'DIV' || node.tagName === 'INS') {
            var cls = (node.className || '') + ' ' + (node.id || '');
            if (/(?:^|[-_])ad(?:[-_]|$)|adsbygoogle|ad-container|ad-slot/i.test(cls)) {
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

  var videoCheckInterval = setInterval(function() {
    var v = document.querySelector('video');
    if (v) setupVideo(v);
  }, 250);

  var videoObserver = new MutationObserver(function() {
    var v = document.querySelector('video');
    if (v) setupVideo(v);
  });
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  post({ type: 'bridge_ready' });
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, bridge + '</body>');
  } else {
    html = html + bridge;
  }
  return html;
}
