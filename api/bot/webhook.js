// Telegram bot webhook handler
const { isAdmin, sendMessage, editMessage, answerCallback, tg, deleteMessage, sendPhoto, editMessageCaption, answerInlineQuery } = require('../_lib/telegram');
const { getAllUsers, getUser, deleteUser, deleteAllUsers, recordEvent, rateFilm, parseUserAgent } = require('../_lib/supabase');
const {
  getProjectInfo,
  getLatestDeployments,
  triggerRedeploy,
  formatDeployment
} = require('../_lib/vercel');

const SITE_URL = process.env.SITE_URL || 'https://genopoisk.vercel.app';
const DEBUG_URL = SITE_URL.replace(/\/$/, '') + '/debug-index.html';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- In-memory cache for "My films" lists ----
// Telegram callback_data is limited to 64 bytes. We can't fit film titles
// (Russian, multi-byte UTF-8). Instead we cache the films list per user
// and use 'myfilm_<index>' as callback_data.
const myFilmsCache = new Map(); // userId -> films array
function cacheMyFilms(userId, films) {
  myFilmsCache.set(String(userId), films);
  // Clean old entries (keep last 50 users)
  if (myFilmsCache.size > 50) {
    const firstKey = myFilmsCache.keys().next().value;
    myFilmsCache.delete(firstKey);
  }
}
function getCachedMyFilms(userId) {
  return myFilmsCache.get(String(userId)) || [];
}

// Broadcast mode: when admin clicks "Уведомление", next text message is broadcast
const broadcastPending = new Map(); // userId -> true

// Track last admin message IDs for editMessage (prevents duplicate messages)
const lastAdminMsg = new Map(); // chatId -> { messageId, type }
function mainMenuKeyboard(user) {
  var isPremium = (user && user.is_premium) || (user && user.events_by_type && user.events_by_type.premium);
  var keyboard = [
    [
      { text: '📊 Статистика', callback_data: 'menu_stats' },
      { text: '👥 Пользователи', callback_data: 'menu_users' }
    ],
    [
      { text: '📀 Мои фильмы', callback_data: 'menu_myfilms' },
      { text: '🚀 Деплой', callback_data: 'menu_deploy' }
    ],
    [
      { text: '❤️ Коллекция', callback_data: 'menu_favorites' },
      { text: '📢 Уведомление', callback_data: 'menu_broadcast' }
    ],
    [
      { text: '🧹 Очистить статистику', callback_data: 'menu_clear' },
      { text: '❓ Помощь', callback_data: 'menu_help' }
    ]
  ];
  // Premium button — for admin too (admin can support the project)
  if (isPremium) {
    keyboard.push([{ text: '🔥 Premium активен', callback_data: 'menu_premium_status' }]);
  } else {
    keyboard.push([{ text: '⭐ Купить Premium (5 звёзд)', callback_data: 'menu_buy_premium' }]);
  }
  keyboard.push([{ text: '🐛 Debug (с консолью)', web_app: { url: DEBUG_URL } }]);
  return { inline_keyboard: keyboard };
}

function deployMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📊 Статус', callback_data: 'deploy_status' },
        { text: '📜 Логи', callback_data: 'deploy_logs' }
      ],
      [
        { text: '🔄 Redeploy', callback_data: 'deploy_redeploy' }
      ],
      [{ text: '🏠 На главную', callback_data: 'menu_main' }]
    ]
  };
}

function usersListKeyboard(users, page) {
  const pageSize = 8;
  const userArray = Array.isArray(users) ? users : [];
  const sorted = userArray.slice().sort((a, b) => {
    const aT = new Date(a.last_seen || 0).getTime();
    const bT = new Date(b.last_seen || 0).getTime();
    return bT - aT;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const curPage = Math.min(Math.max(0, page), totalPages - 1);
  const entries = sorted.slice(curPage * pageSize, (curPage + 1) * pageSize);

  const buttons = entries.map((u) => [{
    text: `👤 ${u.username ? '@' + u.username : (u.ip || u.telegram_id || '?')} →`,
    callback_data: `user_${u.telegram_id || u.id}`
  }]);

  const navRow = [];
  if (curPage > 0) navRow.push({ text: '⬅️', callback_data: `users_${curPage - 1}` });
  navRow.push({ text: `${curPage + 1}/${totalPages}`, callback_data: 'noop' });
  if (curPage < totalPages - 1) navRow.push({ text: '➡️', callback_data: `users_${curPage + 1}` });
  buttons.push(navRow);
  buttons.push([{ text: '🏠 На главную', callback_data: 'menu_main' }]);
  return { inline_keyboard: buttons };
}

function userProfileKeyboard(targetId, hasLastFilm) {
  const buttons = [];
  buttons.push([
    { text: '🗑 Удалить профиль', callback_data: 'delprompt_' + targetId },
    { text: '👥 К списку', callback_data: 'menu_users' }
  ]);
  buttons.push([{ text: '🏠 Главная', callback_data: 'menu_main' }]);
  return { inline_keyboard: buttons };
}

// Notify admin about a new user (first-ever /start in the bot)
async function notifyAdminNewUser(user, source) {
  try {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const name = user.first_name ? (user.first_name + (user.last_name ? ' ' + user.last_name : '')) : '—';
    const username = user.username ? '@' + user.username : '—';
    for (const adminId of adminIds) {
      try {
        await sendMessage(Number(adminId),
          '🔥 <b>Новый пользователь в боте!</b>\n\n' +
          'ID: <code>' + user.id + '</code>\n' +
          'Имя: ' + name + '\n' +
          'Username: ' + username + '\n' +
          'Источник: ' + (source || '—'),
          { reply_markup: { inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]] } }
        );
      } catch (_) {}
    }
    console.log('[bot] Admin notified about new bot user:', user.id);
  } catch (e) {
    console.warn('[bot] Admin notification failed:', e.message);
  }
}

// ---- Film card helper — shows poster + title + rating + share buttons ----
// Sends a NEW photo message (deletes the old text message first).
// Used by both 'Мои фильмы' and 'Коллекция' film cards.
async function showFilmCard(chatId, messageId, film, currentRating, context) {
  // context = 'myfilms' or 'favorites' — determines "back" button label
  var playerUrl = SITE_URL.replace(/\/$/, '') + '/player.html?id=' + film.filmId + '&title=' + encodeURIComponent(film.title);
  var posterUrl = SITE_URL.replace(/\/$/, '') + '/api/poster?id=' + encodeURIComponent(film.filmId) + '&size=medium';

  // Share URL — opens Telegram chat picker with film title
  var filmDeepLink = 'https://t.me/Genopoiskbot?start=film_' + encodeURIComponent(film.filmId);
  var shareText = '🎬 Смотри фильм «' + film.title + '» в Genopoisk!';
  var shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(filmDeepLink) + '&text=' + encodeURIComponent(shareText);

  // Star rating buttons
  var starButtons = [];
  for (var s = 1; s <= 5; s++) {
    var star = s <= currentRating ? '⭐' : '☆';
    starButtons.push({ text: star + s, callback_data: 'rate_' + film.filmId + '_' + s });
  }

  // Back button depends on context
  var backBtn = context === 'favorites'
    ? { text: '❤️ В коллекцию', callback_data: 'menu_favorites' }
    : { text: '📀 К списку', callback_data: 'menu_myfilms' };

  var keyboard = {
    inline_keyboard: [
      starButtons,
      [
        { text: '▶ Смотреть', web_app: { url: playerUrl } },
        { text: '📤 Поделиться', url: shareUrl }
      ],
      [
        backBtn,
        { text: '🏠 На главную', callback_data: 'menu_main' }
      ]
    ]
  };

  var caption = '🎬 <b>' + escapeHtml(film.title) + '</b>\n\n' +
    'Здесь вы можете оценить фильм, а также порекомендовать другу';

  // Send NEW photo message with film card — do NOT delete the list message.
  // User asked to keep the list visible so they can go back to it.
  // The film card appears as a new message below the list.
  try {
    await sendPhoto(chatId, posterUrl, caption, { reply_markup: keyboard });
  } catch (e) {
    // Poster failed — fallback to text-only message
    console.warn('[filmcard] sendPhoto failed, using text fallback:', e.message);
    await sendMessage(chatId, caption, { reply_markup: keyboard });
  }
}

// ---- Command handlers (each returns {text, keyboard} or sends a message) ----

// Keyboard for regular (non-admin) users — limited to user-facing features only.
function userMenuKeyboard(user) {
  var isPremium = (user && user.is_premium) || (user && user.events_by_type && user.events_by_type.premium);
  var keyboard = [
    [{ text: '🎞️ Открыть Genopoisk', web_app: { url: SITE_URL } }],
    [
      { text: '📀 Мои фильмы', callback_data: 'menu_myfilms' },
      { text: '❤️ Коллекция', callback_data: 'menu_favorites' }
    ]
  ];
  if (isPremium) {
    keyboard.push([{ text: '🔥 Premium активен', callback_data: 'menu_premium_status' }]);
  } else {
    keyboard.push([{ text: '⭐ Купить Premium (5 звёзд)', callback_data: 'menu_buy_premium' }]);
  }
  keyboard.push([{ text: '❓ Помощь', callback_data: 'menu_help' }]);
  return { inline_keyboard: keyboard };
}

