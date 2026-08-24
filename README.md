# 🎬 Genopoisk

Telegram Mini App / PWA для поиска и просмотра фильмов онлайн. Каталог фильмов Кинопоиска, избранное, история просмотров, кросс-устройственная синхронизация позиции.

## ✨ Возможности

- 🎬 **Каталог фильмов** — Популярные, Топ-250, Новинки, Случайный
- 🔍 **Поиск** по названию
- ❤️ **Избранное** (Коллекция) — синхронизируется между устройствами
- ▶️ **Продолжить просмотр** — позиция запоминается, продолжаешь с любого устройства
- 📱 **Telegram Mini App** — работает внутри Telegram
- 🌐 **Браузерная версия** — OIDC авторизация через Telegram
- 📺 **Поддержка проекторов/TV** — QR-вход для устройств без клавиатуры
- ⭐ **Оценки фильмов** (1-5 звёзд)
- 🔥 **Premium** через Telegram Stars
- 📊 **Статистика** для админа (просмотры, поиски, активные пользователи)
- 🔒 **Privacy-first** — IP хэшируются, UA не хранятся, политика конфиденциальности

## 🏗 Архитектура

```
                    Telegram
                       │
                ┌──────▼──────┐
                │ Auth / OIDC │
                └──────┬──────┘
                       │
                       ▼
┌───────────────┐  ┌──────────────┐
│ Web / MiniApp │──│ API Gateway  │
└───────────────┘  └──────┬───────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
     Movies API       User API        Player API
         │                │                │
         ▼                ▼                ▼
    Kinopoisk          Supabase        Provider
```

### Frontend
- **Vanilla JS + ES Modules** (без фреймворков)
- Структура: `public/js/modules/` — core, device, auth, ui, movies, tracking
- `public/js/app.js` — orchestrator (~320 строк)
- Service Worker для offline-доступа
- PWA с установкой на главный экран

### Backend
- **Vercel Serverless Functions** (10 endpoints, лимит Hobby = 12)
- `api/me.js` — объединённый endpoint (user state + favorites + resume)
- `api/kinopoisk.js` — proxy к Kinopoisk API (6 ключей, racing, retry)
- `api/poster.js` — proxy постеров (SSRF-защита, 30-day cache)
- `api/auth/qr.js` — QR-вход для проекторов
- `api/bot/webhook.js` — Telegram бот

### База данных
- **Supabase** (PostgreSQL + RLS)
- Таблица `users`: telegram_id, username, watched_films, favorites, last_film, ip_history (hashed)

## 🔐 Безопасность

- ✅ Telegram `initData` HMAC-верификация
- ✅ Session cookie (HttpOnly, HMAC-signed, 30-day expiry)
- ✅ CSRF-защита (state + PKCE)
- ✅ IDOR закрыт: `body.userId` принимает только `web_*` guest IDs
- ✅ IP хэшируются (SHA256, первые 3 октета)
- ✅ User-Agent не хранится
- ✅ SSRF-защита в poster proxy (allowlist хостов)
- ✅ `timingSafeEqual` для всех сравнений токенов
- ✅ `WEBHOOK_SECRET` для бота

## 🔒 Приватность

