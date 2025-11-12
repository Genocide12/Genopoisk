// API Module for Genopoisk
// Использует переменные окружения для безопасного хранения ключей

class KinopoiskAPI {
    constructor() {
        // Пытаемся получить ключи из переменных окружения (Vercel)
        // Fallback на значения по умолчанию только для разработки
        this.API_KEY = this.getEnvVar('VITE_KINOPOISK_API_KEY') || '33b1e3bd-2643-4ac1-8eb4-6b7392c5e913';
        this.API_BASE = 'https://kinopoiskapiunofficial.tech/api';
        this.PLAYER_HOST = this.getEnvVar('VITE_PLAYER_HOST') || 'kinotut.me';
        this.PLAYER_TOKEN = this.getEnvVar('VITE_PLAYER_TOKEN') || '0926b7296919955c8f9d1559ec54505a';
        
        // Кэш для запросов
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 минут
    }

    getEnvVar(name) {
        // Пытаемся получить переменную окружения различными способами
        if (typeof process !== 'undefined' && process.env && process.env[name]) {
            return process.env[name];
        }
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
            return import.meta.env[name];
        }
        return null;
    }

    getCacheKey(url) {
        return url;
    }

    getFromCache(url) {
        const cacheKey = this.getCacheKey(url);
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        
        return null;
    }

    setCache(url, data) {
        const cacheKey = this.getCacheKey(url);
        this.cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
    }

    async apiGet(url, useCache = true) {
        // Проверяем кэш
        if (useCache) {
            const cached = this.getFromCache(url);
            if (cached) {
                console.log('📦 Loaded from cache:', url);
                return cached;
            }
        }

        try {
            const res = await fetch(url, {
                headers: {
                    'X-API-KEY': this.API_KEY,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            
            const data = await res.json();
            
            // Сохраняем в кэш
            if (useCache) {
                this.setCache(url, data);
            }
            
            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    async getPopular(page = 1) {
        const url = `${this.API_BASE}/v2.2/films/top?type=TOP_100_POPULAR_FILMS&page=${page}`;
        return this.apiGet(url);
    }

    async getTop250(page = 1) {
        const url = `${this.API_BASE}/v2.2/films/top?type=TOP_250_BEST_FILMS&page=${page}`;
        return this.apiGet(url);
    }

    async getNew(page = 1) {
        const currentYear = new Date().getFullYear();
        const url = `${this.API_BASE}/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=${currentYear}&yearTo=${currentYear}&page=${page}`;
        return this.apiGet(url);
    }

    async getRandomFilm() {
        const randomPage = Math.floor(Math.random() * 5) + 1;
        const data = await this.getTop250(randomPage);
        const films = data.items || data.films || [];
        
        if (films.length > 0) {
            return films[Math.floor(Math.random() * films.length)];
        }
        
        return null;
    }

    async searchFilms(query, page = 1) {
        if (!query || query.trim().length === 0) {
            return { items: [], total: 0 };
        }
        
        const url = `${this.API_BASE}/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}&page=${page}`;
        return this.apiGet(url, false); // Не кэшируем поиск
    }

    getPlayerUrl(filmId) {
        // Валидация filmId
        filmId = String(filmId).trim();
        if (!filmId || filmId === 'undefined' || !filmId.match(/^\d+$/)) {
            throw new Error('Invalid filmId');
        }
        
        return `https://api.embess.ws/embed/kp/${filmId}`;
    }

    clearCache() {
        this.cache.clear();
        console.log('🧹 Cache cleared');
    }
}

// Экспорт для использования
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KinopoiskAPI;
}
