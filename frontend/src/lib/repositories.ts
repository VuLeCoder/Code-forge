export type RepositorySummary = {
  id: string;
  owner: { username: string };
  name: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  updatedAt: string;
  permissions: { canRead: boolean; canManage: boolean };
};

export function repositoryPath(repo: RepositorySummary) {
  return `/${encodeURIComponent(repo.owner.username)}/${encodeURIComponent(repo.name)}`;
}