async function cmdStart(chatId, user, text) {
  // Check for /start login — user wants to link their browser session
  const startParam = (text || '').split(/\s+/).slice(1).join(' ').trim();
  if (startParam === 'login') {
    const name = user.first_name ? (user.first_name + (user.last_name ? ' ' + user.last_name : '')) : ('@' + (user.username || 'Telegram'));
    const loginUrl = SITE_URL.replace(/\/$/, '') + '/?tg_id=' + user.id + '&tg_name=' + encodeURIComponent(name);
    await sendMessage(chatId, '🔐 <b>Привязка устройства</b>\n\nВаш Telegram ID: <code>' + user.id + '</code>\n\nЧтобы привязать это устройство:\n\n1. Скопируйте ссылку ниже\n2. Откройте Safari (или ваш браузер)\n3. Вставьте ссылку в адресную строку\n\n' +
      '<code>' + loginUrl + '</code>\n\n' +
      'Или нажмите на ссылку и удерживайте → "Открыть в Safari"', {
      reply_markup: {
        inline_keyboard: [[
          { text: '🌐 Открыть в браузере', url: loginUrl }
        ]]
      }
    });
    return;
  }

  // /start film_<ID> — shared film deep link. Opens the player directly.
  if (startParam.indexOf('film_') === 0) {
    const filmId = startParam.slice(5);
    if (filmId && /^\d+$/.test(filmId)) {
      const playerUrl = SITE_URL.replace(/\/$/, '') + '/player.html?id=' + filmId + '&title=' + encodeURIComponent('Поделённый фильм');
      const posterUrl = SITE_URL.replace(/\/$/, '') + '/api/poster?id=' + filmId + '&size=medium';

      // Try to fetch film title from Kinopoisk API for the message + poster
      var filmTitle = 'Поделённый фильм';
      try {
        const kinopoiskRes = await fetch(SITE_URL.replace(/\/$/, '') + '/api/kinopoisk?q=v2.2/films/' + filmId);
        if (kinopoiskRes.ok) {
          const filmData = await kinopoiskRes.json();
          filmTitle = filmData.nameRu || filmData.nameEn || filmTitle;
        }
      } catch (_) {}

      // Track this as a movies_opened event
      try {
        const { recordEvent } = require('../_lib/supabase');
        await recordEvent(String(user.id), 'movies_opened', {
          filmId: filmId,
          title: filmTitle,
          ip: null
        });
      } catch (_) {}

      // Update player URL with real title
      const playerUrlTitled = SITE_URL.replace(/\/$/, '') + '/player.html?id=' + filmId + '&title=' + encodeURIComponent(filmTitle);
      const keyboard = {
        inline_keyboard: [
          [{ text: '▶ Смотреть', web_app: { url: playerUrlTitled } }],
          [{ text: '🏠 На главную', callback_data: 'menu_main' }]
        ]
      };
      const caption = '🎬 <b>Вам поделились фильмом!</b>\n\n🎞️ <b>' + escapeHtml(filmTitle) + '</b>\n\nНажмите «Смотреть», чтобы открыть плеер:';

      // Send photo with poster if available, fallback to text
      try {
        await sendPhoto(chatId, posterUrl, caption, { reply_markup: keyboard });
      } catch (e) {
        await sendMessage(chatId, caption, { reply_markup: keyboard });
      }
      return;
    }
  }

  // /start app — user clicked "Открыть в Telegram" on the website.
  // This is the welcome-message trigger: if the user has NEVER been seen
  // by the bot before (no record in Supabase with their telegram_id), we
  // send them a welcome message. Otherwise we just show the regular menu.
  if (startParam === 'app' || startParam === 'from_site') {
    const existingUser = await getUser(String(user.id));
    const displayName = user.first_name
      ? (user.first_name + (user.last_name ? ' ' + user.last_name : ''))
      : ('@' + (user.username || 'Telegram'));

    if (!existingUser) {
      // FIRST-TIME USER — send welcome message
      console.log('[bot] First-time user from website:', user.id, user.username);
      const welcomeText = `🎬 <b>Добро пожаловать в Genopoisk!</b>\n\n` +
        `Привет, ${displayName}! Вы перешли с сайта — отлично, что заглянули в бота.\n\n` +
        `<b>Что умеет бот:</b>\n` +
        `🎞️ <b>Открыть Genopoisk</b> — запустить приложение прямо в Telegram\n` +
        `📀 <b>Мои фильмы</b> — история просмотренных фильмов + оценки ⭐\n` +
        `❤️ <b>Коллекция</b> — фильмы, которые вы сохранили в плеере\n` +
        `❓ <b>Помощь</b> — подробная справка по сайту, боту и приложению\n\n` +
        `Ваш профиль единый для всех устройств — сайт, бот, установленное приложение.\n` +
        `Позиция просмотра синхронизируется автоматически.\n\n` +
        `👇 Используйте кнопки ниже:`;
      await sendMessage(chatId, welcomeText, { reply_markup: userMenuKeyboard(await getUser(String(user.id))) });
      return;
    }

    // RETURNING USER — just show their menu (no welcome spam)
    if (isAdmin(user.id)) {
      const welcome = `🎬 <b>С возвращением!</b>\n\n🛠 <b>Админ-панель:</b>`;
      await sendMessage(chatId, welcome, { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    } else {
      const welcome = `🎬 <b>С возвращением в Genopoisk!</b>\n\n👇 Используйте кнопки ниже:`;
      await sendMessage(chatId, welcome, { reply_markup: userMenuKeyboard(await getUser(String(user.id))) });
    }
    return;
  }

  if (isAdmin(user.id)) {
    // ADMIN: welcome + full admin control panel
    const welcome = `🎬 <b>Добро пожаловать в Genopoisk!</b>\n\nКинотеатр прямо в Telegram — ищите фильмы, смотрите через встроенный плеер.\n\n🛠 <b>Админ-панель:</b> все кнопки управления ниже.`;
    await sendMessage(chatId, welcome, { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    return;
  }

  // REGULAR USER: minimal welcome + user-facing buttons only
  // Check if this user already exists in DB — if not, notify admin
  const existingUser = await getUser(String(user.id));
  const welcome = `🎬 <b>Добро пожаловать в Genopoisk!</b>\n\nКинотеатр прямо в Telegram — ищите фильмы, смотрите через встроенный плеер.\n\n👇 Используйте кнопки ниже:`;
  await sendMessage(chatId, welcome, { reply_markup: userMenuKeyboard(existingUser) });
  if (!existingUser) {
    await notifyAdminNewUser(user, '/start (бот)');
  }
}

// Detailed help text for regular users. Describes all features available
// in the bot, on the website, and in the PWA app.
function buildUserHelpText() {
  return `<b>❓ Помощь по Genopoisk</b>

<b>🎞️ Как смотреть фильмы</b>
1. Нажмите «🎞️ Открыть Genopoisk» — откроется приложение прямо в Telegram.
2. На главной введите название фильма в поиске или выберите категорию (Популярные, Топ 250, Новинки, Случайный).
3. Нажмите на постер фильма — откроется плеер.
4. В плеере используйте кнопки управления: пауза, перемотка, полноэкранный режим.

<b>📱 Как установить как приложение</b>
• <b>Android</b>: откройте genopoisk.vercel.app в Chrome → меню ⋮ → «Установить приложение».
• <b>iPhone/iPad</b>: откройте сайт в Safari → кнопка «Поделиться» → «На экран Домой».
• <b>Компьютер</b>: откройте сайт в Chrome/Edge → значок ⊕ в адресной строке → «Установить».
После установки приложение открывается в отдельном окне — как настоящее.

<b>⏯ Продолжение просмотра</b>
Если вы не досмотрели фильм, на главной появится карточка «Продолжить просмотр» с позицией, на которой вы остановились. Позиция синхронизируется между всеми устройствами — начните на телефоне, продолжите на компьютере.

<b>❤️ Коллекция</b>
В плеере нажмите ❤️ (или ☆ в шапке) — фильм добавится в коллекцию. Список коллекции фильмов доступен в боте (кнопка «❤️ Коллекция») и на сайте (карточка «❤️ Коллекция» на главной).

<b>📀 Мои фильмы</b>
История всех просмотренных фильмов. Откройте бота → «📀 Мои фильмы». Можно оценить фильм звёздами ⭐ (от 1 до 5) и снова открыть плеер.

<b>🔐 Аккаунт</b>
Вы входите автоматически через Telegram — никаких отдельных логинов и паролей. Ваш профиль единый для всех устройств: Mini App в Telegram, браузер, установленное приложение.

<b>🌐 Сайт</b>
Адрес: <code>genopoisk.vercel.app</code>
Открывается в любом браузере. Для входа используйте кнопку «Войти через Telegram» — авторизация пройдёт через официальный Telegram OAuth.

<b>🤖 Бот</b>
Команды: /start — главное меню, /help — эта справка.

Если что-то не работает — напишите разработчику.`;
}

async function cmdHelp(chatId, user) {
  if (isAdmin(user.id)) {
    // Admin sees BOTH admin command reference AND user-facing help
    const text = `<b>🛠 Админ-панель Genopoisk</b>

Используйте кнопки под сообщениями для навигации. Команды:
/stats, /users, /status, /logs, /redeploy, /user &lt;id&gt;, /broadcast &lt;текст&gt;, /clear

— — — — — — — — — — — — — — — — — — — — — — — — — — — — — —

<i>Ниже — справка, которую видят обычные пользователи при нажатии «❓ Помощь»:</i>

` + buildUserHelpText();
    await sendMessage(chatId, text, { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    return;
  }
  // Regular user — show full feature guide
  await sendMessage(chatId, buildUserHelpText(), { reply_markup: userMenuKeyboard(await getUser(String(user.id))) });
}

// ---- Stats view ----
async function buildStatsText() {
  const users = await getAllUsers();
  const totalUsers = users.length;
  let totalViews = 0, totalSearches = 0, totalMovies = 0, totalRatings = 0, totalFavorites = 0;

  // Daily watch counts for last 7 days (no bar chart, just numbers)
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'numeric' }),
      movies: 0
    });
  }
  const dayMap = {};
  days.forEach((d, i) => { dayMap[d.date] = i; });

  for (const u of users) {
    const ebt = u.events_by_type || {};
    // Exclude bot_starts (legacy, no longer tracked)
    totalViews += ebt.page_views || 0;
    totalSearches += ebt.searches || 0;
    totalMovies += ebt.movies_opened || 0;
    totalRatings += (u.rated_films || []).length;
    totalFavorites += (u.favorite_films || []).length;

    // Tally watched films per day (by watched_films[].ts)
    for (const f of (u.watched_films || [])) {
      if (!f.ts) continue;
      const day = String(f.ts).slice(0, 10);
      if (dayMap[day] !== undefined) {
        days[dayMap[day]].movies++;
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayUsers = users.filter(u => u.last_seen && u.last_seen.startsWith(today)).length;

  // Build per-day list (no bar chart, just "label: N")
  const weekText = days.map(function(d) {
    return '   ' + d.label + ': ' + d.movies;
  }).join('\n');

  return `📊 <b>Статистика Genopoisk</b>

<b>Всего:</b>
   👁 Просмотры: <b>${totalViews}</b>
   🔍 Поиски: <b>${totalSearches}</b>
   🎬 Фильмов открыто: <b>${totalMovies}</b>
   ⭐ Оценено фильмов: <b>${totalRatings}</b>
   ⭐ В коллекции: <b>${totalFavorites}</b>

<b>Сегодня:</b>
   👥 Уникальных: ${todayUsers}

<b>🎬 Фильмов открыто за неделю:</b>
${weekText}

<b>Аудитория:</b>
   Всего пользователей: <b>${totalUsers}</b>`;
}

// ---- Users list view ----
async function buildUsersListText() {
  const allUsers = await getAllUsers();
  const count = allUsers.length;
  return `👥 <b>Пользователи</b> (всего ${count})\n\nВыберите пользователя для просмотра профиля:`;
}

// ---- User profile view ----
async function buildUserProfileText(targetId) {
  const u = await getUser(targetId);
  if (!u) {
    return { text: `❌ Пользователь не найден.`, hasLastFilm: false };
  }
  const ebt = u.events_by_type || {};
  const first = u.first_seen ? new Date(u.first_seen).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "?";
  const last = u.last_seen ? new Date(u.last_seen).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "?";

  // IP history with device info — support both old (string) and new (object) formats
  var ipHistoryText = "—";
  if (u.ip_history && u.ip_history.length > 0) {
    ipHistoryText = u.ip_history.slice(0, 10).map(function(entry) {
      if (typeof entry === 'string') {
        return escapeHtml(entry) + ' — ' + '<i>неизвестно</i>';
      }
      var ip = escapeHtml(entry.ip || '');
      var dev = escapeHtml(entry.device || 'неизвестно');
      var ts = entry.ts ? new Date(entry.ts).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : '';
      return '<code>' + ip + '</code> — ' + dev + (ts ? ' (' + ts + ')' : '');
    }).join("\n   • ");
  }

  // Sessions list
  var sessionsText = "—";
  if (u.sessions && u.sessions.length > 0) {
    sessionsText = u.sessions.slice(0, 5).map(function(s) {
      var platformIcon = s.platform === 'miniapp' ? '📱 Mini App' : '🌐 Браузер';
      var lastSeen = s.last_seen ? new Date(s.last_seen).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : '?';
      return platformIcon + ' — ' + escapeHtml(s.device || 'неизвестно') + '\n      ↳ ' + lastSeen + (s.ip ? ' · <code>' + escapeHtml(s.ip) + '</code>' : '');
    }).join("\n   • ");
  }

  // After the auth fix:
  //   - telegram_id = Bot API user.id (short, e.g. 854765520) — used by both Mini App & Browser
  //   - oidc_sub    = OIDC subject identifier (long, e.g. 6611475080888633282) — only from Browser OIDC
  var telegramId = u.telegram_id || "—";
  var browserOidcSub = u.oidc_sub || "—";

  // Online status (last_seen within 2 minutes = online)
  var isOnline = false;
  var currentFilm = "";
  if (u.last_seen) {
    var ageMs = Date.now() - new Date(u.last_seen).getTime();
    if (ageMs < 120000) isOnline = true;
  }
  if (u.last_film && isOnline) {
    var filmAgeMs = Date.now() - new Date(u.last_film.ts || 0).getTime();
    if (filmAgeMs < 600000) currentFilm = ' (смотрит: «' + u.last_film.title + '»)';
  }
  var onlineStatus = isOnline ? '🟢 Онлайн' + currentFilm : '⚫ Офлайн';

  // Watched films
  const watchedFilms = u.watched_films || (u.last_film ? [u.last_film] : []);
  let filmsText = "—";
  if (watchedFilms.length > 0) {
    filmsText = watchedFilms.slice(0, 15).map(function(f, i) {
      var rating = f.rating ? " ⭐" + f.rating : "";
      var pos = (typeof f.position === 'number' && f.position > 5) ? ' ⏱' + formatPosition(f.position) : '';
      return (i + 1) + ". «" + escapeHtml(f.title) + "»" + rating + pos;
    }).join("\n   ");
    if (watchedFilms.length > 15) filmsText += "\n   ... и ещё " + (watchedFilms.length - 15);
  }

  // Favorites
  const favorites = u.favorite_films || [];
  let favText = "—";
  if (favorites.length > 0) {
    favText = favorites.slice(0, 10).map(function(f, i) {
      return (i + 1) + ". «" + escapeHtml(f.title) + "»";
    }).join("\n   ");
    if (favorites.length > 10) favText += "\n   ... и ещё " + (favorites.length - 10);
  }

  const text = `👤 <b>Профиль пользователя</b>\n\n<b>Telegram ID:</b> <code>${escapeHtml(telegramId)}</code>\n<b>Browser OIDC sub:</b> <code>${escapeHtml(browserOidcSub)}</code>\n<b>Username:</b> ${u.username ? "@" + escapeHtml(u.username) : "—"}\n<b>Статус:</b> ${onlineStatus}\n<b>Текущий IP:</b> <code>${u.ip || "—"}</code>\n\n<b>📱 Сессии:</b>\n   • ${sessionsText}\n\n<b>🌐 История IP:</b>\n   • ${ipHistoryText}\n\n<b>Активность:</b>\n   🔍 Поиски: ${ebt.searches || 0}\n   🎬 Фильмов открыто: ${ebt.movies_opened || 0}\n   ⭐ Оценено фильмов: ${(u.rated_films || []).length}\n   ⭐ В коллекции: ${favorites.length}\n\n<b>Просмотренные фильмы (${watchedFilms.length}):</b>\n   ${filmsText}\n\n<b>⭐ Коллекция (${favorites.length}):</b>\n   ${favText}\n\n<b>Первый визит:</b> ${first}\n<b>Последний визит:</b> ${last}`;
  return { text, hasLastFilm: !!u.last_film };
}

function formatPosition(seconds) {
  if (!seconds || seconds < 0 || !isFinite(seconds)) return '0:00';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}

// ---- My films view (films watched by the user who clicked the button) ----
async function buildMyFilmsText(targetUserId) {
  // targetUserId is the Bot API user.id of the user who pressed the button.
  // After the auth fix, this matches users.telegram_id directly.
  let u = await getUser(targetUserId);

  if (!u) {
    // User hasn't done anything yet — no profile in Supabase.
    return { text: `📀 <b>Мои фильмы</b>\n\nИстория ещё не создана. Откройте фильм, чтобы он появился здесь.`, films: [] };
  }
  const films = u.watched_films || (u.last_film ? [u.last_film] : []);
  if (films.length === 0) {
    return { text: `📀 <b>Мои фильмы</b>\n\nВы ещё не смотрели фильмы.`, films: [] };
  }
  var lines = films.slice(0, 20).map(function(f, i) {
    var rating = f.rating ? ' ⭐' + f.rating : '';
    return (i + 1) + '. «' + escapeHtml(f.title) + '»' + rating;
  }).join('\n');
  return {
    text: '📀 <b>Мои фильмы</b> (всего ' + films.length + ')\n\n' + lines + '\n\nНажмите на фильм, чтобы открыть плеер:',
    films: films
  };
}

function myFilmsKeyboard(films, page) {
  var pageSize = 8;
  var totalPages = Math.max(1, Math.ceil(films.length / pageSize));
  var curPage = Math.min(Math.max(0, page), totalPages - 1);
  var startIdx = curPage * pageSize;
  var entries = films.slice(startIdx, startIdx + pageSize);

  // Use index in callback_data (short, ASCII-safe). Film titles are cached.
  var buttons = entries.map(function(f, i) {
    var idx = startIdx + i;
    return [{ text: '📀 ' + f.title.slice(0, 40), callback_data: 'myfilm_' + idx }];
  });

  var navRow = [];
  if (curPage > 0) navRow.push({ text: '⬅️', callback_data: 'myfilms_' + (curPage - 1) });
  navRow.push({ text: (curPage + 1) + '/' + totalPages, callback_data: 'noop' });
  if (curPage < totalPages - 1) navRow.push({ text: '➡️', callback_data: 'myfilms_' + (curPage + 1) });
  buttons.push(navRow);
  buttons.push([{ text: '🏠 На главную', callback_data: 'menu_main' }]);
  return { inline_keyboard: buttons };
}

// ---- Favorites view (films favorited by the user who clicked the button) ----
async function buildFavoritesText(targetUserId) {
  let u = await getUser(targetUserId);
  if (!u) {
    return { text: `❤️ <b>Коллекция</b>\n\nИстория ещё не создана.`, films: [] };
  }
  const films = u.favorite_films || [];
  if (films.length === 0) {
    return { text: `❤️ <b>Коллекция</b>\n\nВы ещё не добавляли фильмы в коллекцию. Нажмите ❤️ в плеере, чтобы добавить.`, films: [] };
  }
  var lines = films.slice(0, 20).map(function(f, i) {
    return (i + 1) + '. «' + escapeHtml(f.title) + '»';
  }).join('\n');
  return {
    text: '❤️ <b>Коллекция</b> (всего ' + films.length + ')\n\n' + lines + '\n\nНажмите на фильм, чтобы открыть плеер:',
    films: films
  };
}

function favoritesKeyboard(films, page) {
  var pageSize = 8;
  var totalPages = Math.max(1, Math.ceil(films.length / pageSize));
  var curPage = Math.min(Math.max(0, page), totalPages - 1);
  var startIdx = curPage * pageSize;
  var entries = films.slice(startIdx, startIdx + pageSize);

  var buttons = entries.map(function(f, i) {
    var idx = startIdx + i;
    return [{ text: '❤️ ' + f.title.slice(0, 40), callback_data: 'favfilm_' + idx }];
  });

  var navRow = [];
  if (curPage > 0) navRow.push({ text: '⬅️', callback_data: 'favs_' + (curPage - 1) });
  navRow.push({ text: (curPage + 1) + '/' + totalPages, callback_data: 'noop' });
  if (curPage < totalPages - 1) navRow.push({ text: '➡️', callback_data: 'favs_' + (curPage + 1) });
  buttons.push(navRow);
  buttons.push([{ text: '🏠 На главную', callback_data: 'menu_main' }]);
  return { inline_keyboard: buttons };
}

// ---- Deploy views ----
async function buildStatusText() {
  try {
    const [project, deployments] = await Promise.all([
      getProjectInfo(),
      getLatestDeployments(1)
    ]);
    const latest = deployments[0];
    let text = `🚀 <b>Vercel: ${project.name}</b>\n\n`;
    text += `Framework: ${project.framework || 'static'}\n`;
    text += `Node: ${project.nodeVersion || 'default'}\n`;
    text += `Live: ${project.live ? '✅' : '❌'}\n`;
    text += `Updated: ${new Date(project.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n\n`;
    if (latest) {
      text += `<b>Последний деплой:</b>\n${formatDeployment(latest)}`;
    }
    return text;
  } catch (e) {
    return `❌ Ошибка: ${e.message}`;
  }
}

async function buildLogsText() {
  try {
    const deployments = await getLatestDeployments(5);
    if (deployments.length === 0) return 'Нет деплоев.';
    const lines = deployments.map(formatDeployment).join('\n\n');
    return `📜 <b>Последние деплои</b>\n\n${lines}`;
  } catch (e) {
    return `❌ Ошибка: ${e.message}`;
  }
}

async function cmdRedeploy(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  try {
    await sendMessage(chatId, '⏳ Запускаю пересборку...');
    const result = await triggerRedeploy();
    await sendMessage(chatId, `✅ <b>Деплой запущен</b>\n\nID: <code>${result.id || result.uid}</code>\nURL: https://${result.url || '...'}`, { reply_markup: deployMenuKeyboard() });
  } catch (e) {
    await sendMessage(chatId, `❌ Ошибка: ${e.message}`, { reply_markup: deployMenuKeyboard() });
  }
}

async function cmdBroadcast(chatId, user, text) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  const message = text.split(/\s+/).slice(1).join(' ');
  if (!message) {
    await sendMessage(chatId, 'Использование: /broadcast &lt;текст сообщения&gt;');
    return;
  }
  const allUsers = await getAllUsers();
  if (allUsers.length === 0) {
    await sendMessage(chatId, 'Нет пользователей для рассылки.');
    return;
  }
  let sent = 0;
  let failed = 0;
  await sendMessage(chatId, `📢 Рассылка ${allUsers.length} пользователям...`);
  for (const u of allUsers) {
    try {
      await sendMessage(Number(u.telegram_id), `📢 <b>Сообщение от Genopoisk</b>\n\n${message}`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]]
        }
      });
      sent++;
    } catch (e) {
      failed++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  await sendMessage(chatId, `✅ Отправлено: ${sent}, не доставлено: ${failed}`, { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
}

async function cmdClear(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
      await deleteAllUsers();
  await sendMessage(chatId, '🧹 Статистика сброшена.', { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
}

async function cmdUser(chatId, user, text) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  const parts = (text || '').split(/\s+/);
  const targetId = parts[1];
  if (!targetId) {
    await sendMessage(chatId, 'Использование: <code>/user &lt;telegram_id&gt;</code>\n\nСписок ID через /users', { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    return;
  }
  const result = await buildUserProfileText(String(targetId).trim());
  await sendMessage(chatId, result.text, { reply_markup: userProfileKeyboard(targetId, result.hasLastFilm) });
}

// ---- Router for /commands ----
async function handleMessage(update) {
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const user = msg.from;
  const text = msg.text || '';

  console.log(`Message from ${user.id} (@${user.username}): ${text}`);

  // Broadcast mode: if admin has pending broadcast, send this message to all users
  if (broadcastPending.get(String(user.id)) && isAdmin(user.id)) {
    broadcastPending.delete(String(user.id));
    const message = text;
    const allUsers = await getAllUsers();
    if (allUsers.length === 0) {
      await sendMessage(chatId, 'Нет пользователей для рассылки.', { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
      return;
    }
    let sent = 0, failed = 0;
    await sendMessage(chatId, `📢 Рассылка ${allUsers.length} пользователям...`);
    for (const u of allUsers) {
      try {
        await sendMessage(Number(u.telegram_id), `📢 <b>Сообщение от Genopoisk</b>\n\n${message}`, {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]]
        }
      });
        sent++;
      } catch (e) { failed++; }
      await new Promise(r => setTimeout(r, 50));
    }
    await sendMessage(chatId, `✅ Отправлено: ${sent}, не доставлено: ${failed}`, { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    return;
  }

  if (text.startsWith('/start')) return cmdStart(chatId, user, text);
  if (text.startsWith('/help')) return cmdHelp(chatId, user);

  // Admin-only commands (no menu for regular users)
  if (isAdmin(user.id)) {
    if (text.startsWith('/stats')) return sendMessage(chatId, await buildStatsText(), { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    if (text.startsWith('/users')) {
      const allUsers = await getAllUsers();
      return sendMessage(chatId, await buildUsersListText(), { reply_markup: usersListKeyboard(allUsers || [], 0) });
    }
    if (text.startsWith('/user')) return cmdUser(chatId, user, text);
    if (text.startsWith('/status')) return sendMessage(chatId, await buildStatusText(), { reply_markup: deployMenuKeyboard() });
    if (text.startsWith('/logs')) return sendMessage(chatId, await buildLogsText(), { reply_markup: deployMenuKeyboard() });
    if (text.startsWith('/redeploy')) return cmdRedeploy(chatId, user);
    if (text.startsWith('/clear')) return cmdClear(chatId, user);
  }

  if (text.startsWith('/')) {
    if (isAdmin(user.id)) {
      await sendMessage(chatId, 'Неизвестная команда. /help — список команд.', { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    } else {
      // Regular user — show their menu
      await sendMessage(chatId, 'Используйте кнопки ниже 👇', { reply_markup: userMenuKeyboard(await getUser(String(user.id))) });
    }
  } else {
    if (isAdmin(user.id)) {
      await sendMessage(chatId, 'Используйте кнопки ниже 👇', { reply_markup: mainMenuKeyboard(await getUser(String(user.id))) });
    } else {
      await sendMessage(chatId, 'Используйте кнопки ниже 👇', { reply_markup: userMenuKeyboard(await getUser(String(user.id))) });
    }
  }
}

// ---- Callback router (inline button presses) ----
// Each callback either edits the existing message (preferred) or sends a new one.

// Callbacks that regular (non-admin) users are allowed to press.
// Everything else requires admin.
const USER_ALLOWED_CALLBACKS = new Set([
  'menu_myfilms',
  'menu_favorites',
  'menu_help',
  'menu_buy_premium',
  'menu_premium_status',
  'refund_request',
  'noop'
]);
// Regex callbacks allowed for users
const USER_ALLOWED_REGEX = [
  /^myfilms_\d+$/,
  /^myfilm_\d+$/,
  /^rate_\d+_\d+$/,
  /^favs_\d+$/,
  /^favfilm_\d+$/,
  /^favremove_\d+$/
];

async function handleCallback(update) {
  if (!update.callback_query) return;
  const cq = update.callback_query;
  const data = cq.data || '';
  const chatId = cq.message?.chat?.id || cq.from?.id;
  const messageId = cq.message?.message_id;
  const fromId = cq.from.id;

  // Authorization check: regular users can only press whitelisted callbacks
  if (!isAdmin(fromId)) {
    const allowed = USER_ALLOWED_CALLBACKS.has(data) ||
                    USER_ALLOWED_REGEX.some(function(re) { return re.test(data); });
    if (!allowed) {
      await answerCallback(cq.id, 'Доступ только для администратора');
      return;
    }
  }

  try {
    // Helper: edit current message with new text + keyboard
    async function edit(text, keyboard) {
      if (messageId) {
        try {
          await editMessage(chatId, messageId, text, { reply_markup: keyboard });
          await answerCallback(cq.id, '');
          return;
        } catch (e) {
          // If message is not modified (same content), just answer callback — don't send new
          if (e.message && e.message.includes('not modified')) {
            await answerCallback(cq.id, '');
            return;
          }
          console.warn('editMessage failed, sending new:', e.message);
        }
      }
      await sendMessage(chatId, text, { reply_markup: keyboard });
      await answerCallback(cq.id, '');
    }

    if (data === 'noop') {
      await answerCallback(cq.id, '');
      return;
    }

    // ---- Main menu navigation ----
    if (data === 'menu_main') {
      if (isAdmin(fromId)) {
        const text = `<b>🛠 Админ-панель Genopoisk</b>\n\nВыберите раздел:`;
        await edit(text, mainMenuKeyboard(await getUser(String(fromId))));
      } else {
        // Regular user — show their menu
        const text = `🎞️ <b>Genopoisk</b>\n\nВыберите раздел:`;
        await edit(text, userMenuKeyboard(await getUser(String(fromId))));
      }
      return;
    }
    // Help section — available to regular users
    if (data === 'menu_help') {
      if (isAdmin(fromId)) {
        // Admin sees BOTH admin command reference AND the user-facing help
        // text (so admin knows what users see when they press Help).
        const adminHelp = `<b>🛠 Админ-панель Genopoisk</b>

Используйте кнопки под сообщениями для навигации. Команды:
/stats, /users, /status, /logs, /redeploy, /user &lt;id&gt;, /broadcast &lt;текст&gt;, /clear

— — — — — — — — — — — — — — — — — — — — — — — — — — — — — —

<i>Ниже — справка, которую видят обычные пользователи при нажатии «❓ Помощь»:</i>

` + buildUserHelpText();
        await edit(adminHelp, mainMenuKeyboard(await getUser(String(fromId))));
      } else {
        // Regular user — full feature guide
        const userObj = await getUser(String(fromId));
        await edit(buildUserHelpText(), userMenuKeyboard(userObj));
      }
      return;
    }
    // Buy premium — send Telegram Stars invoice
    if (data === 'menu_buy_premium') {
      const userObj = await getUser(String(fromId));
      if (userObj && userObj.is_premium) {
        await answerCallback(cq.id, 'У вас уже активен Premium 🔥');
        await edit('🔥 <b>Premium активен</b>\n\nСпасибо за поддержку проекта!', userMenuKeyboard(userObj));
        return;
      }
      // Send invoice with Telegram Stars as currency
      try {
        const invoiceParams = {
          chat_id: chatId,
          title: '🔥 Genopoisk Premium',
          description: 'Поддержка проекта + бейдж 🔥 в шапке сайта.\n\nPremium — это знак вашей поддержки. Спасибо!',
          payload: JSON.stringify({ type: 'premium', user_id: String(fromId) }),
          prices: [{ label: 'Premium подписка', amount: 5 }],
          currency: 'XTR',
          provider_token: ''
        };
        console.log('[premium] Sending invoice:', JSON.stringify(invoiceParams));
        const invoiceResult = await tg('sendInvoice', invoiceParams);
        console.log('[premium] Invoice sent successfully, message_id:', invoiceResult?.message_id);
        await answerCallback(cq.id, 'Счёт отправлен ⭐');
      } catch (e) {
        console.error('[premium] sendInvoice error:', e.message, e.stack);
        await answerCallback(cq.id, 'Ошибка: ' + e.message);
      }
      return;
    }
    // Premium status — show info for users who already have premium
    if (data === 'menu_premium_status') {
      const userObj = await getUser(String(fromId));
      const isPrem = (userObj && userObj.is_premium) || (userObj && userObj.events_by_type && userObj.events_by_type.premium);
      if (isPrem) {
        // Premium active — show status + refund button
        var premKeyboard = {
          inline_keyboard: [
            [{ text: '💸 Вернуть звёзды', callback_data: 'refund_request' }],
            [
              { text: '🏠 На главную', callback_data: 'menu_main' }
            ]
          ]
        };
        await edit('🔥 <b>Premium активен</b>\n\nСпасибо за поддержку проекта Genopoisk!\n\nВаш бейдж 🔥 отображается в шапке сайта.\n\nЕсли вы хотите вернуть звёзды — нажмите кнопку ниже. Запрос будет отправлен администратору на подтверждение.', premKeyboard);
      } else {
        await edit('У вас нет Premium.\n\nНажмите «⭐ Купить Premium» чтобы поддержать проект.', userMenuKeyboard(userObj));
      }
      return;
    }
    // User requests a star refund — notify admin for approval
    if (data === 'refund_request') {
      // Confirm the user has premium
      const userObj = await getUser(String(fromId));
      const isPrem = (userObj && userObj.is_premium) || (userObj && userObj.events_by_type && userObj.events_by_type.premium);
      if (!isPrem) {
        await answerCallback(cq.id, 'У вас нет Premium');
        return;
      }
      await answerCallback(cq.id, 'Запрос отправлен администратору ⏳');
      await edit('⏳ <b>Запрос на возврат звёзд отправлен</b>\n\nАдминистратор рассмотрит ваш запрос. После подтверждения звёзды вернутся на ваш аккаунт, а Premium будет отключён.', {
        inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]]
      });
      // Notify all admins
      const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      var userName = userObj && userObj.username ? '@' + userObj.username : '—';
      var userIdStr = String(fromId);
      for (const adminId of adminIds) {
        try {
          await sendMessage(Number(adminId),
            '💸 <b>Запрос на возврат звёзд</b>\n\n' +
            'Пользователь: ' + userName + '\n' +
            'ID: <code>' + userIdStr + '</code>\n\n' +
            'Подтвердить возврат? Premium будет отключён.',
            {
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Вернуть звёзды', callback_data: 'refund_approve_' + userIdStr },
                  { text: '❌ Отклонить', callback_data: 'refund_deny_' + userIdStr }
                ]]
              }
            }
          );
        } catch (_) {}
      }
      console.log('[refund] Request from user', fromId, 'sent to', adminIds.length, 'admins');
      return;
    }
    // Admin approves refund
    var refundApproveMatch = data.match(/^refund_approve_(.+)$/);
    if (refundApproveMatch) {
      if (!isAdmin(fromId)) {
        await answerCallback(cq.id, 'Только для администратора');
        return;
      }
      var refundUserId = refundApproveMatch[1];
      await answerCallback(cq.id, 'Возврат выполняется...');
      // Find the user's Star transaction
      try {
        const txRes = await fetch('https://api.telegram.org/bot' + process.env.TG_BOT_TOKEN + '/getStarTransactions?limit=50');
        const txData = await txRes.json();
        const txns = (txData.result && txData.result.transactions) || [];
        // Find the most recent incoming transaction from this user
        var userTxn = null;
        for (var i = 0; i < txns.length; i++) {
          var t = txns[i];
          var source = t.source;
          if (source && source.user_id === refundUserId && t.amount > 0) {
            userTxn = t;
            break;
          }
        }
        if (!userTxn) {
          await edit('❌ Транзакция не найдена. Возможно, звёзды уже были возвращены.');
          return;
        }
        // Call refundStarPayment
        var refundRes = await fetch('https://api.telegram.org/bot' + process.env.TG_BOT_TOKEN + '/refundStarPayment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: Number(refundUserId),
            telegram_payment_charge_id: userTxn.id
          })
        });
        var refundData = await refundRes.json();
        if (refundData.ok) {
          // Remove premium from Supabase
          try {
            await fetch(SITE_URL.replace(/\/$/, '') + '/api/track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'premium_refund',
                userId: refundUserId
              })
            });
          } catch (_) {}
          // Notify user
          try {
            await sendMessage(Number(refundUserId), '✅ <b>Звёзды возвращены</b>\n\nВаши звёзды зачислены обратно на аккаунт. Premium отключён.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]] }
            });
          } catch (_) {}
          // Update admin message
          await edit('✅ <b>Звёзды возвращены</b>\n\nПользователь <code>' + refundUserId + '</code> получил возврат. Premium отключён.');
          console.log('[refund] Approved for user', refundUserId, 'txn:', userTxn.id);
        } else {
          await edit('❌ Ошибка возврата: ' + (refundData.description || 'unknown'));
          console.error('[refund] API error:', JSON.stringify(refundData));
        }
      } catch (e) {
        await edit('❌ Ошибка: ' + e.message);
        console.error('[refund] Error:', e);
      }
      return;
    }
    // Admin denies refund
    var refundDenyMatch = data.match(/^refund_deny_(.+)$/);
    if (refundDenyMatch) {
      if (!isAdmin(fromId)) {
        await answerCallback(cq.id, 'Только для администратора');
        return;
      }
      var denyUserId = refundDenyMatch[1];
      await answerCallback(cq.id, 'Запрос отклонён');
      await edit('❌ <b>Запрос отклонён</b>\n\nВозврат звёзд отклонён для пользователя <code>' + denyUserId + '</code>.');
      // Notify user
      try {
        await sendMessage(Number(denyUserId), '❌ <b>Запрос на возврат звёзд отклонён</b>\n\nАдминистратор отклонил ваш запрос. Premium остаётся активным.', {
          reply_markup: { inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]] }
        });
      } catch (_) {}
      console.log('[refund] Denied for user', denyUserId);
      return;
    }
    if (data === 'menu_stats') {
      await edit(await buildStatsText(), mainMenuKeyboard(await getUser(String(fromId))));
      return;
    }
    if (data === 'menu_myfilms') {
      // Show films watched by the user who clicked (identified by fromId)
      const result = await buildMyFilmsText(String(fromId));
      cacheMyFilms(fromId, result.films); // cache for film button callbacks
      await edit(result.text, myFilmsKeyboard(result.films, 0));
      return;
    }
    if (data === 'menu_favorites') {
      const result = await buildFavoritesText(String(fromId));
      cacheMyFilms('fav_' + fromId, result.films); // reuse cache for favorites
      await edit(result.text, favoritesKeyboard(result.films, 0));
      return;
    }
    // Favorites pagination
    const favsPageMatch = data.match(/^favs_(\d+)$/);
    if (favsPageMatch) {
      const page = parseInt(favsPageMatch[1], 10);
      const result = await buildFavoritesText(String(fromId));
      cacheMyFilms('fav_' + fromId, result.films);
      await edit(result.text, favoritesKeyboard(result.films, page));
      return;
    }
    // Favorite film click → open film card with Watch / Remove / Back buttons
    const favFilmMatch = data.match(/^favfilm_(\d+)$/);
    if (favFilmMatch) {
      const idx = parseInt(favFilmMatch[1], 10);
      const films = getCachedMyFilms('fav_' + fromId);
      const film = films[idx];
      if (!film) {
        await answerCallback(cq.id, 'Фильм не найден. Обновите список.');
        return;
      }
      await answerCallback(cq.id, '');
      await showFilmCard(chatId, messageId, film, film.rating || 0, 'favorites');
      return;
    }

    // Remove film from favorites — sends favorite_removed event to /api/track,
    // which deletes the film from user.favorite_films in Supabase. This is
    // the SAME backend that the website reads, so the change is reflected
    // everywhere (bot favorites list, website ❤️ Коллекция section, player ☆
    // button state) automatically.
    const favRemoveMatch = data.match(/^favremove_(\d+)$/);
    if (favRemoveMatch) {
      const idx = parseInt(favRemoveMatch[1], 10);
      const films = getCachedMyFilms('fav_' + fromId);
      const film = films[idx];
      if (!film) {
        await answerCallback(cq.id, 'Фильм не найден. Обновите список.');
        return;
      }
      // Send favorite_removed event to backend
      try {
        await fetch(SITE_URL.replace(/\/$/, '') + '/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'favorite_removed',
            userId: String(fromId),
            username: cq.from.username || '',
            filmId: film.filmId,
            title: film.title
          })
        });
        // Remove from local cache too
        const updated = films.filter(function(_, i) { return i !== idx; });
        cacheMyFilms('fav_' + fromId, updated);
        console.log('[fav] Removed from favorites:', film.filmId, film.title);
      } catch (e) {
        console.error('[fav] Remove failed:', e.message);
        await answerCallback(cq.id, 'Ошибка удаления');
        return;
      }
      await answerCallback(cq.id, '✅ Удалено из избранного');
      // Re-render the favorites list (without the removed film)
      const result = await buildFavoritesText(String(fromId));
      cacheMyFilms('fav_' + fromId, result.films);
      await edit(result.text, favoritesKeyboard(result.films, 0));
      return;
    }
    if (data === 'menu_users') {
      const allUsers = await getAllUsers();
      await edit(await buildUsersListText(), usersListKeyboard(allUsers || [], 0));
      return;
    }
    if (data === 'menu_deploy') {
      const text = `🚀 <b>Деплой Vercel</b>\n\nВыберите действие:`;
      await edit(text, deployMenuKeyboard());
      return;
    }
    if (data === 'menu_clear') {
      const text = `🧹 <b>Управление статистикой</b>\n\nВыберите действие:`;
      await edit(text, {
        inline_keyboard: [
          [{ text: '🚪 Выйти со всех устройств', callback_data: 'clear_sessions' }],
          [{ text: '🧹 Очистить всю статистику', callback_data: 'clear_stats_prompt' }],
          [{ text: '🏠 На главную', callback_data: 'menu_main' }]
        ]
      });
      return;
    }
    if (data === 'clear_sessions') {
      const text = `🚪 <b>Выйти со всех устройств?</b>\n\nЭто удалит всех пользователей из статистики. Все устройства (браузеры, PWA) должны будут заново пройти авторизацию через Telegram.\n\nИстория просмотров будет потеряна.`;
      await edit(text, {
        inline_keyboard: [
          [
            { text: '✅ Да, выйти везде', callback_data: 'clear_sessions_confirm' },
            { text: '❌ Отмена', callback_data: 'menu_clear' }
          ]
        ]
      });
      return;
    }
    if (data === 'clear_sessions_confirm') {

      // Keep totals but clear all users
      await deleteAllUsers();
      await edit('✅ <b>Все сессии сброшены.</b>\n\nВсе устройства должны заново пройти авторизацию через Telegram.', mainMenuKeyboard(await getUser(String(fromId))));
      return;
    }
    if (data === 'clear_stats_prompt') {
      const text = `🧹 <b>Очистить всю статистику?</b>\n\nБудут удалены безвозвратно:\n• Все пользователи\n• История просмотров\n• Оценки фильмов\n• IP-адреса и события\n\nЭто действие нельзя отменить.`;
      await edit(text, {
        inline_keyboard: [
          [
            { text: '✅ Да, удалить всё', callback_data: 'clear_confirm' },
            { text: '❌ Отмена', callback_data: 'menu_clear' }
          ]
        ]
      });
      return;
    }
    if (data === 'clear_confirm') {
      await deleteAllUsers();
      await edit('✅ <b>Статистика очищена.</b>\n\nВсе данные удалены.', mainMenuKeyboard(await getUser(String(fromId))));
      return;
    }
    if (data === 'menu_broadcast') {
      broadcastPending.set(String(fromId), true);
      await edit('📢 <b>Уведомление всем пользователям</b>\n\nВведите текст сообщения для отправки. Следующее сообщение, которое вы отправите боту, будет разослано всем пользователям.', {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu_main' }]]
      });
      return;
    }

    // ---- Deploy sub-menu ----
    if (data === 'deploy_status') {
      await edit(await buildStatusText(), deployMenuKeyboard());
      return;
    }
    if (data === 'deploy_logs') {
      await edit(await buildLogsText(), deployMenuKeyboard());
      return;
    }
    if (data === 'deploy_redeploy') {
      try {
        const result = await triggerRedeploy();
        const text = `✅ <b>Деплой запущен</b>\n\nID: <code>${result.id || result.uid}</code>\nURL: https://${result.url || '...'}`;
        await edit(text, deployMenuKeyboard());
      } catch (e) {
        await edit(`❌ Ошибка: ${e.message}`, deployMenuKeyboard());
      }
      return;
    }

    // ---- User profile ----
    const userMatch = data.match(/^user_(.+)$/);
    if (userMatch) {
      const targetId = userMatch[1];
      const result = await buildUserProfileText(targetId);
      await edit(result.text, userProfileKeyboard(targetId, result.hasLastFilm));
      return;
    }

    // ---- Delete profile prompt ----
    const delPromptMatch = data.match(/^delprompt_(.+)$/);
    if (delPromptMatch) {
      const targetId = delPromptMatch[1];
      await edit('🗑 <b>Удалить профиль?</b>\n\nID: <code>' + escapeHtml(targetId) + '</code>\n\nВсе данные пользователя будут удалены безвозвратно.', {
        inline_keyboard: [
          [
            { text: '✅ Да, удалить', callback_data: 'delconfirm_' + targetId },
            { text: '❌ Отмена', callback_data: 'user_' + targetId }
          ]
        ]
      });
      return;
    }

    // ---- Delete profile confirm ----
    const delConfirmMatch = data.match(/^delconfirm_(.+)$/);
    if (delConfirmMatch) {
      const targetId = delConfirmMatch[1];
      try {
        await deleteUser(targetId);
        const allUsers = await getAllUsers();
        await edit('✅ Профиль <code>' + escapeHtml(targetId) + '</code> удалён.', usersListKeyboard(allUsers || [], 0));
      } catch (e) {
        await edit('❌ Ошибка: ' + escapeHtml(e.message), mainMenuKeyboard(await getUser(String(fromId))));
      }
      return;
    }

    // ---- Users pagination ----
    const pageMatch = data.match(/^users_(\d+)$/);
    if (pageMatch) {
      const page = parseInt(pageMatch[1], 10);
      const allUsers = await getAllUsers();
      await edit(await buildUsersListText(), usersListKeyboard(allUsers || [], page));
      return;
    }

    // ---- My films: open player for specific film (by index) ----
    const myFilmMatch = data.match(/^myfilm_(\d+)$/);
    if (myFilmMatch) {
      const idx = parseInt(myFilmMatch[1], 10);
      const films = getCachedMyFilms(fromId);
      const film = films[idx];
      if (!film) {
        await answerCallback(cq.id, 'Фильм не найден. Обновите список.');
        return;
      }
      await answerCallback(cq.id, '');
      await showFilmCard(chatId, messageId, film, film.rating || 0, 'myfilms');
      return;
    }

    // ---- Rate film ----
    const rateMatch = data.match(/^rate_(\d+)_(\d+)$/);
    if (rateMatch) {
      const filmId = rateMatch[1]; // now filmId, not index
      const rating = parseInt(rateMatch[2], 10);
      // Find film in cache (try both myfilms and favorites cache)
      var films = getCachedMyFilms(fromId);
      var film = films.find(function(f) { return String(f.filmId) === filmId; });
      if (!film) {
        films = getCachedMyFilms('fav_' + fromId);
        film = films.find(function(f) { return String(f.filmId) === filmId; });
      }
      if (!film) {
        await answerCallback(cq.id, 'Фильм не найден');
        return;
      }
      // Save rating to Supabase
      try {
        await rateFilm(String(fromId), film.filmId, film.title, rating);
        film.rating = rating;
      } catch (e) { console.error('Rate error:', e); }
      // Update the photo message's caption + keyboard
      var stars = '';
      for (var ss = 1; ss <= 5; ss++) { stars += ss <= rating ? '⭐' : '☆'; }
      await answerCallback(cq.id, 'Оценка: ' + rating + ' ⭐');

      // Build updated keyboard with new star state
      var playerUrl2 = SITE_URL.replace(/\/$/, '') + '/player.html?id=' + film.filmId + '&title=' + encodeURIComponent(film.title);
      var filmDeepLink2 = 'https://t.me/Genopoiskbot?start=film_' + encodeURIComponent(film.filmId);
      var shareText2 = '🎬 Смотри фильм «' + film.title + '» в Genopoisk!';
      var shareUrl2 = 'https://t.me/share/url?url=' + encodeURIComponent(filmDeepLink2) + '&text=' + encodeURIComponent(shareText2);
      var starButtons3 = [];
      for (var s3 = 1; s3 <= 5; s3++) {
        var star3 = s3 <= rating ? '⭐' : '☆';
        starButtons3.push({ text: star3 + s3, callback_data: 'rate_' + filmId + '_' + s3 });
      }
      var updatedCaption = '🎬 <b>' + escapeHtml(film.title) + '</b>\n\n' +
        'Ваша оценка: ' + stars + '\n\n' +
        'Здесь вы можете оценить фильм, а также порекомендовать другу';
      var updatedKeyboard = {
        inline_keyboard: [
          starButtons3,
          [
            { text: '▶ Смотреть', web_app: { url: playerUrl2 } },
            { text: '📤 Поделиться', url: shareUrl2 }
          ],
          [
            { text: '🏠 На главную', callback_data: 'menu_main' }
          ]
        ]
      };
      // Try editing caption (works for photo messages)
      if (messageId) {
        try {
          await editMessageCaption(chatId, messageId, updatedCaption, { reply_markup: updatedKeyboard });
        } catch (e) {
          try {
            await editMessage(chatId, messageId, updatedCaption, { reply_markup: updatedKeyboard });
          } catch (_) {}
        }
      }

      // Also update the film list message so the new rating shows there.
      // We search for the list by re-building it and sending as a new message.
      // This way user sees: updated film card + fresh list with rating.
      try {
        var listResult = await buildMyFilmsText(String(fromId));
        cacheMyFilms(fromId, listResult.films);
        await sendMessage(chatId, listResult.text, { reply_markup: myFilmsKeyboard(listResult.films, 0) });
      } catch (_) {}

      return;
    }

    // ---- My films pagination ----
    const myFilmsPageMatch = data.match(/^myfilms_(\d+)$/);
    if (myFilmsPageMatch) {
      const page = parseInt(myFilmsPageMatch[1], 10);
      const result = await buildMyFilmsText(String(fromId));
      cacheMyFilms(fromId, result.films);
      await edit(result.text, myFilmsKeyboard(result.films, page));
      return;
    }

    await answerCallback(cq.id, 'OK');
  } catch (e) {
    console.error('Callback error:', e);
    try { await answerCallback(cq.id, 'Ошибка: ' + e.message); } catch (_) {}
  }
}