Подробно: [/privacy.html](https://genopoisk.vercel.app/privacy.html)

- IP хэшируется, не хранится в открытом виде
- User-Agent не хранится (только тип устройства)
- ip_history ограничена 3 записями
- IP не передаётся в Telegram
- Политика конфиденциальности на русском

## 🚀 Деплой

### Vercel
```bash
npm i -g vercel
vercel --prod
```

### Environment variables
```
TG_BOT_TOKEN=...
KINOPOISK_API_KEYS=key1,key2,key3,key4,key5,key6
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=...
SESSION_SECRET=...
WEBHOOK_SECRET=...
BOT_USERNAME=Genopoiskbot
TELEGRAM_CLIENT_ID=...
TELEGRAM_CLIENT_SECRET=...
TELEGRAM_REDIRECT_URI=https://genopoisk.vercel.app/api/auth/telegram/callback
ADMIN_IDS=854765520
NOTIFY_TOKEN=...
```

### Supabase схема
См. `/download/supabase-rls-fix.sql` — RLS policies (deny-all for anon key).

## 📁 Структура

```
api/
├── auth/
│   ├── qr.js              # QR-вход (POST=generate, GET=poll)
│   └── telegram/
│       ├── callback.js     # OIDC callback
│       └── login.js        # OIDC login start
├── bot/
│   └── webhook.js          # Telegram бот
├── _lib/
│   ├── auth.js             # extractVerifiedUser, session cookie
│   ├── supabase.js         # DB helper
│   ├── telegram.js         # Bot API client
│   └── vercel.js           # Vercel deployment API
├── embed.js                # Player embed proxy
├── kinopoisk.js            # Films API proxy
├── me.js                   # User state (merged: last-film + my-films + user-check)
├── notify-commit.js        # GitHub Action notifications
├── poster.js               # Poster image proxy
└── track.js                # Event tracking

public/
├── js/
│   ├── modules/
│   │   ├── core.js         # Constants, getUserId, helpers
│   │   ├── device.js       # TV/mobile/theme detection
│   │   ├── auth.js         # Telegram init, QR login, session
│   │   ├── ui.js           # Loader, films display, toast
│   │   ├── movies.js       # Catalog, search, favorites, pagination
│   │   └── tracking.js     # Event tracking + resume card
│   ├── app.js              # Main orchestrator (~320 lines)
│   ├── error-handler.js    # Global error handler
│   └── i18n.js             # Internationalization (ru/en)
├── css/
│   └── app.css             # All styles
├── index.html              # Main page
├── player.html             # Video player page
├── offline.html            # Offline fallback
├── privacy.html            # Privacy policy (RU)
├── sw.js                   # Service Worker
├── bridge.js               # Player iframe bridge
├── manifest.json           # PWA manifest
├── robots.txt              # SEO
└── sitemap.xml             # SEO

.github/workflows/
├── notify-telegram.yml     # Commit notifications (retry on 404)
└── daily-film-post.yml     # Auto-post film of the day to @genopoisk_news
```

## 📊 Endpoint count (10/12 Vercel Hobby limit)

| # | Endpoint | Method | Purpose |
|---|----------|--------|---------|
| 1 | `/api/auth/qr` | POST/GET | QR login |
| 2 | `/api/auth/telegram/callback` | GET | OIDC callback |
| 3 | `/api/auth/telegram/login` | GET | OIDC start |
| 4 | `/api/bot/webhook` | POST | Telegram bot |
| 5 | `/api/embed` | GET | Player proxy |
| 6 | `/api/kinopoisk` | GET | Films API |
| 7 | `/api/me` | POST | User state (merged) |
| 8 | `/api/notify-commit` | POST | GitHub notifications |
| 9 | `/api/poster` | GET | Poster proxy |
| 10 | `/api/track` | POST | Event tracking |

## 🛠 Разработка

```bash
# Локальный запуск
vercel dev

# Проверка синтаксиса
node -c api/*.js api/**/*.js public/js/*.js public/js/modules/*.js

# ESLint (warn-only)
npm run lint
```

## 📈 Производительность

- 30-day Edge cache для постеров (Vercel CDN)
- 24h cache для Kinopoisk API (s-maxage + stale-while-revalidate)
- Cache-first loading: фильмы показываются из localStorage мгновенно
- Aggressive prefetch: 4 категории + 12 постеров при загрузке
- Lazy loading для ниже-экранных постеров
- Service Worker для offline

## 📝 Лицензия

Private project. All rights reserved.

## 🔗 Ссылки

- **Сайт:** [genopoisk.vercel.app](https://genopoisk.vercel.app)
- **Бот:** [@Genopoiskbot](https://t.me/Genopoiskbot)
- **Канал:** [@genopoisk_news](https://t.me/genopoisk_news)
- **Политика конфиденциальности:** [/privacy.html](https://genopoisk.vercel.app/privacy.html)
