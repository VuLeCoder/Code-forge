import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

const { withBackendClientIp } = await import(new URL('./backend-client-ip.ts', import.meta.url).href);

test('signs a single client IP into a narrow backend header set', () => {
  const previousSecret = process.env.RATE_LIMIT_PROXY_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  const secret = 'test-proxy-secret-that-is-at-least-32-chars';
  env.RATE_LIMIT_PROXY_SECRET = secret;
  env.NODE_ENV = 'test';

  try {
    // Next's HeadersAdapter exposes both `.get()` and an own `.headers` property.
    const incoming = Object.assign(new Headers({
      'x-forwarded-for': '203.0.113.42',
      cookie: 'session=must-not-forward',
    }), { headers: new Headers() });
    const headers = withBackendClientIp(incoming);
    const signature = createHmac('sha256', secret).update('203.0.113.42').digest('hex');

    assert.equal(headers.get('x-codeforge-client-ip'), '203.0.113.42');
    assert.equal(headers.get('x-codeforge-client-signature'), signature);
    assert.equal(headers.get('cookie'), null);
  } finally {
    if (previousSecret === undefined) delete env.RATE_LIMIT_PROXY_SECRET;
    else env.RATE_LIMIT_PROXY_SECRET = previousSecret;
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
  }
});

test('signs request headers and declines an ambiguous forwarded chain', () => {
  const previousSecret = process.env.RATE_LIMIT_PROXY_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  env.RATE_LIMIT_PROXY_SECRET = 'test-proxy-secret-that-is-at-least-32-chars';
  env.NODE_ENV = 'test';

  try {
    const signed = withBackendClientIp(new Request('https://example.test', {
      headers: { 'x-forwarded-for': '203.0.113.43' },
    }));
    assert.equal(signed.get('x-codeforge-client-ip'), '203.0.113.43');

    const ambiguous = withBackendClientIp(new Headers({
      'x-forwarded-for': '203.0.113.43, 10.0.0.1',
    }));
    assert.equal(ambiguous.get('x-codeforge-client-ip'), null);
    assert.equal(ambiguous.get('x-codeforge-client-signature'), null);
  } finally {
    if (previousSecret === undefined) delete env.RATE_LIMIT_PROXY_SECRET;
    else env.RATE_LIMIT_PROXY_SECRET = previousSecret;
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
  }
});