// ---- Lambda entrypoint ----
// One-time bot command registration. Sets the command list that users see
// when they type '/' in the chat. Uses an in-memory flag so we only call
// setMyCommands once per cold start (avoid spamming the Telegram API on
// every request). Set to false again to force a refresh on next request.
let commandsRegistered = false;
async function registerBotCommands() {
  if (commandsRegistered) return;
  commandsRegistered = true; // set early to prevent concurrent calls
  try {
    // First wipe ALL previously registered command scopes (default, all_chats,
    // and any per-chat commands set via BotFather). Without this, setMyCommands
    // for the default scope doesn't override commands that were registered
    // individually per chat or via BotFather.
    await tg('deleteMyCommands', {});
    console.log('[bot] Cleared all previous commands');

    // Then register the new minimal command list
    await tg('setMyCommands', {
      commands: [
        { command: 'start', description: 'Открыть главное меню' },
        { command: 'help', description: 'Помощь по боту и приложению' }
      ]
    });
    console.log('[bot] Commands registered: /start, /help');

    // Also ensure webhook has ALL allowed_updates enabled.
    // Without this, Telegram silently drops inline_query and pre_checkout_query
    // updates (the webhook was originally registered with only message+callback_query).
    // We call setWebhook with the full list to fix this.
    try {
      await tg('setWebhook', {
        url: process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') + '/api/bot/webhook' : 'https://genopoisk.vercel.app/api/bot/webhook',
        allowed_updates: ['message', 'callback_query', 'inline_query', 'pre_checkout_query', 'web_app_data', 'chosen_inline_result'],
        max_connections: 40
      });
      console.log('[bot] Webhook updated with full allowed_updates');
    } catch (e) {
      console.warn('[bot] setWebhook failed:', e.message);
    }
  } catch (e) {
    console.warn('[bot] setMyCommands failed (will retry next request):', e.message);
    commandsRegistered = false; // allow retry
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({
      ok: true,
      service: 'genopoisk-bot',
      endpoints: ['/api/bot/webhook (POST from Telegram)']
    });
  }

  // Register bot command list (only /start and /help) on first request after
  // cold start. This removes legacy commands (/stats, /users, /status, /logs,
  // /redeploy, /user, /broadcast, /clear) that were previously registered
  // via BotFather and cluttered the '/' autocomplete menu.
  // Admin-only commands are still handled if typed manually, they're just
  // not advertised in the autocomplete.
  await registerBotCommands();

  const update = req.body;
  console.log('TG update:', JSON.stringify(update).slice(0, 500));

  try {
    if (update.message) {
      // Handle successful payment (Telegram Stars)
      if (update.message.successful_payment) {
        await handleSuccessfulPayment(update.message);
      } else {
        await handleMessage(update);
      }
    } else if (update.inline_query) {
      // Inline mode — user types @Genopoiskbot <query> in any chat.
      // We search Kinopoisk and return film results with posters.
      await handleInlineQuery(update.inline_query);
    } else if (update.pre_checkout_query) {
      // Telegram asks us to confirm the invoice is still valid.
      // We must answer within 10 seconds, otherwise the payment is cancelled.
      await tg('answerPreCheckoutQuery', {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true
      });
      console.log('[premium] Pre-checkout answered for user:', update.pre_checkout_query.from.id);
    } else if (update.callback_query) {
      await handleCallback(update);
    } else if (update.web_app_data) {
      const msg = update.web_app_data;
      await sendMessage(msg.from?.id || update.message?.chat?.id, `Получены данные из Mini App: ${msg.data}`, {
        reply_markup: { inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]] }
      });
    }
  } catch (e) {
    console.error('Handler error:', e);
    try {
      const chatId = update.message?.chat?.id || update.callback_query?.from?.id;
      if (chatId) await sendMessage(chatId, `⚠️ Ошибка: ${e.message}`, {
        reply_markup: { inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]] }
      });
    } catch (_) {}
  }

  res.status(200).json({ ok: true });
};

