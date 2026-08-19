
    // ====== Performance & error logging ======
    window.addEventListener('DOMContentLoaded', function() {
      console.log('[perf] DOMContentLoaded at', (performance.now() / 1000).toFixed(2) + 's');
    });
    window.addEventListener('load', function() {
      console.log('[perf] Window load at', (performance.now() / 1000).toFixed(2) + 's');
    });
    window.addEventListener('error', function(e) {
      console.error('[error]', e.message, e.filename + ':' + e.lineno);
    });
    window.addEventListener('unhandledrejection', function(e) {
      console.error('[unhandled rejection]', e.reason && e.reason.message ? e.reason.message : e.reason);
    });
  