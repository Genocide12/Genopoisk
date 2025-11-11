// API Configuration
// ВАЖНО: Добавьте config.js в .gitignore!
// Для продакшена используйте переменные окружения Vercel

const CONFIG = {
    API_KEY: '26d2222a-3f07-492d-a17e-80fdc91e2fe9',
    API_BASE: 'https://kinopoiskapiunofficial.tech/api',
    PLAYER: {
        host: 'kinotut.me',
        token: '0926b7296919955c8f9d1559ec54505a',
        sharing: false
    }
};

// Экспорт для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}