// Bridge script — injected as the FIRST element in <head> of the iframe.
// Lightweight: only blocks tracking endpoints and broken P2P CDN nodes.
// NO ad blocking (it was breaking video playback).

(function() {
  if (window.__genopoiskBridge) return;
  window.__genopoiskBridge = true;

  function log() {
    try { console.log('[Genopoisk]', Array.from(arguments).join(' ')); } catch(_) {}
  }
  log('Bridge loaded (no ad blocking)');

  var videoEl = null;

  function post(msg) {
    try { parent.postMessage(msg, '*'); } catch(_) {}
  }

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
      return origFetch.apply(this, arguments);
    };
  } catch(e) {}

  // Override XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._genopoiskBlocked = isBlocked(url);
      this._genopoiskP2p = isP2pCdn(url);
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
      return origSend.apply(this, arguments);
    };
  } catch(e) {}

  // Override WebSocket to block tracking connections only (s.myangular.life).
  // Do NOT block t6.zcvh.net (P2P tracker) — venoplayer needs it.
  try {
    var OrigWebSocket = window.WebSocket;
    var WrappedWebSocket = function(url, protocols) {
      if (typeof url === 'string' && trackingPattern.test(url)) {
        log('Blocked WebSocket (rewriting URL):', url.slice(0, 100));
        url = 'ws://localhost:0/blocked';
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
