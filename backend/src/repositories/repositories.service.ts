import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Repository } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateRepositoryDto, UpdateRepositoryDto } from './repository.dto';
import { RepositoryPolicy } from './repository.policy';
import { GitStorageService } from './git-storage.service';

@Injectable()
export class RepositoriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly policy: RepositoryPolicy,
    private readonly storage: GitStorageService,
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

  private response(repo: Repository & { owner: { username: string } }, userId?: string, storage?: { state: 'READY' | 'EMPTY' | 'RESET'; readme: string | null }) {
    return { repository: {
      id: repo.id, owner: { username: repo.owner.username }, name: repo.name,
      description: repo.description, visibility: repo.visibility, status: repo.status,
      defaultBranch: repo.defaultBranch, createdAt: repo.createdAt, updatedAt: repo.updatedAt,
      permissions: this.policy.permissions(repo, userId),
      ...(storage ? { storageState: storage.state, storageGeneration: repo.storageGeneration, readme: storage.readme } : {}),
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
    let createdKey: string | undefined;
    try { return await this.conflict(() => this.db.$transaction(async (tx) => {
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
      await this.storage.create(repo.storageKey, repo.defaultBranch, dto.initializeReadme ?? false, repo.name);
      createdKey = repo.storageKey;
      const inspected = await this.storage.inspect(repo.storageKey, repo.defaultBranch);
      return this.response(repo, userId, inspected);
    }, { timeout: 30_000 })); }
    catch (error) {
      if (createdKey) await this.storage.remove(createdKey);
      throw error;
    }
  }

  async read(owner: string, name: string, userId?: string, branchQuery?: { ref?: string; path?: string; tree?: boolean; blob?: boolean; image?: boolean; commits?: boolean; sha?: string; page?: string; snapshot?: string }) {
    const repo = await this.load(this.db, owner, name);
    this.policy.assertRead(repo, userId);
    if (branchQuery?.sha !== undefined) this.storage.validateCommitSha(branchQuery.sha);
    if (branchQuery?.snapshot !== undefined) this.storage.validateCommitSha(branchQuery.snapshot);
    if (branchQuery?.commits) this.storage.validateCommitPage(branchQuery.page);
    if (branchQuery?.ref !== undefined) this.storage.validateRef(branchQuery.ref);
    if (branchQuery?.path !== undefined) this.storage.validateSourcePath(branchQuery.path);
    if (branchQuery?.blob && !branchQuery.path) throw new BadRequestException({ error: { code: 'INVALID_PATH', message: 'Cần đường dẫn tới file.' } });
    // Serialize recovery so concurrent readers do not increment generation twice.
    const response = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repositories WHERE id = ${repo.id}::uuid FOR UPDATE`;
      let current = await tx.repository.findUniqueOrThrow({ where: { id: repo.id }, include: { owner: { select: { username: true } } } });
      this.policy.assertRead(current, userId);
      if (!(await this.storage.exists(current.storageKey))) {
        await this.storage.create(current.storageKey, current.defaultBranch, false, current.name);
        current = await tx.repository.update({ where: { id: current.id }, data: { storageGeneration: { increment: 1 } }, include: { owner: { select: { username: true } } } });
      }
      if (branchQuery) {
        if (branchQuery.sha !== undefined) {
          try { return { commit: await this.storage.commit(current.storageKey, branchQuery.sha), storageGeneration: current.storageGeneration }; }
          catch (error) { return { readError: error }; }
        }
        const result = await this.storage.branches(current.storageKey, current.defaultBranch);
        if (branchQuery.commits) {
          try {
            const selected = result.branches.find((branch) => branch.name === (branchQuery.ref ?? current.defaultBranch));
            if (!selected && (branchQuery.ref !== undefined || result.branches.length)) {
              throw new NotFoundException({ error: { code: 'REF_NOT_FOUND', message: 'Branch không tồn tại hoặc đã bị xóa.' } });
            }
            if (!selected && branchQuery.snapshot !== undefined) {
              throw new NotFoundException({ error: { code: 'COMMIT_NOT_FOUND', message: 'Lịch sử đã thay đổi hoặc storage đã được khởi tạo lại.' } });
            }
            const page = this.storage.validateCommitPage(branchQuery.page);
            return { ...(selected ? await this.storage.commits(current.storageKey, selected.commitSha, page, branchQuery.snapshot)
              : { commits: [], page, pageSize: 20, hasMore: false, snapshot: null }),
              ref: selected?.name ?? null, storageState: selected ? 'READY' : current.storageGeneration > 0 ? 'RESET' : 'EMPTY', storageGeneration: current.storageGeneration };
          } catch (error) { return { readError: error }; }
        }
        if (branchQuery.tree || branchQuery.blob) {
          // Return errors until recovery commits: filesystem creation cannot roll back with SQL.
          try {
            const selected = result.branches.find((branch) => branch.name === (branchQuery.ref ?? current.defaultBranch));
            const path = branchQuery.path ?? '';
            if (!selected && (branchQuery.ref !== undefined || result.branches.length)) {
              throw new NotFoundException({ error: { code: 'REF_NOT_FOUND', message: 'Branch không tồn tại hoặc đã bị xóa.' } });
            }
            if (!selected && path) throw new NotFoundException({ error: { code: 'PATH_NOT_FOUND', message: 'Đường dẫn không tồn tại trên branch này.' } });
            if (branchQuery.blob && selected) {
              return { ...await this.storage.blob(current.storageKey, selected.commitSha, path, branchQuery.image), ref: selected.name, storageState: 'READY', storageGeneration: current.storageGeneration };
            }
            const tree = selected ? await this.storage.tree(current.storageKey, selected.commitSha, path) : { path, commitSha: null, entries: [] };
            return { ...tree, ref: selected?.name ?? null, storageState: selected ? 'READY' : current.storageGeneration > 0 ? 'RESET' : 'EMPTY', storageGeneration: current.storageGeneration };
          } catch (error) { return { readError: error }; }
        }
        return { ...result,
          storageState: result.branches.length ? 'READY' : current.storageGeneration > 0 ? 'RESET' : 'EMPTY',
          storageGeneration: current.storageGeneration };
      }
      const inspected = await this.storage.inspect(current.storageKey, current.defaultBranch);
      return this.response(current, userId, { ...inspected, state: current.storageGeneration > 0 && inspected.state === 'EMPTY' ? 'RESET' : inspected.state });
    }, { timeout: 30_000 });
    if ('readError' in response) throw response.readError;
    // Commit recovery before reporting a missing requested ref; Git creation cannot roll back with SQL.
    if ('branches' in response && branchQuery?.ref !== undefined) {
      const selectedBranch = response.branches.find((branch) => branch.name === branchQuery.ref);
      if (!selectedBranch) throw new NotFoundException({ error: { code: 'REF_NOT_FOUND', message: 'Branch không tồn tại hoặc đã bị xóa.' } });
      return { ...response, selectedBranch };
    }
    return response;
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

  async preparePublicGit(owner: string, name: string) {
    const repo = await this.load(this.db, owner, name);
    this.policy.assertRead(repo); // M3.6 is anonymous public transport, including for session owners.
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repositories WHERE id = ${repo.id}::uuid FOR UPDATE`;
      const current = await tx.repository.findUnique({ where: { id: repo.id } });
      this.policy.assertRead(current);
      if (!(await this.storage.exists(current.storageKey))) {
        await this.storage.create(current.storageKey, current.defaultBranch, false, current.name);
        await tx.repository.update({ where: { id: current.id }, data: { storageGeneration: { increment: 1 } } });
      }
      return current.storageKey;
    }, { timeout: 30_000 });
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

  async listDeleted(userId: string) {
    const rows = await this.db.repository.findMany({
      where: { ownerId: userId, status: 'DELETED', purgeAfter: { gt: new Date() } },
      include: { owner: { select: { username: true } } }, orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
    });
    return { repositories: rows.map((repo) => ({
      ...this.response(repo, userId).repository, deletedAt: repo.deletedAt, purgeAfter: repo.purgeAfter,
    })) };
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


  async restore(owner: string, name: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      await this.activeOwner(tx, userId);
      await tx.$queryRaw`SELECT r.id FROM repositories r JOIN users u ON u.id = r.owner_id
        WHERE u.normalized_username = ${owner.toLowerCase()} AND r.normalized_name = ${name.toLowerCase()} FOR UPDATE OF r`;
      const repo = await this.load(tx, owner, name);
      if (!repo || repo.ownerId !== userId || repo.status !== 'DELETED') {
        throw new NotFoundException({ error: { code: 'REPOSITORY_NOT_FOUND', message: 'Không tìm thấy repository.', details: {} } });
      }
      if (!repo.purgeAfter || repo.purgeAfter <= new Date()) {
        throw new ConflictException({ error: { code: 'RESTORE_EXPIRED', message: 'Đã hết thời hạn khôi phục repository.', details: {} } });
      }
      const updated = await tx.repository.update({
        where: { id: repo.id }, data: { status: 'ACTIVE', deletedAt: null, purgeAfter: null },
        include: { owner: { select: { username: true } } },
      });
      return this.response(updated, userId);
    });
  }
}
