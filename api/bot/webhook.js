// Telegram bot webhook handler
const { isAdmin, sendMessage, editMessage, answerCallback, tg } = require('../_lib/telegram');
const { getAllUsers, getUser, deleteUser, deleteAllUsers, recordEvent, rateFilm } = require('../_lib/supabase');
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
function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📊 Статистика', callback_data: 'menu_stats' },
        { text: '👥 Пользователи', callback_data: 'menu_users' }
      ],
      [
        { text: '🎬 Мои фильмы', callback_data: 'menu_myfilms' },
        { text: '🚀 Деплой', callback_data: 'menu_deploy' }
      ],
      [
        { text: '📢 Уведомление', callback_data: 'menu_broadcast' },
        { text: '🧹 Очистить статистику', callback_data: 'menu_clear' }
      ],
      [{ text: '🐛 Debug (с консолью)', web_app: { url: DEBUG_URL } }]
    ]
  };
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
      [{ text: '⬅️ Назад', callback_data: 'menu_main' }]
    ]
  };
}

function usersListKeyboard(users, page) {
  const pageSize = 8;
  const allEntries = users.map((u, i) => [u.telegram_id || u.id, u]).sort((a, b) => {
    const aT = new Date(a[1].last_seen || 0).getTime();
    const bT = new Date(b[1].last_seen || 0).getTime();
    return bT - aT;
  });
  const totalPages = Math.max(1, Math.ceil(allEntries.length / pageSize));
  const curPage = Math.min(Math.max(0, page), totalPages - 1);
  const entries = allEntries.slice(curPage * pageSize, (curPage + 1) * pageSize);

  const buttons = entries.map(([id, u]) => [{
    text: `👤 ${u.username ? '@' + u.username : (u.ip || id)} →`,
    callback_data: `user_${id}`
  }]);

  const navRow = [];
  if (curPage > 0) navRow.push({ text: '⬅️', callback_data: `users_${curPage - 1}` });
  navRow.push({ text: `${curPage + 1}/${totalPages}`, callback_data: 'noop' });
  if (curPage < totalPages - 1) navRow.push({ text: '➡️', callback_data: `users_${curPage + 1}` });
  buttons.push(navRow);
  buttons.push([{ text: '⬅️ Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: buttons };
}

function userProfileKeyboard(targetId, hasLastFilm) {
  const buttons = [];
  buttons.push([
    { text: '🗑 Удалить профиль', callback_data: 'delprompt_' + targetId },
    { text: '⬅️ К списку', callback_data: 'menu_users' }
  ]);
  buttons.push([{ text: '🏠 Главная', callback_data: 'menu_main' }]);
  return { inline_keyboard: buttons };
}

// ---- Command handlers (each returns {text, keyboard} or sends a message) ----

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

  await recordEvent('bot_starts', {
    userId: String(user.id),
    username: user.username
  });

  const welcome = `🎬 <b>Добро пожаловать в Genopoisk!</b>\n\nКинотеатр прямо в Telegram — ищите фильмы, смотрите через встроенный плеер.\n\n👇 Нажмите кнопку меню (слева от поля ввода), чтобы открыть приложение.\nИли используйте кнопку ниже:`;

  // Debug button only for admin
  const rows = [
    [{ text: '🎬 Открыть Genopoisk', web_app: { url: SITE_URL } }],
    [{ text: '🎬 Мои фильмы', callback_data: 'menu_myfilms' }]
  ];
  if (isAdmin(user.id)) {
    rows.push([{ text: '🐛 Debug (с консолью)', web_app: { url: DEBUG_URL } }]);
  }
  const keyboard = { inline_keyboard: rows };
  await sendMessage(chatId, welcome, { reply_markup: keyboard });
}

async function cmdHelp(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Команда доступна только администратору.');
    return;
  }
  const text = `<b>🛠 Админ-панель Genopoisk</b>

Используйте кнопки под сообщениями для навигации. Команды:
/stats, /users, /status, /logs, /redeploy, /user &lt;id&gt;, /broadcast &lt;текст&gt;, /clear`;
  await sendMessage(chatId, text, { reply_markup: mainMenuKeyboard() });
}

// ---- Stats view ----
async function buildStatsText() {
  const users = await getAllUsers();
  const totalUsers = users.length;
  let totalViews = 0, totalSearches = 0, totalMovies = 0, totalBotStarts = 0, totalRatings = 0;
  
  for (const u of users) {
    const ebt = u.events_by_type || {};
    totalViews += ebt.page_views || 0;
    totalSearches += ebt.searches || 0;
    totalMovies += ebt.movies_opened || 0;
    totalBotStarts += ebt.bot_starts || 0;
    totalRatings += (u.rated_films || []).length;
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayUsers = users.filter(u => u.last_seen && u.last_seen.startsWith(today)).length;

  return `📊 <b>Статистика Genopoisk</b>

<b>Всего:</b>
   👁 Просмотры: <b>${totalViews}</b>
   🔍 Поиски: <b>${totalSearches}</b>
   🎬 Фильмов открыто: <b>${totalMovies}</b>
   ⭐ Оценено фильмов: <b>${totalRatings}</b>
   🤖 Запусков бота: <b>${totalBotStarts}</b>

<b>Сегодня:</b>
   👥 Уникальных: ${todayUsers}

<b>Аудитория:</b>
   Всего пользователей: <b>${totalUsers}</b>`;
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
  const ipHistory = (u.ip_history || []).slice(0, 10).join("\n   • ") || "—";
  const watchedFilms = u.watched_films || (u.last_film ? [u.last_film] : []);
  let filmsText = "—";
  if (watchedFilms.length > 0) {
    filmsText = watchedFilms.slice(0, 15).map(function(f, i) {
      var rating = f.rating ? " ⭐" + f.rating : "";
      return (i + 1) + ". «" + escapeHtml(f.title) + "»" + rating;
    }).join("\n   ");
    if (watchedFilms.length > 15) filmsText += "\n   ... и ещё " + (watchedFilms.length - 15);
  }
  let platform = "Telegram";
  if (targetId.startsWith("web_")) platform = "браузер";
  const text = `👤 <b>Профиль пользователя</b>\n\n<b>ID:</b> <code>${escapeHtml(u.telegram_id || u.id)}</code>\n<b>Username:</b> ${u.username ? "@" + escapeHtml(u.username) : "—"}\n<b>Платформа:</b> ${platform}\n<b>Текущий IP:</b> <code>${u.ip || "—"}</code>\n\n<b>История IP:</b>\n   • ${ipHistory}\n\n<b>Активность:</b>\n   🔍 Поиски: ${ebt.searches || 0}\n   🎬 Фильмов открыто: ${ebt.movies_opened || 0}\n   ⭐ Оценено фильмов: ${(u.rated_films || []).length}\n   🤖 Запусков бота: ${ebt.bot_starts || 0}\n\n<b>Просмотренные фильмы (${watchedFilms.length}):</b>\n   ${filmsText}\n\n<b>Первый визит:</b> ${first}\n<b>Последний визит:</b> ${last}`;
  return { text, hasLastFilm: !!u.last_film };
}

// ---- My films view (films watched by the user who clicked the button) ----
async function buildMyFilmsText(targetUserId) {
  const u = await getUser(targetUserId);
  if (!u) {
    return { text: `❌ Пользователь <code>${targetUserId}</code> не найден.`, films: [] };
  }
  const films = u.watched_films || (u.last_film ? [u.last_film] : []);
  if (films.length === 0) {
    return { text: `🎬 <b>Мои фильмы</b>\n\nВы ещё не смотрели фильмы.`, films: [] };
  }
  var lines = films.slice(0, 20).map(function(f, i) {
    var rating = f.rating ? ' ⭐' + f.rating : '';
    return (i + 1) + '. «' + escapeHtml(f.title) + '»' + rating;
  }).join('\n');
  return {
    text: '🎬 <b>Мои фильмы</b> (всего ' + films.length + ')\n\n' + lines + '\n\nНажмите на фильм, чтобы открыть плеер:',
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
    return [{ text: '🎬 ' + f.title.slice(0, 40), callback_data: 'myfilm_' + idx }];
  });

  var navRow = [];
  if (curPage > 0) navRow.push({ text: '⬅️', callback_data: 'myfilms_' + (curPage - 1) });
  navRow.push({ text: (curPage + 1) + '/' + totalPages, callback_data: 'noop' });
  if (curPage < totalPages - 1) navRow.push({ text: '➡️', callback_data: 'myfilms_' + (curPage + 1) });
  buttons.push(navRow);
  buttons.push([{ text: '⬅️ Назад', callback_data: 'menu_main' }]);
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
  const userIds = Object.keys(allUsers || []);
  if (userIds.length === 0) {
    await sendMessage(chatId, 'Нет пользователей для рассылки.');
    return;
  }
  let sent = 0;
  let failed = 0;
  await sendMessage(chatId, `📢 Рассылка ${userIds.length} пользователям...`);
  for (const uid of userIds) {
    try {
      await sendMessage(Number(uid), `📢 <b>Сообщение от Genopoisk</b>\n\n${message}`);
      sent++;
    } catch (e) {
      failed++;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  await sendMessage(chatId, `✅ Отправлено: ${sent}, не доставлено: ${failed}`, { reply_markup: mainMenuKeyboard() });
}

async function cmdClear(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
      await deleteAllUsers();
  await sendMessage(chatId, '🧹 Статистика сброшена.', { reply_markup: mainMenuKeyboard() });
}

async function cmdUser(chatId, user, text) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  const parts = (text || '').split(/\s+/);
  const targetId = parts[1];
  if (!targetId) {
    await sendMessage(chatId, 'Использование: <code>/user &lt;telegram_id&gt;</code>\n\nСписок ID через /users', { reply_markup: mainMenuKeyboard() });
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
      await sendMessage(chatId, 'Нет пользователей для рассылки.', { reply_markup: mainMenuKeyboard() });
      return;
    }
    let sent = 0, failed = 0;
    await sendMessage(chatId, `📢 Рассылка ${allUsers.length} пользователям...`);
    for (const u of allUsers) {
      try {
        await sendMessage(Number(u.telegram_id), `📢 <b>Сообщение от Genopoisk</b>\n\n${message}`);
        sent++;
      } catch (e) { failed++; }
      await new Promise(r => setTimeout(r, 50));
    }
    await sendMessage(chatId, `✅ Отправлено: ${sent}, не доставлено: ${failed}`, { reply_markup: mainMenuKeyboard() });
    return;
  }

  if (text.startsWith('/start')) return cmdStart(chatId, user, text);
  if (text.startsWith('/help')) return cmdHelp(chatId, user);

  // Admin-only commands (no menu for regular users)
  if (isAdmin(user.id)) {
    if (text.startsWith('/stats')) return sendMessage(chatId, await buildStatsText(), { reply_markup: mainMenuKeyboard() });
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
      await sendMessage(chatId, 'Неизвестная команда. /help — список команд.', { reply_markup: mainMenuKeyboard() });
    } else {
      await sendMessage(chatId, 'Используйте кнопку меню, чтобы открыть приложение 🎬', {
        reply_markup: { inline_keyboard: [[{ text: '🎬 Открыть Genopoisk', web_app: { url: SITE_URL } }]] }
      });
    }
  } else {
    await sendMessage(chatId, 'Используйте кнопку меню, чтобы открыть приложение 🎬', {
      reply_markup: { inline_keyboard: [[{ text: '🎬 Открыть Genopoisk', web_app: { url: SITE_URL } }]] }
    });
  }
}