// Handle inline query — user types @Genopoiskbot <query> in any chat.
// Returns up to 20 film results with poster, title, year, rating.
// Each result is an InlineQueryResultArticle with thumbnail.
// When clicked, sends a message with the film deep link + poster.
async function handleInlineQuery(iq) {
  const query = (iq.query || '').trim();
  const userId = iq.from?.id;

  // If query is empty — show a helpful "start typing" message
  if (!query || query.length < 2) {
    await answerInlineQuery(iq.id, [{
      type: 'article',
      id: 'help',
      title: '🎬 Поиск фильмов',
      description: 'Начните вводить название фильма (минимум 2 символа)',
      input_message_content: {
        message_text: '🎬 Поиск фильмов в Genopoisk\n\nВведите @Genopoiskbot <название фильма> в любом чате для поиска.',
        parse_mode: 'HTML'
      },
      thumb_url: SITE_URL.replace(/\/$/, '') + '/icon-192.png',
      thumb_width: 192,
      thumb_height: 192
    }], { cache_time: 0 });
    return;
  }

  try {
    // Search Kinopoisk API
    const searchUrl = SITE_URL.replace(/\/$/, '') + '/api/kinopoisk?q=v2.1/films/search-by-keyword&keyword=' + encodeURIComponent(query) + '&page=1';
    const res = await fetch(searchUrl);
    if (!res.ok) {
      console.error('[inline] Kinopoisk search failed:', res.status);
      await answerInlineQuery(iq.id, [], { cache_time: 0 });
      return;
    }
    const data = await res.json();
    const films = data.films || [];

    if (films.length === 0) {
      await answerInlineQuery(iq.id, [{
        type: 'article',
        id: 'no_results',
        title: '🔍 Ничего не найдено',
        description: 'Попробуйте другой запрос',
        input_message_content: {
          message_text: '🔍 По запросу «' + escapeHtml(query) + '» ничего не найдено.',
          parse_mode: 'HTML'
        }
      }], { cache_time: 10 });
      return;
    }

    // Build inline results — up to 20 films
    const results = films.slice(0, 20).map(function(film, i) {
      const filmId = film.filmId || film.kinopoiskId;
      const title = film.nameRu || film.nameEn || film.nameOriginal || 'Без названия';
      const year = film.year || '';
      const rating = film.rating || film.ratingKinopoisk || '';

      // Build description: "2024 · 8.5 ★"
      var descParts = [];
      if (year) descParts.push(year);
      if (rating && rating !== 'null' && rating !== '0') {
        descParts.push('★ ' + (typeof rating === 'string' ? parseFloat(rating).toFixed(1) : rating));
      }
      if (film.genres && film.genres.length > 0) {
        var genres = film.genres.slice(0, 2).map(function(g) { return g.genre; }).join(', ');
        descParts.push(genres);
      }
      const description = descParts.join(' · ') || 'Нажмите чтобы открыть';

      // Deep link to bot — opens film in player
      const filmDeepLink = 'https://t.me/Genopoiskbot?start=film_' + filmId;
      // Thumbnail — use Kinopoisk's direct poster URL. Telegram can load
      // these (it follows redirects for thumb_url). Our /api/poster proxy
      // is too slow on first load (~2.5s) which causes Telegram to timeout.
      const thumbUrl = film.posterUrlPreview || film.posterUrl || '';

      // Message sent when user clicks the result
      const messageText = '🎬 <b>' + escapeHtml(title) + '</b>\n' +
        (year ? '📅 ' + year + '\n' : '') +
        (rating && rating !== 'null' && rating !== '0' ? '⭐ ' + (typeof rating === 'string' ? parseFloat(rating).toFixed(1) : rating) + '\n' : '') +
        '\n<a href="' + filmDeepLink + '">▶ Открыть в Genopoisk</a>';

      return {
        type: 'article',
        id: 'film_' + filmId + '_' + i,
        title: title,
        description: description,
        thumb_url: thumbUrl || undefined,
        thumb_width: 100,
        thumb_height: 150,
        input_message_content: {
          message_text: messageText,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        },
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Смотреть', url: filmDeepLink }
          ]]
        }
      };
    });

    await answerInlineQuery(iq.id, results, { cache_time: 60 });
    console.log('[inline] Returned', results.length, 'results for query:', query);
  } catch (e) {
    console.error('[inline] Error:', e.message);
    try { await answerInlineQuery(iq.id, [], { cache_time: 0 }); } catch (_) {}
  }
}

