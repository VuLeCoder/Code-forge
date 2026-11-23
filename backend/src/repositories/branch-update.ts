import type { Prisma } from '@prisma/client';
export async function recordBranchUpdates(tx: Prisma.TransactionClient,
  operation: { operationId: string; repositoryId: string; storageGeneration: number; actorId: string },
  before: Record<string, string>, after: Record<string, string>, kind = 'PUSH') {
  const data = Object.entries(after).filter(([ref, sha]) => ref.startsWith('refs/heads/') && before[ref] !== sha)
    .map(([ref, sha]) => ({ operationId: operation.operationId, repositoryId: operation.repositoryId, storageGeneration: operation.storageGeneration, actorId: operation.actorId, branch: ref.slice(11), sha, kind }));
  if (data.length) await tx.branchUpdate.createMany({ data, skipDuplicates: true });
}
