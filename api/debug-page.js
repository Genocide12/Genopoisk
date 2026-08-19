// Protect debug-index.html and debug-player.html — only admins can access.
// Non-admins get a 403 Forbidden.

const { isAdminRequest } = require('./_lib/admin-check');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Check if the request is from an admin
  var isAdmin = await isAdminRequest(req);
  if (!isAdmin) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(403).send(`
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Доступ запрещён</title></head>
<body style="background:#000;color:#fff;font-family:system-ui;padding:40px;text-align:center">
<h1>🚫 403 Forbidden</h1>
<p>Debug-страницы доступны только администраторам.</p>
<p>Войдите через Telegram как администратор, затем обновите страницу.</p>
<p><a href="/" style="color:#007AFF">← На главную</a></p>
</body>
</html>`);
  }

  // Admin — serve the actual debug page
  var page = req.query.page || 'index';
  var fileName = page === 'player' ? 'debug-player.html' : 'debug-index.html';
  
  // Read the file from /public directory
  var fs = require('fs');
  var path = require('path');
  var filePath = path.join(process.cwd(), 'public', fileName);
  
  try {
    var content = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(content);
  } catch (e) {
    res.setHeader('Content-Type', 'text/plain');
    return res.status(404).send('Debug page not found: ' + fileName);
  }
};
