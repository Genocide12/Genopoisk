// Server-side proxy for the movie player iframe.
// Fetches the embed page from api.embess.ws server-side, injects:
//   1. <base> tag (relative URLs resolve to embess.ws)
//   2. Bridge script tag in <head> FIRST (before embess.ws ad scripts)
//
// The bridge is fetched from /bridge.js (same Vercel project, static file).
// Browser fetches /api/embed?id=X — no CORS preflight, no client-side parsing.

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

    // Inject bridge as FIRST element in <head> + <base> for relative URLs.
    // Bridge runs before embess.ws's ad config script → can intercept window.adsConfig.
    // IMPORTANT: closing tag below uses backslash escape so HTML parser of THIS
    // file doesn't terminate the file's own script (this is a server-side JS string,
    // but we still escape to be safe).
    const bridgeTag = '<script src="https://genopoisk.vercel.app/bridge.js"><\/script>';
    const baseTag = '<base href="https://api.embess.ws/">';

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, function(match) {
        return match + bridgeTag + baseTag;
      });
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/(<html[^>]*>)/i, '$1<head>' + bridgeTag + baseTag + '</head>');
    } else {
      html = '<head>' + bridgeTag + baseTag + '</head>' + html;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.status(200).send(html);
  } catch (e) {
    console.error('Embed proxy error:', e.message);
    res.status(500).send('Proxy error');
  }
};
