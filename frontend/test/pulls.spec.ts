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
  mergeBase: "c".repeat(40), storageGeneration: 0, stale: false,
};

const commit = { sha: pullRequest.sourceSha, subject: "Add greeting", author: { name: "Alice", email: "alice@example.test" }, authoredAt: "2026-10-24T00:00:00.000Z" };
const changedFile = { status: "M", path: "README.md" };
const diffFile = { ...changedFile, diffStatus: "TEXT", diff: "diff --git a/README.md b/README.md\n+Hello from Code Forge\n" };

function pageEnvelope<T>(items: T[], page = 1, totalItems = items.length) {
  return { snapshot: { sourceSha: compare.sourceSha, targetSha: compare.targetSha, storageGeneration: compare.storageGeneration },
    pagination: { page, pageSize: 20, totalItems, totalPages: Math.ceil(totalItems / 20), hasMore: page < Math.ceil(totalItems / 20) }, items };
}

async function routeComparePages(page: import("@playwright/test").Page, options: {
  summary?: () => typeof compare;
  commits?: (pageNumber: number) => ReturnType<typeof pageEnvelope<typeof commit>>;
  files?: (pageNumber: number) => ReturnType<typeof pageEnvelope<typeof changedFile>>;
  diff?: (pageNumber: number) => ReturnType<typeof pageEnvelope<typeof diffFile>>;
} = {}) {
  await page.route((url) => url.pathname.endsWith("/pulls/1/compare"), (route) => {
    expect(new URL(route.request().url()).searchParams.get("summary")).toBe("true");
    return route.fulfill({ json: options.summary?.() ?? compare });
  });
  for (const [suffix, getItems] of [["commits", options.commits ?? (() => pageEnvelope([commit]))],
    ["files", options.files ?? (() => pageEnvelope([changedFile]))], ["diff", options.diff ?? (() => pageEnvelope([diffFile]))]] as const) {
    await page.route((url) => url.pathname.endsWith(`/pulls/1/${suffix}`), (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("sourceSha")).toBe(compare.sourceSha);
      expect(url.searchParams.get("targetSha")).toBe(compare.targetSha);
      expect(url.searchParams.get("storageGeneration")).toBe("0");
      const pageNumber = Number(url.searchParams.get("page"));
      expect(pageNumber).toBeGreaterThan(0);
      expect(url.searchParams.get("pageSize")).toBe("20");
      const response = getItems(pageNumber);
      return route.fulfill({ json: { ...response, [suffix === "commits" ? "commits" : "files"]: response.items } });
    });
  }
}

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
  await routeComparePages(page);

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
  await expect(page.getByLabel("Diff của README.md")).toContainText("Hello from Code Forge");
});

test("stale compare prevents owner merge and displays a refresh warning", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  await routeComparePages(page, { summary: () => ({ ...compare, stale: true }) });

  await page.goto("/alice/project/pulls/1");
  await expect(page.getByRole("status").filter({ hasText: "Branch đã thay đổi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge pull request" })).toBeDisabled();
});

test("compare 409 reloads summary and all pages from one refreshed snapshot", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  const fresh = { ...compare, sourceSha: "f".repeat(40), storageGeneration: 1 };
  let summaryCalls = 0;
  let oldSnapshotCommitCalls = 0;
  const acceptedSnapshots: string[] = [];
  await page.route((url) => url.pathname.endsWith("/pulls/1/compare"), (route) => {
    summaryCalls += 1;
    expect(new URL(route.request().url()).searchParams.get("summary")).toBe("true");
    return route.fulfill({ json: summaryCalls === 1 ? compare : fresh });
  });
  for (const suffix of ["commits", "files", "diff"] as const) {
    await page.route((url) => url.pathname.endsWith(`/pulls/1/${suffix}`), (route) => {
      const url = new URL(route.request().url());
      const sourceSha = url.searchParams.get("sourceSha");
      const storageGeneration = url.searchParams.get("storageGeneration");
      if (sourceSha === compare.sourceSha) {
        if (suffix === "commits") oldSnapshotCommitCalls += 1;
        return route.fulfill({ status: 409, json: { error: { code: "STALE_COMPARE", message: "Snapshot cũ." } } });
      }
      acceptedSnapshots.push(`${suffix}:${sourceSha}:${url.searchParams.get("targetSha")}:${storageGeneration}:${url.searchParams.get("page")}:${url.searchParams.get("pageSize")}`);
      const response = suffix === "commits" ? pageEnvelope([{ ...commit, subject: "Fresh snapshot commit" }])
        : suffix === "files" ? pageEnvelope([changedFile]) : pageEnvelope([diffFile]);
      return route.fulfill({ json: { ...response, snapshot: { sourceSha: fresh.sourceSha, targetSha: fresh.targetSha, storageGeneration: fresh.storageGeneration }, [suffix === "commits" ? "commits" : "files"]: response.items } });
    });
  }

  await page.goto("/alice/project/pulls/1");
  await expect(page.getByText("Fresh snapshot commit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge pull request" })).toBeEnabled();
  expect(summaryCalls).toBe(2);
  expect(oldSnapshotCommitCalls).toBe(1);
  expect(acceptedSnapshots).toHaveLength(3);
  expect(acceptedSnapshots.every((value) => value.includes(`${fresh.sourceSha}:${fresh.targetSha}:1:1:20`))).toBe(true);
});

