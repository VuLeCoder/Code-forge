import type { PublicUser } from '../users/user-public';
import type { Request } from 'express';

export type AccessTokenPayload = {
  sub: string;
  sessionId: string;
  type: 'access';
};

export type AuthPrincipal = PublicUser & { sessionId: string };

export type AuthenticatedRequest = Request & {
  cookies?: Record<string, string | undefined>;
  user: AuthPrincipal;
};
