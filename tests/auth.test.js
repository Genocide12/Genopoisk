import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth module
const mockVerifyInitData = vi.fn();
const mockParseSessionCookie = vi.fn();

vi.mock('../api/_lib/supabase.js', () => ({
  getUser: vi.fn(),
  getUserByOidcSub: vi.fn(),
  getAllUsers: vi.fn()
}));

// Load the auth module
const { verifyInitData, extractVerifiedUser } = await import('../api/_lib/auth.js');

describe('verifyInitData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TG_BOT_TOKEN = 'test-bot-token';
  });

  it('returns null for empty initData', () => {
    expect(verifyInitData('', 'token')).toBe(null);
    expect(verifyInitData(null, 'token')).toBe(null);
  });

  it('returns null for empty botToken', () => {
    expect(verifyInitData('initData', '')).toBe(null);
    expect(verifyInitData('initData', null)).toBe(null);
  });

  it('returns null for invalid initData (no hash)', () => {
    const result = verifyInitData('user=test&query=hello', 'token');
    expect(result).toBe(null);
  });

  it('returns null for tampered initData (wrong hash)', () => {
    const result = verifyInitData(
      'user=%7B%22id%22%3A123%7D&query=hello&hash=invalidhash123',
      'token'
    );
    expect(result).toBe(null);
  });
});

describe('extractVerifiedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TG_BOT_TOKEN = 'test-bot-token';
    process.env.SESSION_SECRET = 'test-secret';
  });

  it('returns empty result for empty body', () => {
    const result = extractVerifiedUser({}, {});
    expect(result.telegramId).toBe(null);
    expect(result.source).toBe(null);
  });

  it('accepts non-web_ userId as browser source (read-only)', () => {
    const result = extractVerifiedUser({ userId: '854765520' }, {});
    expect(result.telegramId).toBe('854765520');
    expect(result.source).toBe('browser');
  });

  it('accepts web_* guest userId', () => {
    const result = extractVerifiedUser({ userId: 'web_abc123' }, {});
    expect(result.telegramId).toBe('web_abc123');
    expect(result.source).toBe('guest');
  });

  it('returns invalid_initdata source for bad initData', () => {
    const result = extractVerifiedUser({ initData: 'invalid' }, {});
    expect(result.source).toBe('invalid_initdata');
    expect(result.telegramId).toBe(null);
  });

  it('returns empty result when no identifiers provided', () => {
    const result = extractVerifiedUser({ type: 'page_views' }, {});
    expect(result.telegramId).toBe(null);
    expect(result.source).toBe(null);
  });
});
