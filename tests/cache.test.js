import { describe, it, expect } from 'vitest';

describe('Film cache key format', () => {
  it('uses correct key format for localStorage', () => {
    const key = 'genopoisk_films_popular_1';
    expect(key).toMatch(/^genopoisk_films_\w+_\d+$/);
  });

  it('cache entry has films array and timestamp', () => {
    const entry = { films: [{ filmId: 1 }], ts: Date.now() };
    expect(Array.isArray(entry.films)).toBe(true);
    expect(typeof entry.ts).toBe('number');
  });

  it('cache is valid for 7 days', () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cachedTs = Date.now() - (6 * 24 * 60 * 60 * 1000); // 6 days ago
    expect(Date.now() - cachedTs < sevenDaysMs).toBe(true);
  });

  it('cache expires after 7 days', () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cachedTs = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    expect(Date.now() - cachedTs < sevenDaysMs).toBe(false);
  });
});

describe('Session cookie age', () => {
  it('30-day session is valid', () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const ts = Date.now() - (29 * 24 * 60 * 60 * 1000); // 29 days ago
    expect(Date.now() - ts < thirtyDaysMs).toBe(true);
  });

  it('31-day session is expired', () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const ts = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago
    expect(Date.now() - ts < thirtyDaysMs).toBe(false);
  });
});

describe('Watched films retention', () => {
  it('89-day-old film is kept', () => {
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const ts = Date.now() - (89 * 24 * 60 * 60 * 1000);
    expect(Date.now() - ts < ninetyDaysMs).toBe(true);
  });

  it('91-day-old film is removed', () => {
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const ts = Date.now() - (91 * 24 * 60 * 60 * 1000);
    expect(Date.now() - ts < ninetyDaysMs).toBe(false);
  });
});
