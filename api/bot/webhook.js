// Telegram bot webhook handler
const { isAdmin, sendMessage, answerCallback, tg } = require('../_lib/telegram');
const { readStats, recordEvent } = require('../_lib/stats');
const {
  getProjectInfo,
  getLatestDeployments,
  triggerRedeploy,
  formatDeployment
} = require('../_lib/vercel');

const BOT_USERNAME = 'Genopoiskbot';
const SITE_URL = process.env.SITE_URL || 'https://genopoisk.vercel.app';

// ---- Command handlers ----

async function cmdStart(chatId, user, text) {
  const args = text.split(/\s+/).slice(1).join(' ');
  await recordEvent('bot_starts', {
    userId: String(user.id),
    username: user.username
  });

  const idLine = `<b>🆔 Ваш Telegram ID:</b> <code>${user.id}</code>`;
  const adminLine = isAdmin(user.id)
    ? '✅ Вы администратор. /help — список админ-команд.'
    : `Чтобы получить админ-доступ, отправьте этот ID владельцу бота.\nАдмин ID для добавления: <code>${user.id}</code>`;

  const welcome = `🎬 <b>Добро пожаловать в Genopoisk!</b>\n\nКинотеатр прямо в Telegram — ищите фильмы, смотрите через встроенный плеер.\n\n${idLine}\n${adminLine}\n\n👇 Нажмите кнопку меню (слева от поля ввода), чтобы открыть приложение.\nИли используйте кнопку ниже:`;

  const keyboard = {
    inline_keyboard: [[
      { text: '🎬 Открыть Genopoisk', web_app: { url: SITE_URL } }
    ]]
  };
  await sendMessage(chatId, welcome, { reply_markup: keyboard });
}

async function cmdHelp(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Команда доступна только администратору.\n\nВаш ID: <code>' + user.id + '</code>');
    return;
  }
  const text = `<b>🛠 Админ-команды Genopoisk Bot</b>

📊 <b>Статистика</b>
/stats — общая статистика сайта
/visits — последние события
/users — список активных пользователей

🚀 <b>Деплой</b>
/status — статус последнего деплоя
/logs — последние 5 деплоев
/redeploy — пересобрать сайт

📢 <b>Связь</b>
/broadcast &lt;текст&gt; — рассылка всем пользователям
/clear — сбросить статистику (осторожно!)

ℹ️ /help — эта справка
🎬 /start — открыть приложение`;
  await sendMessage(chatId, text);
}

async function cmdStats(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  const stats = await readStats();
  const totals = stats.totals || {};
  const users = stats.users || {};
  const daily = stats.daily || {};
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = daily[today] || {};

  const activeUsers7d = Object.values(users).filter(u => {
    if (!u.last_seen) return false;
    const age = Date.now() - new Date(u.last_seen).getTime();
    return age < 7 * 24 * 60 * 60 * 1000;
  }).length;

  const last7days = Object.entries(daily)
    .filter(([d]) => {
      const date = new Date(d);
      const age = Date.now() - date.getTime();
      return age < 7 * 24 * 60 * 60 * 1000 && age >= 0;
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, s]) => `   ${d}: 👁${s.page_views||0} 🔍${s.searches||0} 🎬${s.movies_opened||0} 👤${s.unique_users||0}`)
    .join('\n');

  const text = `📊 <b>Статистика Genopoisk</b>

<b>Всего:</b>
   👁 Просмотры страниц: <b>${totals.page_views || 0}</b>
   🔍 Поиски: <b>${totals.searches || 0}</b>
   🎬 Открыто фильмов: <b>${totals.movies_opened || 0}</b>
   🔥 Открыто категорий: <b>${totals.categories_opened || 0}</b>
   🤖 Запусков бота: <b>${totals.bot_starts || 0}</b>

<b>Сегодня (${today}):</b>
   👁 ${todayStats.page_views || 0} • 🔍 ${todayStats.searches || 0} • 🎬 ${todayStats.movies_opened || 0}
   👥 Уникальных: ${todayStats.unique_users || 0}

<b>Аудитория:</b>
   Всего пользователей: <b>${Object.keys(users).length}</b>
   Активны за 7 дней: <b>${activeUsers7d}</b>

<b>Последние 7 дней:</b>
${last7days || '   (нет данных)'}

🕐 Обновлено: ${stats.last_updated ? new Date(stats.last_updated).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'никогда'}`;

  await sendMessage(chatId, text);
}

