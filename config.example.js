// API Configuration Template
// Скопируйте этот файл как config.js и укажите свои API ключи

const CONFIG = {
    API_KEY: 'ваш_api_ключ_кинопоиска',
    API_BASE: 'https://kinopoiskapiunofficial.tech/api',
    PLAYER: {
        host: 'kinotut.me',
        token: 'ваш_токен_плеера',
        sharing: false
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}