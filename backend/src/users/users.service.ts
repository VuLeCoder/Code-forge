import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizeUsername } from '../auth/normalization';
import type { User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async publicProfile(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { normalizedUsername: normalizeUsername(username) },
      select: { username: true, createdAt: true },
    });
    if (!user) throw new NotFoundException({ error: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng.' } });
    return { user, repositories: [], repositoriesAvailable: false };
  }

  findByLogin(normalizedLogin: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ normalizedUsername: normalizedLogin }, { normalizedEmail: normalizedLogin }],
      },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: {
    username: string;
    normalizedUsername: string;
    email: string;
    normalizedEmail: string;
    passwordHash: string;
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }
}
