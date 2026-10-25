import { expect, test } from "@playwright/test";

const admin = { id: "admin-1", username: "site-admin", email: "admin@example.test", systemRole: "ADMIN", status: "ACTIVE", createdAt: "2026-10-01T00:00:00.000Z" };
const user = { id: "user-1", username: "alice", email: "alice@example.test", systemRole: "USER", status: "ACTIVE", lockedAt: null, createdAt: "2026-10-02T00:00:00.000Z" };
const secondUser = { id: "user-2", username: "bob", email: "bob@example.test", systemRole: "USER", status: "ACTIVE", lockedAt: null, createdAt: "2026-10-03T00:00:00.000Z" };
const repo = {
  id: "repo-1", name: "code-forge", description: "Source hosting MVP", visibility: "PRIVATE", status: "ACTIVE",
  defaultBranch: "main", storageGeneration: 1, createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
  deletedAt: null, purgeAfter: null, owner: { id: user.id, username: user.username },
  _count: { pullRequests: 2, members: 3 },
};
const auditEntry = {
  id: "audit-1", actorId: admin.id, actor: { id: admin.id, username: admin.username }, action: "ADMIN_USER_LOCKED",
  targetId: user.id, details: { previousStatus: "ACTIVE", nextStatus: "LOCKED" }, createdAt: "2026-10-04T00:00:00.000Z",
};

for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "narrow", width: 375, height: 812 }]) {
  test(`admin controls support keyboard navigation and dialog focus return at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: admin } }));
    await page.route("**/api/v1/admin/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/stats")) return route.fulfill({ json: {
        users: { total: 2, active: 2, locked: 0 }, repositories: { total: 1, active: 1, locked: 0, deleted: 0 },
        pullRequests: { total: 2, open: 2, pendingMerges: 0 },
      } });
      if (pathname.endsWith("/users")) return route.fulfill({ json: {
        users: [user, secondUser], page: 1, pageSize: 20, total: 2, hasMore: false,
      } });
      if (pathname.endsWith("/repositories")) return route.fulfill({ json: {
        repositories: [repo], page: 1, pageSize: 20, total: 1, hasMore: false,
      } });
      if (pathname.endsWith("/audit")) return route.fulfill({ json: {
        audit: [auditEntry], page: 1, pageSize: 20, total: 1, hasMore: false,
      } });
      return route.fulfill({ status: 204 });
    });

    await page.goto("/admin");
    const tabs = page.getByRole("group", { name: "Các mục quản trị" });
    const tabLabels = ["Tổng quan", "Người dùng", "Repositories", "Nhật ký"];
    const tabButtons = tabLabels.map((name) => tabs.getByRole("button", { name }));
    await expect(tabButtons[0]).toBeVisible();

    await tabButtons[0].focus();
    for (let index = 0; index < tabButtons.length; index += 1) {
      await expect(tabButtons[index]).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(tabButtons[index]).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("region", { name: tabLabels[index] })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (index < tabButtons.length - 1) await page.keyboard.press("Tab");
    }

    // --- Tab: Người dùng ---
    await tabButtons[1].focus();
    await page.keyboard.press("Enter");

    // Accessible column headers verification (Users table)
    const userHeaders = page.getByRole("columnheader");
    await expect(userHeaders).toHaveCount(5);
    await expect(userHeaders).toHaveText(["Tài khoản", "Vai trò", "Trạng thái", "Ngày tạo", "Thao tác"]);

    const aliceRow = page.getByRole("row", { name: /alice/ });
    const lockButton = aliceRow.getByRole("button", { name: "Khóa tài khoản" });
    await expect(lockButton).toBeVisible();

    if (viewport.name === "narrow") {
      const aliceCells = aliceRow.getByRole("cell");
      await expect(aliceCells).toHaveCount(5);
      for (let i = 0; i < 5; i += 1) {
        await expect(aliceCells.nth(i)).toHaveAttribute("data-label");
      }
      const buttonBox = await lockButton.boundingBox();
      expect(buttonBox).not.toBeNull();
      if (buttonBox) {
        expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(viewport.width);
      }
    }

    await lockButton.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Khóa alice?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Xác nhận" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(lockButton).toBeFocused();

    const secondLockButton = page.getByRole("row", { name: /bob/ }).getByRole("button", { name: "Khóa tài khoản" });
    await secondLockButton.press("Enter");
    const secondDialog = page.getByRole("dialog", { name: "Khóa bob?" });
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByRole("button", { name: "Xác nhận" })).toBeFocused();
    await secondDialog.evaluate((element) => element.dispatchEvent(new Event("close")));
    await expect(secondDialog.getByRole("heading", { name: "Khóa bob?" })).toBeVisible();
    await expect(secondDialog.getByRole("button", { name: "Xác nhận" })).toBeFocused();
    await secondDialog.getByRole("button", { name: "Hủy" }).click();
    await expect(secondDialog).not.toBeVisible();
    await expect(secondLockButton).toBeFocused();

    await lockButton.press("Enter");
    await expect(dialog).toBeVisible();
    await lockButton.evaluate((button) => button.remove());
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Điều hành Code Forge" })).toBeFocused();

    // --- Tab: Repositories ---
    await tabButtons[2].click();

    // Accessible column headers verification (Repositories table)
    const repoHeaders = page.getByRole("columnheader");
    await expect(repoHeaders).toHaveCount(5);
    await expect(repoHeaders).toHaveText(["Repository", "Quyền riêng tư", "Trạng thái", "PR · Thành viên", "Thao tác"]);

    const repoRow = page.getByRole("row", { name: new RegExp(repo.name) });
    await expect(repoRow).toBeVisible();
    if (viewport.name === "narrow") {
      const repoCells = repoRow.getByRole("cell");
      await expect(repoCells).toHaveCount(5);
      for (let i = 0; i < 5; i += 1) {
        await expect(repoCells.nth(i)).toHaveAttribute("data-label");
      }
      const repoButton = repoRow.getByRole("button", { name: "Khóa repository" });
      await expect(repoButton).toBeVisible();
      const repoButtonBox = await repoButton.boundingBox();
      expect(repoButtonBox).not.toBeNull();
      if (repoButtonBox) {
        expect(repoButtonBox.x + repoButtonBox.width).toBeLessThanOrEqual(viewport.width);
      }
    }

    // --- Tab: Nhật ký (Audit) ---
    await tabButtons[3].click();

    // Accessible column headers verification (Audit table)
    const auditHeaders = page.getByRole("columnheader");
    await expect(auditHeaders).toHaveCount(5);
    await expect(auditHeaders).toHaveText(["Thời điểm", "Người thực hiện", "Hành động", "Target", "Chi tiết an toàn"]);

    const auditRow = page.getByRole("row", { name: /ADMIN_USER_LOCKED/ });
    await expect(auditRow).toBeVisible();
    if (viewport.name === "narrow") {
      const auditCells = auditRow.getByRole("cell");
      await expect(auditCells).toHaveCount(5);
      for (let i = 0; i < 5; i += 1) {
        await expect(auditCells.nth(i)).toHaveAttribute("data-label");
      }
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
