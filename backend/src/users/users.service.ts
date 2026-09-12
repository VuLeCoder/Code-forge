import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
