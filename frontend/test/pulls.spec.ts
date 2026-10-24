import { expect, test } from "@playwright/test";

const owner = {
  id: "owner-1", username: "alice", email: "alice@example.test", systemRole: "USER", status: "ACTIVE",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const pullRequest = {
  id: "pr-1", number: 1, title: "Add greeting", description: "Adds a README greeting.",
  sourceBranch: "feature/greeting", targetBranch: "main", status: "OPEN", version: 3,
  storageGeneration: 2, sourceSha: "a".repeat(40), targetSha: "b".repeat(40),
  author: { id: "owner-1", username: "alice" }, createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
};

const compare = {
  state: "READY", sourceSha: pullRequest.sourceSha, targetSha: pullRequest.targetSha,
  mergeBase: "c".repeat(40), storageGeneration: 2, stale: false,
  commits: [{ sha: pullRequest.sourceSha, subject: "Add greeting", author: { name: "Alice", email: "alice@example.test" }, authoredAt: "2026-10-24T00:00:00.000Z" }],
  files: [{ status: "M", path: "README.md" }],
  diff: "diff --git a/README.md b/README.md\n+Hello from Code Forge\n", diffTruncated: false,
};

test("owner creates a pull request from a slash branch and reviews the compare snapshot", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  let createdRequest: Record<string, unknown> | undefined;
  await page.route("**/api/v1/repos/alice/project/branches", (route) =>
    route.fulfill({ json: { branches: [{ name: "main" }, { name: "feature/greeting" }] } }),
  );
  await page.route("**/api/v1/repos/alice/project/pulls*", async (route) => {
    if (route.request().method() === "POST") {
      createdRequest = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { pullRequest } });
    }
    return route.fulfill({ json: { pullRequests: [], page: 1, hasMore: false, permissions: { canCreate: true } } });
  });
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  await page.route("**/api/v1/repos/alice/project/pulls/1/compare", (route) => route.fulfill({ json: compare }));

  await page.goto("/alice/project/pulls");
  await page.getByRole("button", { name: "Tạo pull request", exact: true }).first().click();
  await page.getByLabel("Tiêu đề").fill("Add greeting");
  await page.getByLabel("Branch nguồn").selectOption("feature/greeting");
  await page.getByLabel("Mô tả").fill("Adds a README greeting.");
  await page.getByRole("button", { name: "Tạo pull request", exact: true }).last().click();

  await expect(page).toHaveURL(/\/alice\/project\/pulls\/1$/);
  expect(createdRequest).toEqual({
    title: "Add greeting", description: "Adds a README greeting.",
    sourceBranch: "feature/greeting", targetBranch: "main",
  });
  await expect(page.getByRole("heading", { name: /Add greeting/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Commits/ })).toBeVisible();
  await expect(page.getByText("feature/greeting", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Nội dung diff dạng văn bản")).toContainText("Hello from Code Forge");
});

test("stale compare prevents owner merge and displays a refresh warning", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  await page.route("**/api/v1/repos/alice/project/pulls/1/compare", (route) =>
    route.fulfill({ json: { ...compare, stale: true } }),
  );

  await page.goto("/alice/project/pulls/1");
  await expect(page.getByRole("status").filter({ hasText: "Branch đã thay đổi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge pull request" })).toBeDisabled();
});

test("owner confirms merge with the displayed snapshot and sees a stale conflict", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  await page.route("**/api/v1/repos/alice/project/pulls/1/compare", (route) => route.fulfill({ json: compare }));
  let mergeRequest: Record<string, unknown> | undefined;
  await page.route("**/api/v1/repos/alice/project/pulls/1/merge", async (route) => {
    mergeRequest = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 409, json: { error: { code: "STALE_COMPARE", message: "Compare đã cũ." } } });
  });

  await page.goto("/alice/project/pulls/1");
  await page.getByRole("button", { name: "Merge pull request" }).click();
  await expect(page.getByRole("heading", { name: "Xác nhận merge" })).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận merge" }).click();

  await expect(page.locator("p[role=alert]")).toContainText("Compare đã cũ.");
  expect(mergeRequest).toMatchObject({
    expectedSourceSha: pullRequest.sourceSha, expectedTargetSha: pullRequest.targetSha,
    storageGeneration: 2, version: 3,
  });
  expect(mergeRequest?.operationId).toEqual(expect.any(String));
});

test("owner cannot submit another merge while the previous operation is reconciling", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true },
      mergeOperation: { operationId: "merge-op", status: "NEEDS_RECONCILIATION", errorCode: null } } }),
  );
  await page.route("**/api/v1/repos/alice/project/pulls/1/compare", (route) => route.fulfill({ json: compare }));

  await page.goto("/alice/project/pulls/1");

  await expect(page.getByRole("status").filter({ hasText: "đang đối soát" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge pull request" })).toBeDisabled();
});
