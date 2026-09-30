import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { CreateTokenDto } from './token.dto';

const metadata = { id: true, name: true, tokenPrefix: true, scopes: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true } as const;
const digest = (secret: string) => createHash('sha256').update(secret).digest();

@Injectable()
export class TokensService {
  constructor(private readonly db: PrismaService) {}

  async list(userId: string) {
    return { tokens: await this.db.personalAccessToken.findMany({ where: { userId }, select: metadata, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) };
  }

  async create(userId: string, dto: CreateTokenDto) {
    const expiresAt = new Date(dto.expiresAt);
    const now = Date.now();
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now || expiresAt.getTime() > now + 365 * 86400000) {
      throw new BadRequestException({ error: { code: 'TOKEN_EXPIRY_INVALID', message: 'Ngày hết hạn phải trong tương lai, tối đa 365 ngày.' } });
    }
    return this.db.$transaction(async (tx) => {
      const users = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (users[0]?.status !== 'ACTIVE') throw new ForbiddenException();
      if (await tx.personalAccessToken.count({ where: { userId } }) >= 100) {
        throw new ForbiddenException({ error: { code: 'TOKEN_LIMIT', message: 'Đã đạt giới hạn 100 token cho tài khoản.' } });
      }
      const tokenPrefix = randomBytes(8).toString('hex');
      const secret = `cfg_${tokenPrefix}_${randomBytes(32).toString('hex')}`;
      const token = await tx.personalAccessToken.create({ data: { userId, name: dto.name, scopes: dto.scopes, expiresAt, tokenPrefix, tokenHash: digest(secret).toString('hex') }, select: metadata });
      await tx.auditLog.create({ data: { actorId: userId, action: 'TOKEN_CREATED', targetId: token.id } });
      return { token, secret };
    });
  }

  async revoke(userId: string, id: string) {
    await this.db.$transaction(async (tx) => {
      const token = await tx.personalAccessToken.findFirst({ where: { id, userId } });
      if (!token) throw new NotFoundException();
      const changed = await tx.personalAccessToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (changed.count) await tx.auditLog.create({ data: { actorId: userId, action: 'TOKEN_REVOKED', targetId: id } });
    });
  }

  async authenticate(authorization: string): Promise<string> {
    const invalid = () => new UnauthorizedException();
    if (authorization.length > 1024 || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(authorization)) throw invalid();
    const encoded = authorization.slice(6);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw invalid();
    const credentials = bytes.toString('utf8');
    const split = credentials.indexOf(':');
    const username = credentials.slice(0, split);
    const secret = credentials.slice(split + 1);
    if (split < 0 || !/^[a-z0-9][a-z0-9._-]{1,37}[a-z0-9]$/i.test(username)) throw invalid();
    const match = /^cfg_([a-f0-9]{16})_[a-f0-9]{64}$/.exec(secret);
    if (!match) throw invalid();
    const token = await this.db.personalAccessToken.findUnique({ where: { tokenPrefix: match[1] }, include: { user: true } });
    const expected = token ? Buffer.from(token.tokenHash, 'hex') : Buffer.alloc(32);
    const matches = expected.length === 32 && timingSafeEqual(digest(secret), expected);
    if (!matches || !token || token.user.normalizedUsername !== username.toLowerCase() || token.user.status !== 'ACTIVE' || token.revokedAt || token.expiresAt <= new Date() || !token.scopes.includes('repo:read')) throw invalid();
    // Re-check expiry/revocation when recording usage; no authentication cache.
    const used = await this.db.personalAccessToken.updateMany({ where: { id: token.id, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } }, data: { lastUsedAt: new Date() } });
    if (!used.count) throw invalid();
    return token.userId;
  }
}
