import { expect, test } from '@playwright/test';

test('M3.1 selects branches, persists URL, handles missing ref and fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref') ?? 'main';
    const branches = [
      { name: 'main', commitSha: 'a'.repeat(40), isDefault: true },
      { name: 'feature/demo', commitSha: 'b'.repeat(40), isDefault: false },
    ];
    const selectedBranch = branches.find((branch) => branch.name === ref);
    return route.fulfill(selectedBranch ? { json: { branches, selectedBranch, defaultBranch: 'main', storageState: 'READY' } } : { status: 404, json: { error: { code: 'REF_NOT_FOUND' } } });
  });
  await page.goto('/alice/hello-world');
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main');
  await page.getByLabel('Branch', { exact: true }).selectOption('feature/demo');
  await expect(page).toHaveURL(/ref=feature%2Fdemo/);
  await expect(page.getByRole('region', { name: 'Cây thư mục' }).getByText('README.md', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('feature/demo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/alice/hello-world?ref=missing');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Branch không tồn tại');
  await page.getByRole('button', { name: 'Về nhánh mặc định' }).click();
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('main');
});

test('M3.1 branch proxy renders empty state', async ({ page }) => {
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/alice/hello-world');
  await expect(page.getByLabel('Branch', { exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Repository chưa có mã nguồn' })).toBeVisible();
});

test('M3.2 navigates tree URLs, breadcrumbs, parent and history through the Next proxy', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref') ?? 'main';
    const branches = ['main', 'feature/demo'].map((name) => ({ name, commitSha: 'a'.repeat(40), isDefault: name === 'main' }));
    return route.fulfill({ json: { branches, selectedBranch: branches.find((branch) => branch.name === ref), defaultBranch: 'main', storageState: 'READY' } });
  });
  await page.goto('/alice/hello-world?ref=feature%2Fdemo&path=src+%23+%C3%BC');
  const tree = page.getByRole('region', { name: 'Cây thư mục' });
  await expect(tree.getByText('hello & ü.ts', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('feature/demo');
  await tree.getByRole('link', { name: 'nested/' }).click();
  await expect(tree.getByText('Thư mục chưa có nội dung.')).toBeVisible();
  await page.reload();
  await expect(tree.getByText('Thư mục chưa có nội dung.')).toBeVisible();
  await tree.getByRole('link', { name: '← Thư mục cha' }).click();
  await expect(tree.getByText('hello & ü.ts', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(tree.getByText('Thư mục chưa có nội dung.')).toBeVisible();
  await tree.getByRole('navigation').getByRole('link', { name: 'src # ü' }).click();
  await expect(tree.getByText('hello & ü.ts', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Branch', { exact: true }).selectOption('main');
  await expect(page).toHaveURL(/\?ref=main$/);
  await expect(tree.getByRole('link', { name: 'src # ü/' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'link', exact: true })).toHaveCount(0);
  const response = await page.request.get('/api/v1/repos/alice/hello-world/tree?path=a&path=b');
  expect(response.status()).toBe(400);
  expect(response.headers()['cache-control']).toBe('private, no-store');
});

test('M3.2 handles missing paths, retry and loading', async ({ page }) => {
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  const branch = { name: 'main', commitSha: 'a'.repeat(40), isDefault: true };
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => route.fulfill({ json: { branches: [branch], selectedBranch: branch, defaultBranch: 'main' } }));
  await page.goto('/alice/hello-world?path=missing');
  const tree = page.getByRole('region', { name: 'Cây thư mục' });
  await expect(tree.getByRole('alert')).toContainText('Đường dẫn không tồn tại');
  await tree.getByRole('link', { name: 'Về thư mục gốc' }).click();
  await expect(tree.getByRole('link', { name: 'src # ü/' })).toBeVisible();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/repos/alice/hello-world/tree?**', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: { code: 'GIT_READ_UNAVAILABLE' } } });
  });
  await tree.getByRole('link', { name: 'src # ü/' }).click();
  await expect(tree.getByRole('status')).toContainText('Đang tải');
  release();
  await expect(tree.getByRole('alert')).toContainText('Chưa thể tải');
  await page.unroute('**/api/v1/repos/alice/hello-world/tree?**');
  await tree.getByRole('button', { name: 'Tải lại thư mục' }).click();
  await expect(tree.getByText('hello & ü.ts', { exact: true })).toBeVisible();
});
