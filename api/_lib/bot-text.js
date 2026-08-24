// Bot text builders — extracted from webhook.js
const { bt, escapeHtml, formatPosition } = require('./bot-helpers');
const { getUser, getAllUsers } = require('./supabase');

// --- User help text ---
function buildUserHelpText() {
  return '<b>❓ Помощь по Genopoisk</b>\n\n' +
    '<b>🎬 Сайт:</b> ' + (process.env.SITE_URL || 'https://genopoisk.vercel.app') + '\n\n' +
    '<b>📕 Разделы:</b>\n' +
    '• <b>Популярные</b> — самые просматриваемые фильмы\n' +
    '• <b>Топ 250</b> — лучшие фильмы по версии Кинопоиска\n' +
    '• <b>Новинки</b> — фильмы текущего года\n' +
    '• <b>Случайный</b> — не знаете что посмотреть? Выберем за вас!\n' +
    '• <b>Коллекция</b> — фильмы, которые вы сохранили\n' +
    '• <b>Что посмотреть?</b> — подборка по настроению\n\n' +
    '<b>🔎 Поиск:</b> введите название фильма в строку поиска\n\n' +
    '<b>▶ Просмотр:</b> нажмите на карточку фильма, чтобы открыть плеер\n' +
    'Позиция просмотра сохраняется автоматически — продолжайте с любого устройства\n\n' +
    '<b>⭐ Оценки:</b> в конце фильма вы можете оценить его от 1 до 5 звёзд\n\n' +
    '<b>❤️ Избранное:</b> нажмите ☆ в плеере, чтобы добавить фильм в коллекцию\n\n' +
    '<b>📱 Кросс-устройство:</b> ваш профиль единый для сайта, бота и Mini App\n' +
    'История, коллекция и позиция синхронизируются автоматически';
}

// --- Stats text ---
async function buildStatsText() {
  var users = await getAllUsers();
  var totalViews = 0, totalSearches = 0, totalMovies = 0, totalRatings = 0, totalFavorites = 0;

  users.forEach(function(u) {
    var ebt = u.events_by_type || {};
    totalViews += ebt.page_views || 0;
    totalSearches += ebt.searches || 0;
    totalMovies += ebt.movies_opened || 0;
    totalRatings += (u.rated_films || []).length;
    totalFavorites += (u.favorite_films || []).length;
  });

  var today = new Date().toISOString().slice(0, 10);
  var todayUsers = users.filter(function(u) { return u.last_seen && u.last_seen.startsWith(today); }).length;

  return '<b>📊 Статистика Genopoisk</b>\n\n' +
    '<b>Всего:</b>\n' +
    '   👁 Просмотры: <b>' + totalViews + '</b>\n' +
    '   🔍 Поиски: <b>' + totalSearches + '</b>\n' +
    '   🎬 Фильмов открыто: <b>' + totalMovies + '</b>\n' +
    '   ⭐ Оценено фильмов: <b>' + totalRatings + '</b>\n' +
    '   ⭐ В коллекции: <b>' + totalFavorites + '</b>\n\n' +
    '<b>Сегодня:</b>\n' +
    '   👥 Уникальных: ' + todayUsers + '\n\n' +
    '<b>Всего пользователей:</b> ' + users.length;
}

// --- User profile text ---
async function buildUserProfileText(targetId) {
  var u = await getUser(targetId);
  if (!u) return 'Пользователь не найден';

  var name = u.username ? '@' + u.username : (u.telegram_id || '—');
  var ebt = u.events_by_type || {};
  var watched = (u.watched_films || []).length;
  var favs = (u.favorite_films || []).length;
  var rated = (u.rated_films || []).length;
  var lastFilm = u.last_film ? (u.last_film.title || '—') : '—';
  var lastSeen = u.last_seen ? new Date(u.last_seen).toLocaleString('ru-RU') : '—';
  var ip = u.ip ? u.ip.substring(0, 20) + '...' : '—';
  var isPremium = u.is_premium || (ebt.premium > 0);

  return '<b>👤 Профиль пользователя</b>\n\n' +
    '<b>ID:</b> <code>' + (u.telegram_id || '—') + '</code>\n' +
    '<b>Username:</b> ' + escapeHtml(name) + '\n' +
    '<b>Premium:</b> ' + (isPremium ? '🔥 Да' : 'Нет') + '\n\n' +
    '<b>📊 Активность:</b>\n' +
    '   👁 Просмотры: ' + (ebt.page_views || 0) + '\n' +
    '   🔍 Поиски: ' + (ebt.searches || 0) + '\n' +
    '   🎬 Фильмов открыто: ' + (ebt.movies_opened || 0) + '\n' +
    '   📀 В истории: ' + watched + '\n' +
    '   ❤️ В коллекции: ' + favs + '\n' +
    '   ⭐ Оценок: ' + rated + '\n\n' +
    '<b>▶ Последний фильм:</b> ' + escapeHtml(lastFilm) + '\n' +
    '<b>🕐 Последний визит:</b> ' + lastSeen + '\n' +
    '<b>🌐 IP (хэш):</b> <code>' + ip + '</code>';
}

// --- My films text ---
async function buildMyFilmsText(targetUserId) {
  var u = await getUser(targetUserId);
  if (!u) return 'Пользователь не найден';
  var films = u.watched_films || [];
  if (films.length === 0) return 'История просмотров пуста';
  return '<b>📀 Мои фильмы (' + films.length + ')</b>\n\n' +
    films.slice(0, 5).map(function(f, i) {
      return (i + 1) + '. ' + escapeHtml(f.title || ('Фильм ' + f.filmId));
    }).join('\n');
}

// --- Favorites text ---
async function buildFavoritesText(targetUserId) {
  var u = await getUser(targetUserId);
  if (!u) return 'Пользователь не найден';
  var favs = u.favorite_films || [];
  if (favs.length === 0) return 'Коллекция пуста';
  return '<b>❤️ Коллекция (' + favs.length + ')</b>\n\n' +
    favs.slice(0, 5).map(function(f, i) {
      return (i + 1) + '. ' + escapeHtml(f.title || ('Фильм ' + f.filmId));
    }).join('\n');
}

module.exports = {
  buildUserHelpText: buildUserHelpText,
  buildStatsText: buildStatsText,
  buildUserProfileText: buildUserProfileText,
  buildMyFilmsText: buildMyFilmsText,
  buildFavoritesText: buildFavoritesText
};
