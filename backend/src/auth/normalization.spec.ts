import { normalizeEmail, normalizeUsername } from './normalization';

describe('auth normalization', () => {
  it('normalizes username and email for case-insensitive uniqueness', () => {
    expect(normalizeUsername('  Alice.Dev ')).toBe('alice.dev');
    expect(normalizeEmail('  ALICE@Example.COM ')).toBe('alice@example.com');
  });

  it('normalizes compatible unicode forms', () => {
    expect(normalizeUsername('Ａlice')).toBe('alice');
  });
});
