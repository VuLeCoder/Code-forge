import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

const CLIENT_IP_HEADER = 'x-codeforge-client-ip';
const CLIENT_IP_SIGNATURE_HEADER = 'x-codeforge-client-signature';

type ClientIpHeaders = Pick<Headers, 'get'>;

export function withBackendClientIp(request: Pick<Request, 'headers'> | ClientIpHeaders, source?: HeadersInit): Headers {
  const headers = new Headers(source);
  const secret = process.env.RATE_LIMIT_PROXY_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Backend proxy signing is not configured.');
    return headers;
  }
  if (secret.length < 32) throw new Error('Backend proxy signing is not configured.');

  // Vercel supplies this header at the edge. Do not pick an element from a chain:
  // an ambiguous value must fall back to the backend's Express peer address.
  const requestHeaders = typeof (request as ClientIpHeaders).get === 'function'
    ? request as ClientIpHeaders
    : (request as Pick<Request, 'headers'>).headers;
  const clientIp = requestHeaders.get('x-forwarded-for');
  if (!clientIp || clientIp.includes(',') || clientIp.trim() !== clientIp || isIP(clientIp) === 0) return headers;

  const signature = createHmac('sha256', secret).update(clientIp, 'utf8').digest('hex');
  headers.set(CLIENT_IP_HEADER, clientIp);
  headers.set(CLIENT_IP_SIGNATURE_HEADER, signature);
  return headers;
}