// Handle successful Telegram Stars payment — mark user as premium in Supabase
async function handleSuccessfulPayment(msg) {
  const payment = msg.successful_payment;
  console.log('[premium] === successful_payment received ===');
  console.log('[premium] from:', msg.from?.id, 'chat:', msg.chat?.id);
  console.log('[premium] amount:', payment?.total_amount, payment?.currency);
  console.log('[premium] payload:', payment?.invoice_payload);

  let payload = {};
  try {
    payload = JSON.parse(payment.invoice_payload || '{}');
  } catch (e) {
    console.error('[premium] Failed to parse payload:', e.message);
  }

  const userId = payload.user_id || String(msg.from.id);
  console.log('[premium] User ID:', userId, 'type:', payload.type);

  if (payload.type !== 'premium') {
    console.log('[premium] Not a premium payment, ignoring');
    return;
  }

  // 1) Send thank-you message IMMEDIATELY (before any Supabase calls)
  try {
    await sendMessage(msg.chat.id,
      '🔥 <b>Спасибо за поддержку!</b>\n\n' +
      'Ваш Premium активирован.\n' +
      'Бейдж 🔥 теперь отображается в шапке сайта.\n\n' +
      'Если бейдж не появился — обновите страницу (pull-to-refresh).'
    );
    console.log('[premium] Thank-you message sent to:', msg.chat.id);
  } catch (e) {
    console.error('[premium] Failed to send thank-you message:', e.message);
  }

  // 2) Mark user as premium — try is_premium column first, then fallback
  //    to events_by_type.premium (which always exists)
  let premiumSaved = false;
  try {
    const { updateUser, getUser } = require('../_lib/supabase');
    // First try the dedicated is_premium column
    const result = await updateUser(userId, {
      is_premium: true,
      premium_since: new Date().toISOString()
    });
    if (result) {
      premiumSaved = true;
      console.log('[premium] User', userId, 'marked as premium via is_premium column');
    }
  } catch (e) {
    console.error('[premium] is_premium column update failed:', e.message);
  }

  // Fallback: also set events_by_type.premium = 1 (this column always exists)
  // This way userMenuKeyboard can check events_by_type.premium if is_premium fails
  try {
    const userObj = await getUser(userId);
    if (userObj) {
      var ebt = userObj.events_by_type || {};
      ebt.premium = 1;
      await updateUser(userId, { events_by_type: ebt });
      console.log('[premium] events_by_type.premium set to 1 for user', userId);
    }
  } catch (e) {
    console.error('[premium] events_by_type fallback failed:', e.message);
  }

  // 3) Send user their updated menu (reload user to get fresh is_premium)
  try {
    const userObj = await getUser(userId);
    await sendMessage(msg.chat.id, '👇 Ваше меню:', { reply_markup: userMenuKeyboard(userObj) });
  } catch (_) {}

  // 4) Notify admin
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const adminId of adminIds) {
    try {
      const userObj = await getUser(userId);
      await sendMessage(Number(adminId),
        '🔥 <b>Новый Premium-пользователь!</b>\n\n' +
        'ID: <code>' + userId + '</code>\n' +
        'Username: ' + (userObj && userObj.username ? '@' + userObj.username : '—') + '\n' +
        'Сумма: ' + payment.total_amount + ' ' + payment.currency,
        { reply_markup: { inline_keyboard: [[{ text: '🏠 На главную', callback_data: 'menu_main' }]] } }
      );
    } catch (_) {}
  }
}
