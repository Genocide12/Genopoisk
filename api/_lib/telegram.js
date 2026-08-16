// Telegram Bot API helper
const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tg(method, payload) {
  if (!TG_TOKEN) throw new Error('TG_BOT_TOKEN not set');
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('TG API error:', method, data);
    throw new Error(`TG ${method}: ${data.description || 'unknown'}`);
  }
  return data.result;
}

function isAdmin(userId) {
  const adminIds = (process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (adminIds.length === 0) return false;
  return adminIds.includes(String(userId));
}

async function sendMessage(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
}

// Edit an existing message (identified by chatId + messageId) instead of sending a new one.
// Used for inline button navigation: when user taps a button, we update the
// same message text + buttons rather than posting a new message.
async function editMessage(chatId, messageId, text, extra = {}) {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
}

async function answerCallback(callbackId, text) {
  return tg('answerCallbackQuery', { callback_query_id: callbackId, text });
}

async function deleteMessage(chatId, messageId) {
  return tg('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function sendPhoto(chatId, photo, caption, extra = {}) {
  return tg('sendPhoto', {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: 'HTML',
    ...extra
  });
}

async function editMessageCaption(chatId, messageId, caption, extra = {}) {
  return tg('editMessageCaption', {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: 'HTML',
    ...extra
  });
}

module.exports = { tg, isAdmin, sendMessage, editMessage, answerCallback, deleteMessage, sendPhoto, editMessageCaption };
