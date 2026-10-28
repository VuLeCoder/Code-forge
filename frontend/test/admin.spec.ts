import { expect, test } from "@playwright/test";

const admin = { id: "admin-1", username: "site-admin", email: "admin@example.test", systemRole: "ADMIN", status: "ACTIVE", createdAt: "2026-10-01T00:00:00.000Z" };
const otherAdmin = { id: "admin-2", username: "another-admin", email: "another-admin@example.test", systemRole: "ADMIN", status: "ACTIVE", createdAt: "2026-10-03T00:00:00.000Z" };
const user = { id: "user-1", username: "alice", email: "alice@example.test", systemRole: "USER", status: "ACTIVE", createdAt: "2026-10-02T00:00:00.000Z" };

test("admin can inspect users, repositories and audit, then confirm a restore", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: admin } }));
  let userStatus = "ACTIVE";
  let repositoryStatus = "LOCKED";
  let journalResolved = false;
  let resolutionBody: unknown;
  await page.route("**/api/v1/admin/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/stats")) return route.fulfill({ json: {
      users: { total: 2, active: 2, locked: 0 }, repositories: { total: 1, active: 0, locked: 0, deleted: 1 },
      pullRequests: { total: 0, open: 0, pendingMerges: 0 },
      gitJournals: { unresolved: 1, pushes: 1, merges: 0 },
    } });
    if (url.pathname.endsWith("/users") && method === "GET") {
      const allUsers = [
        { ...user, status: userStatus, lockedAt: userStatus === "LOCKED" ? "2026-10-24T00:00:00.000Z" : null },
        otherAdmin,
      ];
      const status = url.searchParams.get("status");
      const filteredUsers = status ? allUsers.filter((item) => item.status === status) : allUsers;
      return route.fulfill({ json: {
        users: filteredUsers, page: 1, pageSize: 20, total: filteredUsers.length, hasMore: false,
      } });
    }
    if (url.pathname.endsWith(`/users/${user.id}/status`) && method === "PATCH") {
      userStatus = route.request().postDataJSON().status;
      return route.fulfill({ json: { user: { id: user.id, status: userStatus }, changed: true } });
    }
    if (url.pathname.endsWith("/repositories") && method === "GET") return route.fulfill({ json: {
      repositories: [{ id: "repo-1", name: "demo", description: null, visibility: "PRIVATE", status: repositoryStatus,
        defaultBranch: "main", storageGeneration: 1, createdAt: user.createdAt, updatedAt: user.createdAt,
        deletedAt: repositoryStatus === "DELETED" ? user.createdAt : null, purgeAfter: repositoryStatus === "DELETED" ? "2026-11-01T00:00:00.000Z" : null, owner: { id: user.id, username: user.username },
        _count: { pullRequests: 1, members: 1 } }], page: 1, pageSize: 20, total: 1, hasMore: false,
    } });
    if (url.pathname.endsWith(`/repositories/repo-1/status`) && method === "PATCH") {
      repositoryStatus = route.request().postDataJSON().status;
      return route.fulfill({ json: { repository: { id: "repo-1", status: repositoryStatus }, changed: true } });
    }
    if (url.pathname.endsWith(`/repositories/repo-1/restore`) && method === "POST") {
      repositoryStatus = "ACTIVE";
      return route.fulfill({ json: { repository: { id: "repo-1", status: repositoryStatus }, sourceMayBeReset: true } });
    }
    if (url.pathname.endsWith("/git-journals") && method === "GET") return route.fulfill({ json: {
      journals: journalResolved ? [] : [{ type: "PUSH", operationId: "11111111-1111-4111-8111-111111111111",
        actorId: user.id, actor: { id: user.id, username: user.username }, status: "NEEDS_RECONCILIATION",
        errorCode: "GIT_CHILD_SUCCEEDED", storageGeneration: 1, createdAt: user.createdAt, updatedAt: user.createdAt,
        repository: { id: "repo-1", name: "demo", owner: { id: user.id, username: user.username } } }],
      page: 1, pageSize: 20, total: journalResolved ? 0 : 1, hasMore: false,
    } });
    if (url.pathname.endsWith("/git-journals/PUSH/11111111-1111-4111-8111-111111111111/resolve") && method === "POST") {
      resolutionBody = route.request().postDataJSON();
      journalResolved = true;
      return route.fulfill({ json: { changed: true, journal: { type: "PUSH", status: "COMPLETED" } } });
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
  const adminRow = page.getByRole("row", { name: /another-admin/ });
  await expect(adminRow.getByRole("cell").nth(1)).toHaveText("Admin");
  const aliceRow = page.getByRole("row", { name: /alice/ });
  const lockUserButton = aliceRow.getByRole("button", { name: "Khóa tài khoản" });
  await lockUserButton.click();
  const lockUserDialog = page.getByRole("dialog", { name: "Khóa alice?" });
  await expect(lockUserDialog).toBeVisible();
  const confirmUserAction = lockUserDialog.getByRole("button", { name: "Xác nhận" });
  await expect(confirmUserAction).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lockUserDialog).not.toBeVisible();
  await expect(lockUserButton).toBeFocused();
  await lockUserButton.click();
  await page.getByRole("dialog", { name: "Khóa alice?" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("table").getByText("Đã khóa", { exact: true })).toBeVisible();
  await page.getByLabel("Trạng thái").selectOption("LOCKED");
  await expect(page.getByRole("row", { name: /alice/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /another-admin/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Mở khóa" }).click();
  await page.getByRole("dialog", { name: "Mở khóa alice?" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("row", { name: /alice/ })).toHaveCount(0);
  await page.getByLabel("Trạng thái").selectOption("");
  await expect(page.getByRole("row", { name: /alice/ }).getByText("Hoạt động", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Repositories" }).click();
  await expect(page.getByRole("table").getByText("Đã khóa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mở khóa", exact: true }).click();
  await page.getByRole("dialog", { name: "Mở khóa demo?" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("table").getByText("Hoạt động", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Khóa repository" }).click();
  await page.getByRole("dialog", { name: "Khóa demo?" }).getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("table").getByText("Đã khóa", { exact: true })).toBeVisible();
  repositoryStatus = "DELETED";
  await page.getByRole("button", { name: "Tải lại" }).click();
  await expect(page.getByRole("table").getByText("Đã xóa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Khôi phục" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("table").getByText("Hoạt động", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Đối soát Git" }).click();
  await expect(page.getByText("GIT_CHILD_SUCCEEDED")).toBeVisible();
  await page.getByRole("button", { name: "Kiểm tra bằng chứng" }).click();
  const journalDialog = page.getByRole("dialog", { name: "Đối soát push journal?" });
  await expect(journalDialog).toContainText("không dịch chuyển bất kỳ Git ref nào");
  await journalDialog.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByText("Không có Git journal nào đang chờ đối soát.")).toBeVisible();
  expect(resolutionBody).toEqual({ revision: user.createdAt, reasonCode: "OPERATOR_REVIEW" });

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