test("compare page controls request only the selected page and announce pagination metadata", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  const commitRequests: number[] = [];
  const fileRequests: number[] = [];
  await routeComparePages(page, {
    commits: (pageNumber) => {
      commitRequests.push(pageNumber);
      return pageEnvelope(pageNumber === 1 ? [commit] : [{ ...commit, sha: "e".repeat(40), subject: "Commit on page two" }], pageNumber, 21);
    },
    files: (pageNumber) => {
      fileRequests.push(pageNumber);
      return pageEnvelope(pageNumber === 1 ? [changedFile] : [{ status: "A", path: "src/new-page.ts" }], pageNumber, 21);
    },
    diff: (pageNumber) => pageEnvelope(pageNumber === 1 ? [diffFile] : [{ status: "A", path: "src/new-page.ts", diffStatus: "TEXT", diff: "+new page" }], pageNumber, 21),
  });

  await page.goto("/alice/project/pulls/1");
  const commitPagination = page.getByRole("navigation", { name: "Phân trang commits" });
  await expect(commitPagination).toContainText("Trang 1/2 · 21 mục");
  await expect(commitPagination.getByRole("button", { name: "Trang trước" })).toBeDisabled();
  await expect(commitPagination.getByRole("button", { name: "Trang tiếp" })).toBeEnabled();
  await commitPagination.getByRole("button", { name: "Trang tiếp" }).focus();
  await commitPagination.getByRole("button", { name: "Trang tiếp" }).press("Enter");
  await expect(page.getByText("Commit on page two")).toBeVisible();
  await expect(commitPagination).toContainText("Trang 2/2 · 21 mục");
  await expect(commitPagination.getByRole("button", { name: "Trang trước" })).toBeEnabled();
  await expect(commitPagination.getByRole("button", { name: "Trang tiếp" })).toBeDisabled();

  const filePagination = page.getByRole("navigation", { name: "Phân trang files changed và diff" });
  await filePagination.getByRole("button", { name: "Trang tiếp" }).click();
  await expect(page.getByText("src/new-page.ts", { exact: true }).first()).toBeVisible();
  await expect(filePagination).toContainText("Trang 2/2 · 21 mục");
  await expect(page.getByLabel("Diff của src/new-page.ts")).toContainText("+new page");
  expect(commitRequests).toEqual([1, 2]);
  expect(fileRequests).toEqual([1, 2]);
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
  await routeComparePages(page, { summary: () => {
    compareCalls += 1;
    return compare;
  } });

  await page.goto("/alice/project/pulls/1");
  const error = page.locator("p[role=alert]");
  await expect(error).toContainText("Backend tạm thời không thể kết nối.");
  await expect(page.getByText("Không tìm thấy pull request.", { exact: true })).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Thử lại" });
  await retry.focus();
  await retry.press("Enter");

  await expect(page.getByRole("heading", { name: /Add greeting/ })).toBeVisible();
  await expect(page.getByLabel("Diff của README.md")).toContainText("Hello from Code Forge");
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
  await routeComparePages(page);
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
    storageGeneration: 0, version: 3,
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
  const longCommit = { ...commit, subject: `Add a coordinated change from ${longSource}` };
  const longFile = { status: "M", path: longPath };
  const longDiff = { ...longFile, diffStatus: "TEXT" as const, diff: `diff --git a/${longPath} b/${longPath}\n+${"unbroken-diff-segment".repeat(120)}\n` };
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) =>
    route.fulfill({ json: { pullRequest: longPullRequest, permissions: { canCreate: true, canEdit: true, canMerge: true }, mergeOperation: null } }),
  );
  await routeComparePages(page, { commits: () => pageEnvelope([longCommit]), files: () => pageEnvelope([longFile]), diff: () => pageEnvelope([longDiff]) });

  await page.goto("/alice/project/pulls/1");
  await expect(page.getByRole("heading", { name: /Add greeting/ })).toBeVisible();
  await expect(page.getByText(longSource, { exact: true })).toBeVisible();
  await expect(page.getByText(longPath, { exact: true }).first()).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  const diff = page.getByLabel(`Diff của ${longPath}`);
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
  await routeComparePages(page);

  await page.goto("/alice/project/pulls/1");

  await expect(page.getByRole("status").filter({ hasText: "đang đối soát" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Merge pull request" })).toBeDisabled();
});

test("background reconciliation announces the completed merge", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  let detailCalls = 0;
  await page.route("**/api/v1/repos/alice/project/pulls/1", (route) => {
    detailCalls += 1;
    return route.fulfill({ json: {
      pullRequest: detailCalls === 1 ? pullRequest : {
        ...pullRequest, status: "MERGED", mergedBy: { id: owner.id, username: "alice" },
        mergedAt: "2026-10-25T00:00:00.000Z", mergeCommitSha: "d".repeat(40),
      },
      permissions: { canCreate: true, canEdit: detailCalls !== 1, canMerge: detailCalls === 1 },
      mergeOperation: detailCalls === 1
        ? { operationId: "merge-op", status: "NEEDS_RECONCILIATION", errorCode: null }
        : { operationId: "merge-op", status: "COMPLETED", errorCode: null },
    } });
  });
  await routeComparePages(page);

  await page.goto("/alice/project/pulls/1");
  await expect(page.getByRole("status").filter({ hasText: "đang đối soát" })).toBeVisible();
  const completed = page.getByRole("status").filter({ hasText: "Đã merge bởi alice" });
  await expect(completed).toBeVisible({ timeout: 6_000 });
  await expect(completed).toContainText("dddddddddddd");
  expect(detailCalls).toBe(2);
});
