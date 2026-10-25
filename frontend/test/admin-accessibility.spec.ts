import { expect, test } from "@playwright/test";

const admin = { id: "admin-1", username: "site-admin", email: "admin@example.test", systemRole: "ADMIN", status: "ACTIVE", createdAt: "2026-10-01T00:00:00.000Z" };
const user = { id: "user-1", username: "alice", email: "alice@example.test", systemRole: "USER", status: "ACTIVE", lockedAt: null, createdAt: "2026-10-02T00:00:00.000Z" };
const secondUser = { id: "user-2", username: "bob", email: "bob@example.test", systemRole: "USER", status: "ACTIVE", lockedAt: null, createdAt: "2026-10-03T00:00:00.000Z" };

for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "narrow", width: 375, height: 812 }]) {
  test(`admin controls support keyboard navigation and dialog focus return at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: admin } }));
    await page.route("**/api/v1/admin/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith("/stats")) return route.fulfill({ json: {
        users: { total: 1, active: 1, locked: 0 }, repositories: { total: 0, active: 0, locked: 0, deleted: 0 },
        pullRequests: { total: 0, open: 0, pendingMerges: 0 },
      } });
      if (pathname.endsWith("/users")) return route.fulfill({ json: {
        users: [user, secondUser], page: 1, pageSize: 20, total: 2, hasMore: false,
      } });
      if (pathname.endsWith("/repositories")) return route.fulfill({ json: {
        repositories: [], page: 1, pageSize: 20, total: 0, hasMore: false,
      } });
      if (pathname.endsWith("/audit")) return route.fulfill({ json: {
        audit: [], page: 1, pageSize: 20, total: 0, hasMore: false,
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
      if (index < tabButtons.length - 1) await page.keyboard.press("Tab");
    }

    await tabButtons[1].focus();
    await page.keyboard.press("Enter");
    const lockButton = page.getByRole("row", { name: /alice/ }).getByRole("button", { name: "Khóa tài khoản" });
    await expect(lockButton).toBeVisible();
    await lockButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Khóa alice?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Xác nhận" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(lockButton).toBeFocused();

    const secondLockButton = page.getByRole("row", { name: /bob/ }).getByRole("button", { name: "Khóa tài khoản" });
    await secondLockButton.focus();
    await page.keyboard.press("Enter");
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
  });
}
