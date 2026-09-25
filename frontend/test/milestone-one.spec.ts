import { expect, test, type Page } from "@playwright/test";

const user = { id: "test-user", username: "alice", email: "private@example.test", systemRole: "USER", status: "ACTIVE", createdAt: "2026-09-01T00:00:00.000Z" };

async function anonymous(page: Page) {
  await page.route("**/api/v1/auth/*", (route) => route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED" } } }));
}

test('mobile navigation opens create and refreshes an expired session during submission', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  let refreshes = 0;
  await page.route('**/api/v1/auth/refresh', (route) => {
    refreshes++;
    return route.fulfill({ json: { user } });
  });
  let submissions = 0;
  await page.route('**/api/v1/repositories', (route) => {
    submissions++;
    return route.fulfill(submissions === 1
      ? { status: 401, json: { error: { code: 'ACCESS_TOKEN_INVALID' } } }
      : { status: 201, json: { repository: { name: 'hello-world', owner: { username: 'alice' } } } });
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Tạo repository' }).click();
  await page.getByRole('textbox', { name: 'Tên repository' }).fill('hello-world');
  await page.getByRole('button', { name: 'Tạo repository' }).click();
  await expect(page).toHaveURL('/alice/hello-world');
  await expect(page.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
  expect(refreshes).toBe(1);
  expect(submissions).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('owner list reports failure and retries with a refreshed session', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  let refreshes = 0;
  await page.route('**/api/v1/auth/refresh', (route) => {
    refreshes++;
    return route.fulfill({ json: { user } });
  });
  let requests = 0;
  await page.route('**/api/v1/users/alice', (route) => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 503, json: {} });
    if (requests === 2) return route.fulfill({ status: 401, json: {} });
    return route.fulfill({ json: { repositories: [{ id: 'private', name: 'private-project', visibility: 'PRIVATE', owner: { username: 'alice' } }] } });
  });
  await page.goto('/alice');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Chưa thể tải danh sách');
  await expect(page.getByRole('heading', { name: 'Chưa có repository' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('link', { name: 'private-project' })).toBeVisible();
  expect(refreshes).toBe(1);
});

test('owner sees deleted repositories and restores one from the profile', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  let restored = false;
  await page.route('**/api/v1/users/alice', (route) => route.fulfill({ json: { repositories: restored ? [{ id: 'deleted', name: 'old-project', visibility: 'PRIVATE', owner: { username: 'alice' } }] : [] } }));
  await page.route('**/api/v1/repositories/deleted', (route) => route.fulfill({ json: { repositories: restored ? [] : [{ id: 'deleted', name: 'old-project', visibility: 'PRIVATE', owner: { username: 'alice' }, purgeAfter: '2026-10-01T00:00:00.000Z' }] } }));
  await page.route('**/api/v1/repos/alice/old-project/restore', (route) => { restored = true; return route.fulfill({ status: 201, json: { repository: { name: 'old-project' } } }); });
  await page.goto('/alice');
  await expect(page.getByRole('heading', { name: 'Repository đã xóa' })).toBeVisible();
  await page.getByRole('button', { name: 'Khôi phục' }).click();
  await expect(page.getByRole('link', { name: 'old-project' })).toBeVisible();
  await expect(page.getByText('Không có repository đang chờ xóa.')).toBeVisible();
});

test('repository read refreshes mid-session and long names fit mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ json: { user } }));
  let reads = 0;
  const name = 'a'.repeat(100);
  await page.route('**/api/v1/repos/alice/*', (route) => {
    reads++;
    return route.fulfill(reads === 1 ? { status: 401, json: {} } : { json: { repository: { id: 'long', name, description: 'x'.repeat(2000), visibility: 'PRIVATE', owner: { username: 'alice' }, defaultBranch: 'main' } } });
  });
  await page.goto(`/alice/${name}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(reads).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed refresh leaves create form editable without retrying the mutation', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, json: {} }));
  let submissions = 0;
  await page.route('**/api/v1/repositories', (route) => {
    submissions++;
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Tên repository' }).fill('keep-my-input');
  await page.getByRole('button', { name: 'Tạo repository' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Phiên đăng nhập đã hết hạn');
  await expect(page.getByRole('textbox', { name: 'Tên repository' })).toHaveValue('keep-my-input');
  await expect(page.getByRole('button', { name: 'Tạo repository' })).toBeEnabled();
  expect(submissions).toBe(1);
});

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
    expect(data).toEqual({ name: 'my-project', description: 'Mô tả thử nghiệm', visibility: 'PRIVATE', initializeReadme: false });
    return route.fulfill({ status: 201, json: { repository: { id: 'created', owner: { username: 'alice' }, name: data.name, description: data.description, visibility: data.visibility } } });
  });
  await page.route('**/api/v1/repos/alice/my-project', (route) => route.fulfill({ json: { repository: { id: 'created', owner: { username: 'alice' }, name: 'my-project', description: 'Mô tả thử nghiệm', visibility: 'PRIVATE', status: 'ACTIVE', defaultBranch: 'main', permissions: { canRead: true, canManage: true } } } }));
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Tên repository' }).fill('taken');
  await page.getByRole('button', { name: 'Tạo repository' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('đã được sử dụng');
  await page.getByRole('textbox', { name: 'Tên repository' }).fill('my-project');
  await page.getByLabel('Mô tả').fill('Mô tả thử nghiệm');
  await page.getByRole('radio', { name: /Riêng tư/ }).check();
  await page.getByRole('button', { name: 'Tạo repository' }).click();
  await expect(page).toHaveURL('/alice/my-project');
  await expect(page.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
  await expect(page.getByText('Riêng tư')).toBeVisible();
});

test('README option is sent on create and a storage reset is explained', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/v1/repositories', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ name: 'with-readme', initializeReadme: true });
    return route.fulfill({ status: 201, json: { repository: { name: 'with-readme', owner: { username: 'alice' } } } });
  });
  let reset = false;
  await page.route('**/api/v1/repos/alice/with-readme', (route) => route.fulfill({ json: { repository: {
    name: 'with-readme', owner: { username: 'alice' }, visibility: 'PRIVATE', defaultBranch: 'main',
    storageState: reset ? 'RESET' : 'READY', readme: reset ? null : '# with-readme\n',
  } } }));
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Tên repository' }).fill('with-readme');
  await page.getByRole('checkbox', { name: /Thêm README.md/ }).check();
  await page.getByRole('button', { name: 'Tạo repository' }).click();
  await expect(page.getByRole('heading', { name: 'README.md' })).toBeVisible();
  await expect(page.getByText('# with-readme')).toBeVisible();
  reset = true;
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Mã nguồn của repository demo đã bị reset');
  await expect(page.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
});

test('owner can edit repository settings, confirm visibility, and confirm deletion', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { user } }));
  let name = 'my-project';
  let description = 'Initial description';
  let visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC';
  let deleted = false;
  const mutations: Array<{ method: string; body?: Record<string, unknown> }> = [];
  await page.route('**/api/v1/repos/alice/*', (route) => {
    const method = route.request().method();
    const requested = route.request().url().split('/').pop();
    if (method === 'GET') {
      if (deleted || requested !== name) return route.fulfill({ status: 404, json: { error: { code: 'REPOSITORY_NOT_FOUND' } } });
      return route.fulfill({ json: { repository: { id: 'repo-1', name, description, visibility, status: 'ACTIVE', owner: { username: 'alice' }, defaultBranch: 'main', permissions: { canRead: true, canManage: true } } } });
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      mutations.push({ method, body });
      if (body.name === 'taken') return route.fulfill({ status: 409, json: { error: { code: 'REPOSITORY_NAME_TAKEN' } } });
      if (typeof body.name === 'string') name = body.name;
      if ('description' in body) description = String(body.description ?? '');
      if (body.visibility === 'PUBLIC' || body.visibility === 'PRIVATE') visibility = body.visibility;
      return route.fulfill({ json: { repository: { id: 'repo-1', name, description, visibility, status: 'ACTIVE', owner: { username: 'alice' }, permissions: { canRead: true, canManage: true } } } });
    }
    mutations.push({ method });
    deleted = true;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/alice/my-project');
  await page.getByRole('link', { name: 'Cài đặt' }).click();
  await expect(page).toHaveURL('/alice/my-project/settings');
  await page.getByRole('textbox', { name: 'Tên repository' }).first().fill('taken');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('đã được sử dụng');
  await page.getByRole('textbox', { name: 'Tên repository' }).first().fill('renamed');
  await page.getByRole('textbox', { name: 'Mô tả' }).fill('Updated');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page).toHaveURL('/alice/renamed/settings');
  await page.getByRole('button', { name: 'Đổi quyền xem' }).click();
  await expect(page.getByRole('dialog', { name: 'Xác nhận đổi quyền xem' })).toContainText('người khác sẽ không thể xem');
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy' }).click();
  expect(mutations.filter((entry) => entry.body?.visibility)).toHaveLength(0);
  await page.getByRole('button', { name: 'Đổi quyền xem' }).click();
  await page.getByRole('button', { name: 'Xác nhận đổi quyền xem' }).click();
  await expect(page.getByRole('status')).toContainText('chỉ owner có thể xem');
  await page.getByRole('button', { name: 'Xóa repository', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Xác nhận xóa repository' }).getByRole('button', { name: 'Xác nhận xóa' })).toBeDisabled();
  await page.getByRole('dialog', { name: 'Xác nhận xóa repository' }).getByRole('textbox', { name: 'Tên repository' }).fill('renamed');
  await page.getByRole('button', { name: 'Xác nhận xóa' }).click();
  await expect(page).toHaveURL('/alice?deleted=1');
  await expect(page.getByRole('status')).toContainText('Repository đã được xóa');
  expect(mutations).toEqual([
    { method: 'PATCH', body: { name: 'taken', description: 'Initial description' } },
    { method: 'PATCH', body: { name: 'renamed', description: 'Updated' } },
    { method: 'PATCH', body: { visibility: 'PRIVATE' } },
    { method: 'DELETE' },
  ]);
});

test('repository settings reject visitors without manage permission', async ({ page }) => {
  await anonymous(page);
  await page.route('**/api/v1/repos/alice/hello-world', (route) => route.fulfill({ json: { repository: { id: 'public', name: 'hello-world', owner: { username: 'alice' }, visibility: 'PUBLIC', status: 'ACTIVE', permissions: { canRead: true, canManage: false } } } }));
  await page.goto('/alice/hello-world');
  await expect(page.getByRole('link', { name: 'Cài đặt' })).toHaveCount(0);
  await page.goto('/alice/hello-world/settings');
  await expect(page.getByRole('heading', { name: 'Không thể mở cài đặt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xóa repository' })).toHaveCount(0);
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
