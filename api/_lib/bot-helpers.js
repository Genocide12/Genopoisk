// Bot helpers — shared utilities for webhook.js
// Extracted to reduce webhook.js size and improve testability.

const { sendMessage, sendPhoto, answerCallbackQuery, editMessageText } = require('./telegram');
const { getUser, getAllUsers, deleteUser, deleteAllUsers } = require('./supabase');

// --- Language detection ---
function detectLang(user) {
  if (!user || !user.language_code) return 'ru';
  var code = user.language_code.toLowerCase();
  if (code.indexOf('en') === 0) return 'en';
  return 'ru';
}

// --- Button text ---
function bt(lang, key) {
  var texts = {
    ru: {
      openApp: '🎬 Открыть Genopoisk',
      myFilms: '📀 Мои фильмы',
      favorites: '❤️ Коллекция',
      help: '❓ Помощь',
      stats: '📊 Статистика',
      users: '👥 Пользователи',
      broadcast: '📢 Рассылка',
      deploy: '🚀 Деплой',
      rollback: '⏪ Откат',
      clear: '🧹 Очистить',
      back: '⬅️ Назад',
      cancel: '❌ Отмена',
      premium: '🔥 Premium'
    },
    en: {
      openApp: '🎬 Open Genopoisk',
      myFilms: '📀 My films',
      favorites: '❤️ Collection',
      help: '❓ Help',
      stats: '📊 Stats',
      users: '👥 Users',
      broadcast: '📢 Broadcast',
      deploy: '🚀 Deploy',
      rollback: '⏪ Rollback',
      clear: '🧹 Clear',
      back: '⬅️ Back',
      cancel: '❌ Cancel',
      premium: '🔥 Premium'
    }
  };
  return (texts[lang] || texts.ru)[key] || key;
}

// --- HTML escape ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Admin check ---
function isAdmin(userId) {
  var adminIds = (process.env.ADMIN_IDS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  return adminIds.indexOf(String(userId)) !== -1;
}

// --- Position formatting ---
function formatPosition(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// --- My films cache (in-memory, per-instance) ---
var myFilmsCache = new Map();
var MY_FILMS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cacheMyFilms(userId, films) {
  myFilmsCache.set(userId, { films: films, ts: Date.now() });
}

function getCachedMyFilms(userId) {
  var entry = myFilmsCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > MY_FILMS_CACHE_TTL) {
    myFilmsCache.delete(userId);
    return null;
  }
  return entry.films;
}

module.exports = {
  detectLang: detectLang,
  bt: bt,
  escapeHtml: escapeHtml,
  isAdmin: isAdmin,
  formatPosition: formatPosition,
  cacheMyFilms: cacheMyFilms,
  getCachedMyFilms: getCachedMyFilms
};
