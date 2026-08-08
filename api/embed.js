// Server-side proxy for the movie player iframe.
// Fetches the embed page from api.embess.ws, injects a bridge script that:
//   1. Captures real video.currentTime and posts it to the parent window
//   2. Listens for seek commands from the parent (for resume playback)
//   3. Blocks pre-roll/mid-roll ads via CSS injection + auto-click skip buttons
//     + URL filtering on video.src + ad-iframe removal via MutationObserver
//
// Route: /api/embed?id=<kinopoisk_id>

const EMBESS_BASE = 'https://api.embess.ws';

module.exports = async (req, res) => {
  const id = req.query?.id;
  if (!id || !/^\d+$/.test(String(id))) {
    return res.status(400).send('Invalid id');
  }

  try {
    const upstream = await fetch(`${EMBESS_BASE}/embed/kp/${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': EMBESS_BASE + '/',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`Upstream ${upstream.status}`);
    }

    let html = await upstream.text();

    // Inject <base> so relative URLs (CSS, JS, images) still resolve to embess.ws
    const baseTag = '<base href="https://api.embess.ws/">';
    if (html.includes('<head>')) {
      html = html.replace(/<head>/i, '<head>' + baseTag);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/(<html[^>]*>)/i, '$1<head>' + baseTag + '</head>');
    } else {
      html = baseTag + html;
    }

    // Bridge script — runs inside the iframe (same-origin to our proxy)
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
    log('Video element attached', video);

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

    // Listen for commands from parent
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

    // 1) CSS to hide ad containers
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
      /* Don't hide the video itself even if it has "ad" in class */
      video, video[class] { display: block !important; visibility: visible !important; }
    \`;
    var style = document.createElement('style');
    style.setAttribute('data-genopoisk', 'adblock');
    style.textContent = adCSS;
    (document.head || document.documentElement).appendChild(style);

    // 2) Auto-click "Skip ad" buttons every 300ms
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
            log('Clicking skip button', b);
            try { b.click(); } catch(_) {}
          }
        }
      }
    }, 300);

    // 3) Block ad URLs in video.src setter
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

    // 4) Block fetch/XHR to ad domains
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

    // 5) MutationObserver: remove ad iframes/elements as they appear
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          // If it's an ad iframe, remove it
          if (node.tagName === 'IFRAME') {
            var src = node.src || '';
            if (/doubleclick|googlesyndication|google_ads|googleads|adserver|taboola|outbrain/i.test(src)) {
              log('Removed ad iframe:', src);
              node.remove();
            }
          }
          // If it's a div that looks like an ad, hide it
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

    // 6) Try to skip pre-roll: when video starts, jump currentTime forward if duration is short (likely ad)
    // Many pre-roll ads are 10-30s. If duration < 60s after metadata loads, skip.
    // (Risk: short films < 60s would also be skipped — disabled for safety.)
    // Instead: detect ad by checking if "skip ad" button is visible and click it.

    log('Ad blocking fully initialized');
  }

  // Find video element by polling
  var videoCheckInterval = setInterval(function() {
    var v = document.querySelector('video');
    if (v) setupVideo(v);
  }, 250);

  // Also use MutationObserver for video element appearance
  var videoObserver = new MutationObserver(function() {
    var v = document.querySelector('video');
    if (v) setupVideo(v);
  });
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Notify parent that the bridge is alive (even before video element exists)
  post({ type: 'bridge_ready' });
})();
</script>`;

    // Inject bridge before </body> (or at end if no </body>)
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, bridge + '</body>');
    } else {
      html = html + bridge;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.status(200).send(html);
  } catch (e) {
    console.error('Embed proxy error:', e.message);
    res.status(500).send('Proxy error');
  }
};