async function cmdVisits(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  const stats = await readStats();
  const events = stats.recent_events || [];

  if (events.length === 0) {
    await sendMessage(chatId, '📭 Пока нет событий.');
    return;
  }

  const lines = events.slice(0, 20).map(e => {
    const emoji = {
      page_views: '👁',
      searches: '🔍',
      movies_opened: '🎬',
      categories_opened: '🔥',
      bot_starts: '🤖'
    }[e.type] || '•';
    const time = new Date(e.ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    let extra = '';
    if (e.query) extra = ` "${e.query}"`;
    else if (e.title) extra = ` "${e.title}"`.slice(0, 40);
    else if (e.category) extra = ` [${e.category}]`;
    return `${emoji} ${time}${extra}`;
  }).join('\n');

  await sendMessage(chatId, `📋 <b>Последние события</b>\n\n${lines}`);
}

async function cmdUsers(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  const stats = await readStats();
  const users = stats.users || {};
  const entries = Object.entries(users).sort((a, b) => {
    const aT = new Date(a[1].last_seen || 0).getTime();
    const bT = new Date(b[1].last_seen || 0).getTime();
    return bT - aT;
  }).slice(0, 20);

  if (entries.length === 0) {
    await sendMessage(chatId, '👤 Пользователей пока нет.');
    return;
  }

  const lines = entries.map(([id, u]) => {
    const last = u.last_seen ? new Date(u.last_seen).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '?';
    return `👤 <code>${id}</code> • ${u.username || ''} • событий: ${u.events || 0} • посл: ${last}`;
  }).join('\n');

  await sendMessage(chatId, `👥 <b>Активные пользователи (топ-20)</b>\n\n${lines}`);
}

async function cmdStatus(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  try {
    const [project, deployments] = await Promise.all([
      getProjectInfo(),
      getLatestDeployments(1)
    ]);
    const latest = deployments[0];
    let text = `🚀 <b>Vercel Project: ${project.name}</b>\n\n`;
    text += `Framework: ${project.framework || 'static'}\n`;
    text += `Node: ${project.nodeVersion || 'default'}\n`;
    text += `Live: ${project.live ? '✅' : '❌'}\n`;
    text += `Updated: ${new Date(project.updatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n\n`;
    if (latest) {
      text += `<b>Последний деплой:</b>\n${formatDeployment(latest)}`;
    }
    await sendMessage(chatId, text);
  } catch (e) {
    await sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

async function cmdLogs(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  try {
    const deployments = await getLatestDeployments(5);
    if (deployments.length === 0) {
      await sendMessage(chatId, 'Нет деплоев.');
      return;
    }
    const lines = deployments.map(formatDeployment).join('\n\n');
    await sendMessage(chatId, `📜 <b>Последние деплои</b>\n\n${lines}`);
  } catch (e) {
    await sendMessage(chatId, `❌ Ошибка: ${e.message}`);
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
    await sendMessage(chatId, `✅ <b>Деплой запущен</b>\n\nID: <code>${result.id || result.uid}</code>\nURL: https://${result.url || '...'}`);
  } catch (e) {
    await sendMessage(chatId, `❌ Ошибка: ${e.message}`);
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
  const stats = await readStats();
  const userIds = Object.keys(stats.users || {});
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
    await new Promise(r => setTimeout(r, 50)); // avoid rate limit
  }
  await sendMessage(chatId, `✅ Отправлено: ${sent}, не доставлено: ${failed}`);
}

async function cmdClear(chatId, user) {
  if (!isAdmin(user.id)) {
    await sendMessage(chatId, '⚠️ Доступ только для администратора.');
    return;
  }
  const { writeStats } = require('../_lib/stats');
  await writeStats({
    version: 1,
    totals: { page_views: 0, searches: 0, movies_opened: 0, categories_opened: 0, bot_starts: 0 },
    users: {},
    daily: {},
    recent_events: [],
    last_updated: new Date().toISOString()
  });
  await sendMessage(chatId, '🧹 Статистика сброшена.');
}

// ---- Router ----

async function handleMessage(update) {
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const user = msg.from;
  const text = msg.text || '';

  console.log(`Message from ${user.id} (@${user.username}): ${text}`);

  if (text.startsWith('/start')) return cmdStart(chatId, user, text);
  if (text.startsWith('/help')) return cmdHelp(chatId, user);
  if (text.startsWith('/stats')) return cmdStats(chatId, user);
  if (text.startsWith('/visits')) return cmdVisits(chatId, user);
  if (text.startsWith('/users')) return cmdUsers(chatId, user);
  if (text.startsWith('/status')) return cmdStatus(chatId, user);
  if (text.startsWith('/logs')) return cmdLogs(chatId, user);
  if (text.startsWith('/redeploy')) return cmdRedeploy(chatId, user);
  if (text.startsWith('/broadcast')) return cmdBroadcast(chatId, user, text);
  if (text.startsWith('/clear')) return cmdClear(chatId, user);

  // Unknown command
  if (text.startsWith('/')) {
    await sendMessage(chatId, 'Неизвестная команда. /help — список команд.');
  } else {
    // Echo + suggest
    await sendMessage(chatId, 'Нажмите кнопку меню (слева от поля ввода), чтобы открыть приложение 🎬', {
      reply_markup: {
        inline_keyboard: [[
          { text: '🎬 Открыть Genopoisk', web_app: { url: SITE_URL } }
        ]]
      }
    });
  }
}

async function handleCallback(update) {
  if (!update.callback_query) return;
  const cq = update.callback_query;
  await answerCallback(cq.id, 'OK');
}

// ---- Lambda entrypoint ----

module.exports = async (req, res) => {
  // Telegram sends POST with update JSON
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
      // Handle Mini App data
      const msg = update.web_app_data;
      await sendMessage(msg.from?.id || update.message?.chat?.id, `Получены данные из Mini App: ${msg.data}`);
    }
  } catch (e) {
    console.error('Handler error:', e);
    // Try to notify
    try {
      const chatId = update.message?.chat?.id || update.callback_query?.from?.id;
      if (chatId) await sendMessage(chatId, `⚠️ Ошибка: ${e.message}`);
    } catch (_) {}
  }

  res.status(200).json({ ok: true });
};
