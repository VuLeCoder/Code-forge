import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

export const CLIENT_IP_HEADER = 'x-codeforge-client-ip';
export const CLIENT_IP_SIGNATURE_HEADER = 'x-codeforge-client-signature';

export interface ClientIpRequest {
  headers?: IncomingHttpHeaders;
  ip?: string;
  socket?: { remoteAddress?: string };
}

function expressIp(request: ClientIpRequest): string {
  if (request.ip && isIP(request.ip)) return request.ip;
  const remoteAddress = request.socket?.remoteAddress;
  return remoteAddress && isIP(remoteAddress) ? remoteAddress : 'unknown';
}

export function getRateLimitClientIp(request: ClientIpRequest, secret?: string): string {
  const fallback = expressIp(request);
  if (!secret || secret.length < 32) return fallback;

  const clientIp = request.headers?.[CLIENT_IP_HEADER];
  const signature = request.headers?.[CLIENT_IP_SIGNATURE_HEADER];
  if (typeof clientIp !== 'string' || isIP(clientIp) === 0 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return fallback;
  }

  const expected = createHmac('sha256', secret).update(clientIp, 'utf8').digest();
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(expected, provided) ? clientIp : fallback;
}
