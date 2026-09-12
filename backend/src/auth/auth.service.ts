import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type Session, type User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';
import { toPublicUser, type PublicUser } from '../users/user-public';
import { AuthError } from './auth-error';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { normalizeEmail, normalizeUsername } from './normalization';

type AuthResult = { user: PublicUser; accessToken: string; refreshToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const rawToken = this.generateRefreshToken();
    let created: { user: User; session: Session };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: dto.username,
            normalizedUsername: normalizeUsername(dto.username),
            email: dto.email,
            normalizedEmail: normalizeEmail(dto.email),
            passwordHash,
          },
        });
        const session = await tx.session.create({
          data: {
            userId: user.id,
            familyId: randomUUID(),
            tokenHash: this.hashToken(rawToken),
            expiresAt: this.refreshExpiry(),
          },
        });
        return { user, session };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AuthError(HttpStatus.CONFLICT, 'ACCOUNT_ALREADY_EXISTS', 'Username hoặc email đã được sử dụng.');
      }
      throw error;
    }
    return this.result(created.user, created.session, rawToken);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByLogin(normalizeEmail(dto.login));
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new AuthError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Thông tin đăng nhập không chính xác.');
    }
    this.assertActive(user);
    return this.createSession(user);
  }

  async refresh(rawToken: string | undefined): Promise<AuthResult> {
    if (!rawToken) this.invalidRefresh();
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!existing) this.invalidRefresh();
    if (existing.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.invalidRefresh();
    }
    if (existing.expiresAt <= new Date()) this.invalidRefresh();
    this.assertActive(existing.user);

    const nextRawToken = this.generateRefreshToken();
    const now = new Date();
    const next = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now, lastUsedAt: now },
      });
      if (revoked.count !== 1) return null;
      return tx.session.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          tokenHash: this.hashToken(nextRawToken),
          expiresAt: this.refreshExpiry(),
        },
      });
    });
    if (!next) {
      await this.prisma.session.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.invalidRefresh();
    }
    return this.result(existing.user, next, nextRawToken);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(user: User): Promise<AuthResult> {
    const rawToken = this.generateRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: this.hashToken(rawToken),
        expiresAt: this.refreshExpiry(),
      },
    });
    return this.result(user, session, rawToken);
  }

  private async result(user: User, session: Session, refreshToken: string): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, sessionId: session.id, type: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS'),
      },
    );
    return { user: toPublicUser(user), accessToken, refreshToken };
  }

  private assertActive(user: User): void {
    if (user.status === 'LOCKED') {
      throw new AuthError(HttpStatus.FORBIDDEN, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa.');
    }
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiry(): Date {
    const days = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    return new Date(Date.now() + days * 86_400_000);
  }

  private invalidRefresh(): never {
    throw new AuthError(HttpStatus.UNAUTHORIZED, 'REFRESH_TOKEN_INVALID', 'Refresh token không hợp lệ hoặc đã hết hạn.');
  }
}
