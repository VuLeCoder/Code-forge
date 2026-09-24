import { expect, test, type Page } from "@playwright/test";

const user = { id: "test-user", username: "alice", email: "private@example.test", systemRole: "USER", status: "ACTIVE", createdAt: "2026-09-01T00:00:00.000Z" };

async function anonymous(page: Page) {
  await page.route("**/api/v1/auth/*", (route) => route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED" } } }));
}

test('public profile is accessible anonymously and fits a mobile viewport', async ({ page }) => {
  await anonymous(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/alice');
  await expect(page.getByRole('heading', { name: 'alice', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repository', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'hello-world' })).toBeVisible();
  await expect(page.getByText(user.email)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('explore lists public repositories and searches real API results', async ({ page }) => {
  await anonymous(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'alice / hello-world' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Tìm repository' }).fill('khong-co');
  await page.getByRole('button', { name: 'Tìm kiếm' }).click();
  await expect(page.getByText('Không tìm thấy repository phù hợp.')).toBeVisible();
});

test('public repository opens its empty page', async ({ page }) => {
  await anonymous(page);
  await page.goto('/alice/hello-world');
  await expect(page.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
  await expect(page.getByText('Repository thử nghiệm')).toBeVisible();
  await expect(page.getByText('main', { exact: true })).toBeVisible();
});

test('create repository reports name conflicts and opens the new repository', async ({ page }) => {
  await anonymous(page);
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/v1/repositories', async (route) => {
    const data = route.request().postDataJSON() as { name: string; description: string; visibility: string };
    if (data.name === 'taken') return route.fulfill({ status: 409, json: { error: { code: 'REPOSITORY_NAME_TAKEN' } } });
    expect(data).toEqual({ name: 'my-project', description: 'Mô tả thử nghiệm', visibility: 'PRIVATE' });
    return route.fulfill({ status: 201, json: { repository: { id: 'created', owner: { username: 'alice' }, name: data.name, description: data.description, visibility: data.visibility } } });
  });
  await page.route('**/api/v1/repos/alice/my-project', (route) => route.fulfill({ json: { repository: { id: 'created', owner: { username: 'alice' }, name: 'my-project', description: 'Mô tả thử nghiệm', visibility: 'PRIVATE', status: 'ACTIVE', defaultBranch: 'main', permissions: { canRead: true, canManage: true } } } }));
  await page.goto('/new');
  await page.getByLabel('Tên repository').fill('taken');
  await page.getByRole('button', { name: 'Tạo repository' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('đã được sử dụng');
  await page.getByLabel('Tên repository').fill('my-project');
  await page.getByLabel('Mô tả').fill('Mô tả thử nghiệm');
  await page.getByRole('radio', { name: /Riêng tư/ }).check();
  await page.getByRole('button', { name: 'Tạo repository' }).click();
  await expect(page).toHaveURL('/alice/my-project');
  await expect(page.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
  await expect(page.getByText('Riêng tư')).toBeVisible();
});

test('unknown profile and backend failure have distinct states', async ({ page }) => {
  await anonymous(page);
  await page.goto('/missing-user');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy người dùng' })).toBeVisible();
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'Chưa thể tải hồ sơ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('heading', { name: 'offline', exact: true })).toBeVisible();
});

test('new repository requires login and returns to the intended page', async ({ page }) => {
  await anonymous(page);
  await page.goto('/new');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fnew$/);
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ json: { user } }));
  await page.getByLabel('Email hoặc username').fill('alice');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/new');
  await expect(page.getByRole('heading', { name: 'Tạo repository' })).toBeVisible();
  await page.getByRole('link', { name: 'Hồ sơ alice' }).click();
  await expect(page).toHaveURL('/alice');
});

test('expired access refreshes once and logout removes protected content', async ({ page }) => {
  await anonymous(page);
  let refreshes = 0;
  await page.route('**/api/v1/auth/refresh', (route) => {
    refreshes++;
    return route.fulfill({ json: { user } });
  });
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204 }));
  await page.goto('/new');
  await expect(page.getByRole('heading', { name: 'Tạo repository' })).toBeVisible();
  expect(refreshes).toBe(1);
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('link', { name: 'Hồ sơ alice' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Tạo repository' })).toHaveCount(0);
});

test('switching between login and registration preserves returnTo', async ({ page }) => {
  await anonymous(page);
  await page.goto('/login?returnTo=%2Fnew');
  await page.getByRole('link', { name: 'Đăng ký miễn phí' }).click();
  await expect(page).toHaveURL('/register?returnTo=%2Fnew');
  await page.getByRole('main').getByRole('link', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/login?returnTo=%2Fnew');
});

test('registration validates confirmation, displays conflicts and establishes a session', async ({ page }) => {
  await anonymous(page);
  await page.goto('/register?returnTo=%2Fnew');
  await page.getByLabel('Username', { exact: true }).fill('alice.demo');
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('test-password-123');
  await page.getByLabel('Xác nhận mật khẩu').fill('different-password');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByText('Mật khẩu xác nhận chưa khớp.')).toBeVisible();
  await page.getByLabel('Xác nhận mật khẩu').fill('test-password-123');
  await page.route('**/api/v1/auth/register', (route) => route.fulfill({ status: 409, json: { error: { code: 'ACCOUNT_ALREADY_EXISTS' } } }));
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('đã được sử dụng');
  await page.route('**/api/v1/auth/register', (route) => route.fulfill({ status: 201, json: { user } }));
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page).toHaveURL('/new');
  await expect(page.getByRole('link', { name: 'Hồ sơ alice' })).toBeVisible();
});

test('locked account gets a clear error and external returnTo cannot redirect away', async ({ page }) => {
  await anonymous(page);
  await page.goto('/login?returnTo=https://example.org');
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ status: 403, json: { error: { code: 'ACCOUNT_LOCKED' } } }));
  await page.getByLabel('Email hoặc username').fill('alice');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('đã bị khóa');
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({ json: { user } }));
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/');
});
