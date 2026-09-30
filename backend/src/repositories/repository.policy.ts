import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Repository, RepositoryMember } from '@prisma/client';
type ReadableRepository = Repository & { members?: Pick<RepositoryMember, 'userId' | 'role'>[] };

@Injectable()
export class RepositoryPolicy {
  permissions(repo: ReadableRepository, userId?: string) {
    const active = repo.status === 'ACTIVE' && repo.deletedAt === null;
    const owner = repo.ownerId === userId;
    return {
      canRead: active && (repo.visibility === 'PUBLIC' || owner || !!repo.members?.some((member) => member.userId === userId && (member.role === 'READ' || member.role === 'WRITE'))),
      canManage: active && owner,
    };
  }

  assertRead(repo: ReadableRepository | null, userId?: string): asserts repo is ReadableRepository {
    if (!repo || !this.permissions(repo, userId).canRead) {
      throw new NotFoundException({ error: { code: 'REPOSITORY_NOT_FOUND', message: 'Không tìm thấy repository.', details: {} } });
    }
  }

  assertManage(repo: Repository | null, userId: string): asserts repo is Repository {
    this.assertRead(repo, userId);
    if (!this.permissions(repo, userId).canManage) {
      throw new ForbiddenException({ error: { code: 'REPOSITORY_FORBIDDEN', message: 'Chỉ owner được quản lý repository.', details: {} } });
    }
  }
}
