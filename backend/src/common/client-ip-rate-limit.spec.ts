import { createHmac } from 'node:crypto';
import { getRateLimitClientIp } from './client-ip-rate-limit';

describe('getRateLimitClientIp', () => {
  const secret = 'test-proxy-secret-that-is-at-least-32-chars';
  const expressIp = '10.0.0.12';
  const sign = (ip: string) => createHmac('sha256', secret).update(ip, 'utf8').digest('hex');
  const request = (headers: Record<string, string | undefined> = {}) => ({ headers, ip: expressIp });

  it('uses a valid signed client IP', () => {
    const ip = '203.0.113.10';
    expect(getRateLimitClientIp(request({ 'x-codeforge-client-ip': ip, 'x-codeforge-client-signature': sign(ip) }), secret)).toBe(ip);
  });

  it('ignores a spoofed IP paired with an invalid signature', () => {
    expect(getRateLimitClientIp(request({ 'x-codeforge-client-ip': '198.51.100.8', 'x-codeforge-client-signature': sign('203.0.113.5') }), secret)).toBe(expressIp);
  });

  it('falls back for malformed IP addresses', () => {
    expect(getRateLimitClientIp(request({ 'x-codeforge-client-ip': 'not-an-ip', 'x-codeforge-client-signature': sign('not-an-ip') }), secret)).toBe(expressIp);
  });

  it('falls back when the signed pair or secret is missing', () => {
    expect(getRateLimitClientIp(request({ 'x-codeforge-client-ip': '203.0.113.10' }), secret)).toBe(expressIp);
    expect(getRateLimitClientIp(request({ 'x-codeforge-client-ip': '203.0.113.10', 'x-codeforge-client-signature': sign('203.0.113.10') }))).toBe(expressIp);
  });
});
