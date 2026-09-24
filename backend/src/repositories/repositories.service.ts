import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Repository } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateRepositoryDto, UpdateRepositoryDto } from './repository.dto';
import { RepositoryPolicy } from './repository.policy';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly policy: RepositoryPolicy,
  ) {}

  private async activeOwner(tx: Prisma.TransactionClient, userId: string) {
    // Serialize creates per owner, so concurrent requests cannot overrun quota.
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE
    `;
    if (rows[0]?.status !== 'ACTIVE') {
      throw new ForbiddenException({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Tài khoản không khả dụng.', details: {} } });
    }
  }

  private async load(tx: Prisma.TransactionClient, owner: string, name: string) {
    return tx.repository.findFirst({
      where: { normalizedName: name.toLowerCase(), owner: { normalizedUsername: owner.toLowerCase() } },
      include: { owner: { select: { username: true } } },
    });
  }

  private response(repo: Repository & { owner: { username: string } }, userId?: string) {
    return { repository: {
      id: repo.id, owner: { username: repo.owner.username }, name: repo.name,
      description: repo.description, visibility: repo.visibility, status: repo.status,
      defaultBranch: repo.defaultBranch, createdAt: repo.createdAt, updatedAt: repo.updatedAt,
      permissions: this.policy.permissions(repo, userId),
    } };
  }

  private async conflict<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: {
          code: 'REPOSITORY_NAME_TAKEN', message: 'Tên repository đã được sử dụng, kể cả repository đang chờ xóa vĩnh viễn.', details: {},
        } });
      }
      throw error;
    }
  }

  async create(userId: string, dto: CreateRepositoryDto) {
    return this.conflict(() => this.db.$transaction(async (tx) => {
      await this.activeOwner(tx, userId);
      const count = await tx.repository.count({ where: { ownerId: userId } });
      if (count >= this.config.getOrThrow<number>('MAX_REPOSITORIES_PER_USER')) {
        throw new ForbiddenException({ error: { code: 'REPOSITORY_QUOTA_EXCEEDED', message: 'Đã đạt giới hạn số repository.', details: {} } });
      }
      const id = randomUUID();
      const repo = await tx.repository.create({
        data: { id, ownerId: userId, name: dto.name, normalizedName: dto.name.toLowerCase(),
          description: dto.description, visibility: dto.visibility, storageKey: `${id}.git` },
        include: { owner: { select: { username: true } } },
      });
      return this.response(repo, userId);
    }));
  }

  async read(owner: string, name: string, userId?: string) {
    const repo = await this.load(this.db, owner, name);
    this.policy.assertRead(repo, userId);
    return this.response(repo, userId);
  }

  async listPublic(search = '', page = 1) {
    const where: Prisma.RepositoryWhereInput = {
      status: 'ACTIVE', deletedAt: null, visibility: 'PUBLIC',
      ...(search ? { OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { owner: { username: { contains: search, mode: 'insensitive' } } },
      ] } : {}),
    };
    const rows = await this.db.repository.findMany({ where, include: { owner: { select: { username: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 });
    return { repositories: rows.slice(0, 20).map((repo) => this.response(repo).repository), hasMore: rows.length > 20, page };
  }

  async listForOwner(ownerId: string, viewerId?: string) {
    const rows = await this.db.repository.findMany({
      where: { ownerId, status: 'ACTIVE', deletedAt: null,
        ...(viewerId === ownerId ? {} : { visibility: 'PUBLIC' }) },
      include: { owner: { select: { username: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((repo) => this.response(repo, viewerId).repository);
  }

  async listByUsername(username: string, viewerId?: string) {
    const owner = await this.db.user.findUnique({ where: { normalizedUsername: username.toLowerCase() }, select: { id: true } });
    if (!owner) throw new NotFoundException({ error: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng.' } });
    return { repositories: await this.listForOwner(owner.id, viewerId) };
  }

  async update(owner: string, name: string, userId: string, dto: UpdateRepositoryDto) {
    if (dto.name === undefined && dto.description === undefined && dto.visibility === undefined) {
      throw new BadRequestException({ error: { code: 'EMPTY_UPDATE', message: 'Cần ít nhất một trường để cập nhật.', details: {} } });
    }
    return this.conflict(() => this.db.$transaction(async (tx) => {
      await this.activeOwner(tx, userId);
      const repo = await this.load(tx, owner, name);
      this.policy.assertManage(repo, userId);
      const updated = await tx.repository.update({
        where: { id: repo.id },
        data: { name: dto.name, normalizedName: dto.name?.toLowerCase(), description: dto.description, visibility: dto.visibility },
        include: { owner: { select: { username: true } } },
      });
      return this.response(updated, userId);
    }));
  }

  async remove(owner: string, name: string, userId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await this.activeOwner(tx, userId);
      const repo = await this.load(tx, owner, name);
      this.policy.assertManage(repo, userId);
      const deletedAt = new Date();
      const purgeAfter = new Date(deletedAt.getTime() + this.config.getOrThrow<number>('SOFT_DELETE_RETENTION_DAYS') * 86_400_000);
      await tx.repository.update({ where: { id: repo.id }, data: { status: 'DELETED', deletedAt, purgeAfter } });
    });
  }
}
