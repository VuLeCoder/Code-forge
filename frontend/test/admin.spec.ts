import { expect, test } from "@playwright/test";

const admin = { id: "admin-1", username: "site-admin", email: "admin@example.test", systemRole: "ADMIN", status: "ACTIVE", createdAt: "2026-10-01T00:00:00.000Z" };
const user = { id: "user-1", username: "alice", email: "alice@example.test", systemRole: "USER", status: "ACTIVE", createdAt: "2026-10-02T00:00:00.000Z" };

test("admin can inspect users, repositories and audit, then confirm a restore", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: admin } }));
  let userStatus = "ACTIVE";
  let repositoryStatus = "DELETED";
  await page.route("**/api/v1/admin/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/stats")) return route.fulfill({ json: {
      users: { total: 2, active: 2, locked: 0 }, repositories: { total: 1, active: 0, locked: 0, deleted: 1 },
      pullRequests: { total: 0, open: 0, pendingMerges: 0 },
    } });
    if (url.pathname.endsWith("/users") && method === "GET") return route.fulfill({ json: {
      users: [{ ...user, status: userStatus, lockedAt: userStatus === "LOCKED" ? "2026-10-24T00:00:00.000Z" : null }],
      page: 1, pageSize: 20, total: 1, hasMore: false,
    } });
    if (url.pathname.endsWith(`/users/${user.id}/status`) && method === "PATCH") {
      userStatus = route.request().postDataJSON().status;
      return route.fulfill({ json: { user: { id: user.id, status: userStatus }, changed: true } });
    }
    if (url.pathname.endsWith("/repositories") && method === "GET") return route.fulfill({ json: {
      repositories: [{ id: "repo-1", name: "demo", description: null, visibility: "PRIVATE", status: repositoryStatus,
        defaultBranch: "main", storageGeneration: 1, createdAt: user.createdAt, updatedAt: user.createdAt,
        deletedAt: user.createdAt, purgeAfter: "2026-11-01T00:00:00.000Z", owner: { id: user.id, username: user.username },
        _count: { pullRequests: 1, members: 1 } }], page: 1, pageSize: 20, total: 1, hasMore: false,
    } });
    if (url.pathname.endsWith(`/repositories/repo-1/restore`) && method === "POST") {
      repositoryStatus = "ACTIVE";
      return route.fulfill({ json: { repository: { id: "repo-1", status: repositoryStatus }, sourceMayBeReset: true } });
    }
    if (url.pathname.endsWith("/audit")) return route.fulfill({ json: {
      audit: [
        { id: "audit-1", actorId: admin.id, actor: { id: admin.id, username: admin.username }, action: "ADMIN_REPOSITORY_RESTORED",
          targetId: "repo-1", details: { from: "DELETED", to: "ACTIVE" }, createdAt: user.createdAt },
        { id: "audit-2", actorId: null, actor: null, action: "SYSTEM_ADMIN_CREATED",
          targetId: admin.id, details: { channel: "bootstrap_cli" }, createdAt: user.createdAt },
      ],
      page: 1, pageSize: 20, total: 2, hasMore: false,
    } });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Không tìm thấy API fixture." } } });
  });

  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Người dùng" }).click();
  await expect(page.getByText("alice@example.test")).toBeVisible();
  await page.getByRole("button", { name: "Khóa tài khoản" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("table").getByText("Đã khóa", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Repositories" }).click();
  await expect(page.getByRole("table").getByText("Đã xóa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Khôi phục" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("table").getByText("Hoạt động", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nhật ký" }).click();
  await expect(page.getByText("ADMIN_REPOSITORY_RESTORED")).toBeVisible();
  await expect(page.getByText("Hệ thống (bootstrap CLI)")).toBeVisible();
  await expect(page.getByRole("table").getByText("PRIVATE SOURCE CONTENT", { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("non-admin receives an authorization error and has no admin navigation link", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user } }));
  await page.route("**/api/v1/admin/stats", (route) => route.fulfill({ status: 403, json: {
    error: { code: "FORBIDDEN", message: "Tài khoản hiện tại không có quyền quản trị." },
  } }));
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByText("Tài khoản hiện tại không có quyền quản trị.", { exact: true })).toBeVisible();
});
