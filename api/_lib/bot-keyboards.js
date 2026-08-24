// Bot keyboards — extracted from webhook.js
const { bt, escapeHtml } = require('./bot-helpers');
const { getUser } = require('./supabase');

const SITE_URL = process.env.SITE_URL || 'https://genopoisk.vercel.app';
const BOT_USERNAME = process.env.BOT_USERNAME || 'Genopoiskbot';

// --- Main menu (admin) ---
function mainMenuKeyboard(user, lang) {
  var keyboard = [
    [{ text: bt(lang, 'openApp'), web_app: { url: SITE_URL } }],
    [
      { text: bt(lang, 'myFilms'), callback_data: 'menu_myfilms' },
      { text: bt(lang, 'favorites'), callback_data: 'menu_favorites' }
    ],
    [
      { text: bt(lang, 'stats'), callback_data: 'menu_stats' },
      { text: bt(lang, 'users'), callback_data: 'menu_users' }
    ],
    [
      { text: bt(lang, 'broadcast'), callback_data: 'menu_broadcast' },
      { text: bt(lang, 'help'), callback_data: 'menu_help' }
    ],
    [
      { text: bt(lang, 'deploy'), callback_data: 'menu_deploy' },
      { text: bt(lang, 'rollback'), callback_data: 'menu_rollback' }
    ],
    [{ text: bt(lang, 'clear'), callback_data: 'menu_clear' }]
  ];
  return { inline_keyboard: keyboard };
}

// --- User menu (non-admin) ---
function userMenuKeyboard(user, lang) {
  var keyboard = [
    [{ text: bt(lang, 'openApp'), web_app: { url: SITE_URL } }],
    [
      { text: bt(lang, 'myFilms'), callback_data: 'menu_myfilms' },
      { text: bt(lang, 'favorites'), callback_data: 'menu_favorites' }
    ],
    [{ text: bt(lang, 'help'), callback_data: 'menu_help' }]
  ];
  return { inline_keyboard: keyboard };
}

// --- Deploy menu ---
function deployMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🚀 Trigger deploy', callback_data: 'deploy_trigger' }],
      [{ text: '⏪ Rollback to previous', callback_data: 'rollback_trigger' }],
      [{ text: '⬅️ Назад', callback_data: 'menu_main' }]
    ]
  };
}

// --- Users list ---
function usersListKeyboard(users, page) {
  var perPage = 8;
  var start = page * perPage;
  var end = start + perPage;
  var pageUsers = users.slice(start, end);
  var keyboard = [];
  pageUsers.forEach(function(u) {
    var name = u.username ? '@' + u.username : (u.ip || u.telegram_id || '?');
    keyboard.push([{ text: name, callback_data: 'user_' + (u.telegram_id || u.id) }]);
  });
  var nav = [];
  if (page > 0) nav.push({ text: '⬅️', callback_data: 'users_' + (page - 1) });
  nav.push({ text: (page + 1) + '/' + Math.ceil(users.length / perPage), callback_data: 'noop' });
  if (end < users.length) nav.push({ text: '➡️', callback_data: 'users_' + (page + 1) });
  if (nav.length > 1) keyboard.push(nav);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

// --- User profile ---
function userProfileKeyboard(targetId, hasLastFilm) {
  var keyboard = [];
  if (hasLastFilm) {
    keyboard.push([{ text: '▶ Открыть последний фильм', callback_data: 'open_film_' + targetId }]);
  }
  keyboard.push([{ text: '⬅️ К списку', callback_data: 'menu_users' }]);
  return { inline_keyboard: keyboard };
}

// --- My films pagination ---
function myFilmsKeyboard(films, page) {
  var perPage = 5;
  var start = page * perPage;
  var end = start + perPage;
  var pageFilms = films.slice(start, end);
  var keyboard = [];
  pageFilms.forEach(function(f) {
    keyboard.push([{ text: f.title || ('Фильм ' + f.filmId), callback_data: 'film_' + f.filmId }]);
  });
  var nav = [];
  if (page > 0) nav.push({ text: '⬅️', callback_data: 'myfilms_' + (page - 1) });
  if (end < films.length) nav.push({ text: '➡️', callback_data: 'myfilms_' + (page + 1) });
  if (nav.length > 1) keyboard.push(nav);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

// --- Favorites pagination ---
function favoritesKeyboard(films, page) {
  var perPage = 5;
  var start = page * perPage;
  var end = start + perPage;
  var pageFilms = films.slice(start, end);
  var keyboard = [];
  pageFilms.forEach(function(f) {
    keyboard.push([{ text: f.title || ('Фильм ' + f.filmId), callback_data: 'film_' + f.filmId }]);
  });
  var nav = [];
  if (page > 0) nav.push({ text: '⬅️', callback_data: 'favs_' + (page - 1) });
  if (end < films.length) nav.push({ text: '➡️', callback_data: 'favs_' + (page + 1) });
  if (nav.length > 1) keyboard.push(nav);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

module.exports = {
  mainMenuKeyboard: mainMenuKeyboard,
  userMenuKeyboard: userMenuKeyboard,
  deployMenuKeyboard: deployMenuKeyboard,
  usersListKeyboard: usersListKeyboard,
  userProfileKeyboard: userProfileKeyboard,
  myFilmsKeyboard: myFilmsKeyboard,
  favoritesKeyboard: favoritesKeyboard
};
