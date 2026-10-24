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

test("PR detail announces a backend failure and recovers through keyboard retry without a reload", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  let detailCalls = 0;
  let compareCalls = 0;
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) => {
    detailCalls += 1;
    return detailCalls === 1
      ? route.fulfill({ status: 503, json: { error: { code: "BACKEND_UNAVAILABLE", message: "Backend tạm thời không thể kết nối." } } })
      : route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } });
  });
  await page.route("**/api/v1/repos/alice/project/pulls/1/compare", (route) => {
    compareCalls += 1;
    return route.fulfill({ json: compare });
  });

  await page.goto("/alice/project/pulls/1");
  const error = page.locator("p[role=alert]");
  await expect(error).toContainText("Backend tạm thời không thể kết nối.");
  await expect(page.getByText("Không tìm thấy pull request.", { exact: true })).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Thử lại" });
  await retry.focus();
  await retry.press("Enter");

  await expect(page.getByRole("heading", { name: /Add greeting/ })).toBeVisible();
  await expect(page.getByLabel("Nội dung diff dạng văn bản")).toContainText("Hello from Code Forge");
  await expect(page.getByRole("button", { name: "Merge pull request" })).toBeEnabled();
  await expect(page.getByText("Không có commit mới trong snapshot này.", { exact: true })).toHaveCount(0);
  expect(detailCalls).toBe(2);
  expect(compareCalls).toBe(2);
  await expect(page).toHaveURL(/\/alice\/project\/pulls\/1$/);
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
  const editTrigger = page.getByRole("button", { name: "Chỉnh sửa" });
  await editTrigger.focus();
  await editTrigger.press("Enter");
  await expect(page.getByLabel("Tiêu đề")).toBeFocused();
  await page.getByRole("button", { name: "Hủy" }).click();
  await expect(editTrigger).toBeFocused();

  const mergeTrigger = page.getByRole("button", { name: "Merge pull request" });
  await mergeTrigger.focus();
  await mergeTrigger.press("Enter");
  const confirmationHeading = page.getByRole("heading", { name: "Xác nhận merge" });
  await expect(confirmationHeading).toBeVisible();
  await expect(confirmationHeading).toBeFocused();
  await expect(confirmationHeading).toHaveCSS("outline-style", "solid");
  await page.getByRole("button", { name: "Xác nhận merge" }).click();

  await expect(page.locator("p[role=alert]")).toContainText("Compare đã cũ.");
  await expect(page.locator("p[role=alert]")).toBeFocused();
  expect(mergeRequest).toMatchObject({
    expectedSourceSha: pullRequest.sourceSha, expectedTargetSha: pullRequest.targetSha,
    storageGeneration: 2, version: 3,
  });
  expect(mergeRequest?.operationId).toEqual(expect.any(String));
});

