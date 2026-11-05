import { expect, test, type APIRequestContext } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:4111";
const repository = {
  id: "home-repository",
  owner: { username: "alice" },
  name: "hello-world",
  description: "Repository thử nghiệm",
  visibility: "PUBLIC",
  updatedAt: "2026-09-01T00:00:00.000Z",
  permissions: { canRead: true, canWrite: false, canManage: false },
};

test.beforeEach(async ({ request }) => {
  await request.post(`${fixtureUrl}/__test/repositories/reset`);
});

test.afterEach(async ({ request }) => {
  await request.post(`${fixtureUrl}/__test/repositories/reset`);
});

async function configureRepositories(
  request: APIRequestContext,
  value: { status?: number; delayMs?: number; body: unknown },
) {
  const response = await request.post(`${fixtureUrl}/__test/repositories/config`, { data: value });
  expect(response.status()).toBe(204);
}

test("home renders only repositories returned by the API", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: /alice\s*\/\s*hello-world/ })).toBeVisible();
  await expect(page.getByText("cloud-forge-architecture")).toHaveCount(0);
  await expect(page.getByText("zero-trust-access-core")).toHaveCount(0);
  await expect(page.getByText("stream-packfile-engine")).toHaveCount(0);
  await expect(page.getByText("TypeScript", { exact: true })).toHaveCount(0);
});

test("Git Engine Lab interactions are labeled as examples and do not change repositories", async ({ page }) => {
  await page.goto("/");

  const lab = page.getByRole("region", { name: "Git Engine Lab — bản minh họa tương tác" });
  await expect(lab.getByText("DỮ LIỆU MINH HỌA")).toBeVisible();
  const commit = lab.getByRole("button", { name: /Commit a18d42c/ });
  await commit.click();
  await expect(commit).toHaveAttribute("aria-pressed", "true");
  await expect(lab.getByText("Khởi tạo tài liệu dự án")).toBeVisible();

  await lab.getByRole("tab", { name: "Xung đột" }).click();
  await lab.getByRole("button", { name: "Dùng main" }).click();
  await expect(lab.getByText("const requestTimeout = 120_000;", { exact: true }).last()).toBeVisible();
  await expect(lab.getByText(/Không sửa file hoặc thực hiện merge/)).toBeVisible();

  await lab.getByRole("tab", { name: "Split diff" }).click();
  await expect(lab.getByText("+1 −1")).toBeVisible();
  await expect(lab.getByText("timeoutMs: 150_000,", { exact: true })).toBeVisible();
});

test("home has no horizontal overflow at supported viewport widths", async ({ page }) => {
  await page.goto("/");

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("successful empty response displays an empty state without sample repositories", async ({ page, request }) => {
  await configureRepositories(request, { body: { repositories: [], hasMore: false } });
  await page.goto("/?q=missing&page=4");

  await expect(page.getByRole("heading", { name: "Không tìm thấy repository phù hợp" })).toBeVisible();
  await expect(page.getByText("cloud-forge-architecture")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Không thể tải danh sách repository" })).toHaveCount(0);
});

test("non-success response shows retry and preserves search and page", async ({ page, request }) => {
  await configureRepositories(request, { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE" } } });
  await page.goto("/?q=hello&page=3");

  const alert = page.getByRole("alert");
  await expect(alert.getByRole("heading", { name: "Không thể tải danh sách repository" })).toBeVisible();
  await expect(alert.locator('input[name="q"]')).toHaveValue("hello");
  await expect(alert.locator('input[name="page"]')).toHaveValue("3");

  await configureRepositories(request, { body: { repositories: [repository], hasMore: true } });
  await alert.getByRole("button", { name: "Thử lại" }).click();

  await expect(page).toHaveURL(/\?q=hello&page=3$/);
  await expect(page.getByRole("link", { name: /alice\s*\/\s*hello-world/ })).toBeVisible();
  await expect(page.getByText("Trang 3", { exact: true })).toBeVisible();
});

test("timed out repository request stays in an error state and does not render samples", async ({ page, request }) => {
  await configureRepositories(request, {
    delayMs: 3_000,
    body: { repositories: [repository], hasMore: false },
  });
  await page.goto("/?q=slow&page=2");

  await expect(page.getByRole("alert").getByRole("heading", { name: "Không thể tải danh sách repository" })).toBeVisible();
  await expect(page.getByText("cloud-forge-architecture")).toHaveCount(0);
});
