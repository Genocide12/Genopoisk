// Notify admin via Telegram about a new commit/push to GitHub.
//
// Called by the GitHub Action `.github/workflows/notify-telegram.yml`
// on every push to main. Sends a Telegram message to every chat ID in
// ADMIN_IDS with:
//   - Commit SHA (short)
//   - Commit message
//   - Author
//   - Files changed (+/- stat)
//   - Link to commit on GitHub
//
// Authentication: a shared secret in `NOTIFY_TOKEN` env var. The GitHub
// Action sends the same token in the `x-notify-token` header. This
// prevents randoms from spamming the endpoint.
//
// Usage:
//   POST /api/notify-commit
//   Headers: { x-notify-token: <NOTIFY_TOKEN>, Content-Type: application/json }
//   Body: {
//     sha: "abc1234...",
//     message: "Fix 403 + mobile pagination + long-press popup",
//     author: "Genocide12",
//     repo: "Genopoisk",
//     branch: "main",
//     files: [
//       { path: "api/kinopoisk.js", additions: 15, deletions: 8 },
//       ...
//     ],
//     url: "https://github.com/Genocide12/Genopoisk/commit/abc1234"
//   }

const { sendMessage } = require('./_lib/telegram');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatBytes(n) {
  if (!n) return '0';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

module.exports = async (req, res) => {
  // CORS (just in case)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notify-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify token
  const expected = process.env.NOTIFY_TOKEN;
  if (!expected) {
    console.error('[notify-commit] NOTIFY_TOKEN env var not set');
    return res.status(500).json({ error: 'NOTIFY_TOKEN not configured' });
  }
  const sent = req.headers['x-notify-token'];
  if (!sent || sent !== expected) {
    return res.status(401).json({ error: 'Invalid or missing token' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (!body || !body.sha || !body.message) {
    return res.status(400).json({ error: 'Missing required fields: sha, message' });
  }

  const sha = String(body.sha).slice(0, 7);
  const message = String(body.message).split('\n')[0].slice(0, 100);
  const author = escapeHtml(body.author || '—');
  const repo = escapeHtml(body.repo || 'Genopoisk');
  const branch = escapeHtml(body.branch || 'main');
  const url = String(body.url || '');
  const files = Array.isArray(body.files) ? body.files : [];
  const stats = body.stats || {};

  // Build files list (top 10 by changes, then "+ N more")
  let filesBlock = '';
  if (files.length > 0) {
    const sorted = files.slice().sort((a, b) =>
      ((b.additions || 0) + (b.deletions || 0)) - ((a.additions || 0) + (a.deletions || 0))
    );
    const top = sorted.slice(0, 10);
    filesBlock = top.map(function(f) {
      const path = escapeHtml(f.path);
      const a = f.additions || 0;
      const d = f.deletions || 0;
      return '  <code>' + path + '</code>  <font color="#34c759">+' + a + '</font> <font color="#ff453a">-' + d + '</font>';
    }).join('\n');
    if (sorted.length > 10) {
      filesBlock += '\n  <i>…и ещё ' + (sorted.length - 10) + ' файл(ов)</i>';
    }
  }

  const totalAdd = stats.additions || files.reduce((s, f) => s + (f.additions || 0), 0);
  const totalDel = stats.deletions || files.reduce((s, f) => s + (f.deletions || 0), 0);
  const totalFiles = stats.total || files.length;

  let text =
    '🔔 <b>Новый коммит в ' + repo + '</b>\n\n' +
    '🌿 Ветка: <code>' + branch + '</code>\n' +
    '👤 Автор: ' + author + '\n' +
    '📝 ' + escapeHtml(message) + '\n' +
    '🔢 SHA: <code>' + sha + '</code>\n' +
    '📊 Файлов: <b>' + totalFiles + '</b>  ' +
    '<font color="#34c759">+' + totalAdd + '</font> ' +
    '<font color="#ff453a">-' + totalDel + '</font>\n';

  if (filesBlock) {
    text += '\n<b>Изменения:</b>\n' + filesBlock + '\n';
  }

  if (url) {
    text += '\n🔗 <a href="' + escapeHtml(url) + '">Открыть коммит</a>';
  }

  // Send to every admin
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (adminIds.length === 0) {
    console.error('[notify-commit] ADMIN_IDS not set');
    return res.status(500).json({ error: 'ADMIN_IDS not configured' });
  }

  const results = [];
  for (const adminId of adminIds) {
    try {
      const msg = await sendMessage(Number(adminId), text, {
        disable_web_page_preview: true
      });
      results.push({ adminId, ok: true, messageId: msg && msg.message_id });
    } catch (e) {
      console.error('[notify-commit] Failed to send to', adminId, ':', e.message);
      results.push({ adminId, ok: false, error: e.message });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  return res.status(200).json({
    ok: successCount > 0,
    sent: successCount,
    total: adminIds.length,
    results
  });
};
