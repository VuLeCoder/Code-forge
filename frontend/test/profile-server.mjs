import { createServer } from "node:http";

// Public-profile fixture for Next server rendering; auth is mocked per browser test.
let offlineRequests = 0;
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/health") return response.end('{}');
  if (request.url?.startsWith('/api/v1/repos/alice/hello-world/image?')) {
    const query = new URL(request.url, 'http://fixture').searchParams;
    if (query.getAll('path').length !== 1 || query.getAll('ref').length > 1) {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: { code: 'INVALID_PATH' } }));
    }
    if (query.get('path') !== 'logo.png') { response.statusCode = 404; return response.end('{}'); }
    return response.end(JSON.stringify({ kind: 'image', mime: 'image/png', content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' }));
  }
  if (request.url?.startsWith("/api/v1/repos/alice/hello-world/blob?")) {
    const query = new URL(request.url, 'http://fixture').searchParams;
    const path = query.get('path');
    if (!path || query.getAll('path').length > 1 || query.getAll('ref').length > 1) {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: { code: 'INVALID_PATH' } }));
    }
    if (path === 'missing') {
      response.statusCode = 404;
      return response.end(JSON.stringify({ error: { code: 'PATH_NOT_FOUND' } }));
    }
    const kind = path === 'binary' ? 'binary' : path === 'large' ? 'large' : 'text';
    const content = kind !== 'text' ? null : path === 'empty' ? '' : `<script>window.sourceExecuted = true</script>\n${query.get('ref') ?? 'main'}\n${'long line '.repeat(100)}\n`;
    return response.end(JSON.stringify({ path, kind, content, size: path === 'large' ? 1048577 : 1024,
      truncated: path === 'truncated', objectSha: 'b'.repeat(40), commitSha: 'a'.repeat(40) }));
  }
  if (request.url?.startsWith("/api/v1/repos/alice/hello-world/tree?")) {
    const params = new URL(request.url, "http://localhost").searchParams;
    const path = params.get("path") ?? "";
    if (params.getAll("path").length > 1) {
      response.statusCode = 400;
      return response.end(JSON.stringify({ error: { code: "INVALID_PATH" } }));
    }
    if (path && path !== "src # ü" && path !== "src # ü/nested") {
      response.statusCode = 404;
      return response.end(JSON.stringify({ error: { code: "PATH_NOT_FOUND" } }));
    }
    const entries = path === "src # ü/nested" ? [] : path ? [
      { name: "nested", path: `${path}/nested`, type: "directory", navigable: true },
      { name: "hello & ü.ts", path: `${path}/hello & ü.ts`, type: "file", navigable: true },
    ] : [
      { name: "src # ü", path: "src # ü", type: "directory", navigable: true },
      { name: "README.md", path: "README.md", type: "file", navigable: true },
      { name: "link", path: "link", type: "symlink", navigable: false },
    ];
    return response.end(JSON.stringify({ entries, path, ref: params.get("ref"), storageState: "READY", commitSha: "a".repeat(40) }));
  }
  if (request.url === "/api/v1/repos/alice/hello-world/branches") {
    return response.end(JSON.stringify({ branches: [], defaultBranch: 'main', selectedBranch: null, storageState: 'EMPTY', storageGeneration: 0 }));
  }
  if (request.url?.startsWith("/api/v1/repositories?")) {
    const query = new URL(request.url, "http://localhost").searchParams.get("q") ?? "";
    const repository = { id: "public-repo", owner: { username: "alice" }, name: "hello-world", description: "Repository thử nghiệm", visibility: "PUBLIC", updatedAt: "2026-09-01T00:00:00.000Z", permissions: { canRead: true, canManage: false } };
    return response.end(JSON.stringify({ repositories: query && !"hello-world alice".includes(query) ? [] : [repository], hasMore: false, page: 1 }));
  }
  if (request.url === "/api/v1/users/alice") {
    return response.end(JSON.stringify({ user: { username: "alice", createdAt: "2026-09-01T00:00:00.000Z" }, repositories: [{ id: "public-repo", owner: { username: "alice" }, name: "hello-world", description: "Repository thử nghiệm", visibility: "PUBLIC" }], repositoriesAvailable: true }));
  }
  if (request.url === "/api/v1/repos/alice/hello-world") {
    return response.end(JSON.stringify({ repository: { id: "public-repo", owner: { username: "alice" }, name: "hello-world", description: "Repository thử nghiệm", visibility: "PUBLIC", status: "ACTIVE", defaultBranch: "main", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", permissions: { canRead: true, canManage: false } } }));
  }
  if (request.url === "/api/v1/users/offline" && offlineRequests++ > 0) {
    return response.end(JSON.stringify({ user: { username: "offline", createdAt: "2026-09-01T00:00:00.000Z" }, repositories: [], repositoriesAvailable: false }));
  }
  response.statusCode = request.url === "/api/v1/users/offline" ? 503 : 404;
  response.end('{}');
});
server.listen(4111, '127.0.0.1');
process.on('SIGTERM', () => server.close());
