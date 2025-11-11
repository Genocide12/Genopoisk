// Configuration file for API keys
// DO NOT commit real API keys to GitHub!
// Use environment variables in production

const CONFIG = {
    KINOPOISK_API: {
        KEY: process.env.KINOPOISK_API_KEY || '26d2222a-3f07-492d-a17e-80fdc91e2fe9',
        BASE_URL: 'https://kinopoiskapiunofficial.tech/api'
    },
    PLAYER: {
        HOST: 'kinotut.me',
        TOKEN: process.env.PLAYER_TOKEN || '0926b7296919955c8f9d1559ec54505a',
        SHARING: false
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
