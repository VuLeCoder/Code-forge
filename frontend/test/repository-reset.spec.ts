import { expect, test } from "@playwright/test";

const owner = {
  id: "owner-1", username: "alice", email: "alice@example.test", systemRole: "USER", status: "ACTIVE",
  createdAt: "2026-10-01T00:00:00.000Z",
};

test("repository reset is clear while branch, history, and clone actions reflect empty storage", async ({ page, context }) => {
  const cloneUrl = "https://git.example.test/api/v1/git/alice/lost-project.git";
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/lost-project/branches*", (route) => route.fulfill({ json: {
    branches: [], selectedBranch: null, defaultBranch: "main", storageState: "RESET", storageGeneration: 4,
  } }));
  await page.route("**/api/v1/repos/alice/lost-project/commits?*", (route) => route.fulfill({ json: {
    commits: [], page: 1, hasMore: false, snapshot: null, storageState: "RESET",
  } }));
  await page.route("**/api/v1/repos/alice/lost-project", (route) => route.fulfill({ json: { repository: {
    id: "repo-1", name: "lost-project", owner: { username: "alice" }, visibility: "PRIVATE",
    status: "ACTIVE", defaultBranch: "main", storageState: "RESET", storageGeneration: 4,
    readme: null, cloneUrl,
    permissions: { canRead: true, canWrite: true, canManage: true },
  } } }));

  await page.goto("/alice/lost-project");

  await expect(page.getByRole("status").filter({ hasText: "Kho lưu trữ Git đã được khởi tạo lại" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Repository chưa có mã nguồn" })).toBeVisible();
  await page.getByRole("link", { name: "Hướng dẫn", exact: true }).click();
  const quickSetup = page.getByRole("region", { name: "Bắt đầu với repository này" });
  await expect(quickSetup).toBeVisible();
  await expect(quickSetup).toContainText("git init -b main");
  await expect(quickSetup).toContainText("git push -u origin main");
  await expect(quickSetup).toContainText(cloneUrl);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await quickSetup.getByRole("button", { name: "Sao chép lệnh" }).click();
  await expect(quickSetup.getByRole("status")).toHaveText("Đã sao chép hướng dẫn Git.");
  await expect(page.getByRole("heading", { name: "README.md" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Điều hướng repository" }).getByRole("link", { name: "Mã nguồn", exact: true }).click();
  await expect(page.getByLabel("Branch", { exact: true })).toHaveAttribute("aria-disabled", "true");

  await page.goto("/alice/lost-project?view=commits");
  const history = page.getByRole("region", { name: "Lịch sử commit", exact: true });
  await expect(history.getByText("Git storage đã được khởi tạo lại; lịch sử trước đó không còn.", { exact: true })).toBeVisible();
  await expect(history.getByText("Chưa có commit trên branch này.", { exact: true })).toBeVisible();
  await expect(history.getByRole("list")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Điều hướng repository" }).getByRole("link", { name: "Mã nguồn", exact: true }).click();
  await page.getByRole("button", { name: "Code" }).click();
  const cloneDialog = page.getByRole("dialog", { name: "Clone repository" });
  await expect(cloneDialog).toBeVisible();
  await expect(cloneDialog.getByLabel("URL clone")).toHaveValue(cloneUrl);
  await expect(cloneDialog).toContainText("Repository rỗng vẫn có thể clone.");
  await expect(cloneDialog).toContainText("git clone");
  await expect(cloneDialog).toContainText("git push origin ten-branch");
});