// ---- Callback router (inline button presses) ----
// Each callback either edits the existing message (preferred) or sends a new one.
async function handleCallback(update) {
  if (!update.callback_query) return;
  const cq = update.callback_query;
  const data = cq.data || '';
  const chatId = cq.message?.chat?.id || cq.from?.id;
  const messageId = cq.message?.message_id;
  const fromId = cq.from.id;

  if (!isAdmin(fromId)) {
    await answerCallback(cq.id, 'Доступ только для администратора');
    return;
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
      const text = `<b>🛠 Админ-панель Genopoisk</b>\n\nВыберите раздел:`;
      await edit(text, mainMenuKeyboard());
      return;
    }
    if (data === 'menu_stats') {
      await edit(await buildStatsText(), mainMenuKeyboard());
      return;
    }
    if (data === 'menu_myfilms') {
      // Show films watched by the user who clicked (identified by fromId)
      const result = await buildMyFilmsText(String(fromId));
      cacheMyFilms(fromId, result.films); // cache for film button callbacks
      await edit(result.text, myFilmsKeyboard(result.films, 0));
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
          [{ text: '🧹 Очистить всю статистику', callback_data: 'clear_confirm' }],
          [{ text: '⬅️ Назад', callback_data: 'menu_main' }]
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
      await edit('✅ <b>Все сессии сброшены.</b>\n\nВсе устройства должны заново пройти авторизацию через Telegram.', mainMenuKeyboard());
      return;
    }
    if (data === 'clear_confirm') {
      await deleteAllUsers();
      await edit('✅ <b>Статистика очищена.</b>\n\nВсе данные удалены.', mainMenuKeyboard());
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
        await edit('❌ Ошибка: ' + escapeHtml(e.message), mainMenuKeyboard());
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
      const playerUrl = SITE_URL.replace(/\/$/, '') + '/player.html?id=' + film.filmId + '&title=' + encodeURIComponent(film.title);
      await answerCallback(cq.id, 'Открываю...');
      // Build star rating buttons (1-5)
      var currentRating = film.rating || 0;
      var starButtons = [];
      for (var s = 1; s <= 5; s++) {
        var star = s <= currentRating ? '⭐' : '☆';
        starButtons.push({ text: star + s, callback_data: 'rate_' + idx + '_' + s });
      }
      await sendMessage(chatId, '🎬 <b>' + escapeHtml(film.title) + '</b>\n\nНажмите "Смотреть", чтобы открыть плеер, или нажмите на звёзды для оценки фильма:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '▶ Смотреть', web_app: { url: playerUrl } }],
            starButtons,
            [{ text: '⬅️ К списку', callback_data: 'menu_myfilms' }]
          ]
        }
      });
      return;
    }

    // ---- Rate film ----
    const rateMatch = data.match(/^rate_(\d+)_(\d+)$/);
    if (rateMatch) {
      const idx = parseInt(rateMatch[1], 10);
      const rating = parseInt(rateMatch[2], 10);
      const films = getCachedMyFilms(fromId);
      const film = films[idx];
      if (!film) {
        await answerCallback(cq.id, 'Фильм не найден');
        return;
      }
      // Save rating to Supabase
      try {
        await rateFilm(String(fromId), film.filmId, film.title, rating);
        film.rating = rating;
        cacheMyFilms(fromId, films);
      } catch (e) { console.error('Rate error:', e); }
      // Update the message with new rating
      var stars = '';
      for (var ss = 1; ss <= 5; ss++) { stars += ss <= rating ? '⭐' : '☆'; }
      await answerCallback(cq.id, 'Оценка: ' + rating + ' ⭐');
      // Re-show film card with updated rating
      var playerUrl = SITE_URL.replace(/\/$/, '') + '/player.html?id=' + film.filmId + '&title=' + encodeURIComponent(film.title);
      var starButtons2 = [];
      for (var s2 = 1; s2 <= 5; s2++) {
        var star2 = s2 <= rating ? '⭐' : '☆';
        starButtons2.push({ text: star2 + s2, callback_data: 'rate_' + idx + '_' + s2 });
      }
      // Edit the last message (the one with film card)
      if (messageId) {
        try {
          await editMessage(chatId, messageId, '🎬 <b>' + escapeHtml(film.title) + '</b>\n\nВаша оценка: ' + stars + '\n\nНажмите "Смотреть", чтобы открыть плеер, или измените оценку:', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '▶ Смотреть', web_app: { url: playerUrl } }],
                starButtons2,
                [{ text: '⬅️ К списку', callback_data: 'menu_myfilms' }]
              ]
            }
          });
        } catch (_) {
          // If edit fails (message not found), send new
          await sendMessage(chatId, '🎬 <b>' + escapeHtml(film.title) + '</b>\n\nВаша оценка: ' + stars, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '▶ Смотреть', web_app: { url: playerUrl } }],
                starButtons2,
                [{ text: '⬅️ К списку', callback_data: 'menu_myfilms' }]
              ]
            }
          });
        }
      }
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
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({
      ok: true,
      service: 'genopoisk-bot',
      endpoints: ['/api/bot/webhook (POST from Telegram)']
    });
  }

  const update = req.body;
  console.log('TG update:', JSON.stringify(update).slice(0, 500));

  try {
    if (update.message) {
      await handleMessage(update);
    } else if (update.callback_query) {
      await handleCallback(update);
    } else if (update.web_app_data) {
      const msg = update.web_app_data;
      await sendMessage(msg.from?.id || update.message?.chat?.id, `Получены данные из Mini App: ${msg.data}`);
    }
  } catch (e) {
    console.error('Handler error:', e);
    try {
      const chatId = update.message?.chat?.id || update.callback_query?.from?.id;
      if (chatId) await sendMessage(chatId, `⚠️ Ошибка: ${e.message}`);
    } catch (_) {}
  }

  res.status(200).json({ ok: true });
};