test("pull request form announces validation, restores focus, and fits a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/project/branches", (route) =>
    route.fulfill({ json: { branches: [{ name: "main" }, { name: "feature/greeting" }] } }),
  );
  await page.route("**/api/v1/repos/alice/project/pulls*", (route) =>
    route.fulfill({ json: { pullRequests: [], page: 1, hasMore: false, permissions: { canCreate: true } } }),
  );

  await page.goto("/alice/project/pulls");
  const toggle = page.getByRole("button", { name: "Tạo pull request", exact: true }).first();
  await toggle.focus();
  await toggle.press("Enter");
  await expect(page.getByLabel("Tiêu đề")).toBeFocused();
  await page.getByLabel("Tiêu đề").fill("Invalid same-branch request");
  await page.getByLabel("Branch nguồn").selectOption("main");
  await page.getByLabel("Branch đích").selectOption("main");
  await page.getByRole("button", { name: "Tạo pull request", exact: true }).last().click();
  const validation = page.getByRole("alert").filter({ hasText: "Hãy chọn hai branch khác nhau." });
  await expect(validation).toBeFocused();

  await page.getByRole("button", { name: "Hủy" }).click();
  await expect(toggle).toBeFocused();
  const emptyStateToggle = page.getByRole("button", { name: "Tạo pull request", exact: true }).last();
  await emptyStateToggle.focus();
  await emptyStateToggle.press("Enter");
  await expect(page.getByLabel("Tiêu đề")).toBeFocused();
  await page.getByRole("button", { name: "Hủy" }).click();
  await expect(emptyStateToggle).toBeFocused();
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("branch loading error is distinct from an empty list and can be retried", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  let branchCalls = 0;
  await page.route("**/api/v1/repos/alice/project/branches", (route) => {
    branchCalls += 1;
    return branchCalls === 1
      ? route.fulfill({ status: 503, json: { error: { code: "BACKEND_UNAVAILABLE", message: "Unavailable" } } })
      : route.fulfill({ json: { branches: [{ name: "main" }, { name: "feature/recovered" }] } });
  });
  await page.route("**/api/v1/repos/alice/project/pulls*", (route) =>
    route.fulfill({ json: { pullRequests: [], page: 1, hasMore: false, permissions: { canCreate: true } } }),
  );

  await page.goto("/alice/project/pulls");
  await page.getByRole("button", { name: "Tạo pull request", exact: true }).first().click();
  const branchError = page.getByRole("alert").filter({ hasText: "Không thể tải danh sách branch." });
  await expect(branchError).toBeVisible();
  await expect(page.getByLabel("Branch nguồn")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo pull request", exact: true }).last()).toBeDisabled();

  await page.getByRole("button", { name: "Thử tải lại branch" }).click();
  await expect(page.getByLabel("Branch nguồn")).toHaveValue("");
  await expect(page.getByLabel("Branch đích")).toHaveValue("main");
  await expect(branchError).toHaveCount(0);
  expect(branchCalls).toBe(2);
});

test("long PR labels and diff stay contained at 375px while review controls remain keyboard accessible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  const longSource = `feature/${"very-long-branch-segment-".repeat(8)}`;
  const longTarget = `release/${"stable-target-".repeat(8)}`;
  const longPath = `packages/${"nested-folder/".repeat(10)}exceptionally-long-source-file-name.ts`;
  const longPullRequest = { ...pullRequest, sourceBranch: longSource, targetBranch: longTarget };
  const longCompare = {
    ...compare,
    commits: [{ ...compare.commits[0], subject: `Add a coordinated change from ${longSource}` }],
    files: [{ status: "M", path: longPath }],
    diff: `diff --git a/${longPath} b/${longPath}\n+${"unbroken-diff-segment".repeat(120)}\n`,
  };
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest: longPullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  await page.route("**/api/v1/repos/alice/project/pulls/1/compare", (route) => route.fulfill({ json: longCompare }));

  await page.goto("/alice/project/pulls/1");
  await expect(page.getByRole("heading", { name: /Add greeting/ })).toBeVisible();
  await expect(page.getByText(longSource, { exact: true })).toBeVisible();
  await expect(page.getByText(longPath, { exact: true })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  const diff = page.getByLabel("Nội dung diff dạng văn bản");
  const diffWidths = await diff.evaluate((element) => ({ client: element.clientWidth, content: element.scrollWidth }));
  expect(diffWidths.content).toBeGreaterThan(diffWidths.client);

  const editButton = page.getByRole("button", { name: "Chỉnh sửa" });
  await editButton.focus();
  await editButton.press("Enter");
  await expect(page.getByLabel("Tiêu đề")).toBeFocused();
  await page.getByRole("button", { name: "Hủy" }).click();
  await expect(editButton).toBeFocused();

  const mergeButton = page.getByRole("button", { name: "Merge pull request" });
  await expect(mergeButton).toBeEnabled();
  await mergeButton.focus();
  await mergeButton.press("Enter");
  const confirmationHeading = page.getByRole("heading", { name: "Xác nhận merge" });
  await expect(confirmationHeading).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Xác nhận merge" })).toBeFocused();
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
