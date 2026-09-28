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
  await expect(page.getByRole('heading', { name: 'Branch feature/demo' })).toBeVisible();
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
