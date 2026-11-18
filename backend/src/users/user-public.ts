import type { SystemRole, User, UserStatus } from '@prisma/client';

export type PublicUser = Pick<User, 'id' | 'username' | 'email' | 'createdAt'> & {
  systemRole: SystemRole;
  status: UserStatus;
  avatarUrl?: string | null;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    systemRole: user.systemRole,
    status: user.status,
    createdAt: user.createdAt,
  };
}
