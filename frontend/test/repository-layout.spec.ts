import { expect, test } from '@playwright/test';

test('repository toolbar, push identity, file finder, about sidebar and guide', async ({ page }) => {
  await page.route('**/api/v1/auth/*', route => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/repos/alice/hello-world/branches*', route => route.fulfill({ json: {
    branches: [{ name: 'main', commitSha: 'a'.repeat(40), isDefault: true }],
    selectedBranch: { name: 'main', commitSha: 'a'.repeat(40), isDefault: true },
  } }));
  await page.goto('/alice/hello-world');
  await expect(page.getByRole('complementary').getByRole('heading', { name: 'Giới thiệu' })).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText('Repository thử nghiệm');
  await expect(page.getByText('đã push', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: '21 commit', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bắt đầu với repository này' })).toHaveCount(0);
  const sidebar = await page.getByRole('complementary').boundingBox();
  const tree = await page.getByRole('region', { name: 'Cây thư mục' }).boundingBox();
  const branch = await page.getByLabel('Branch', { exact: true }).boundingBox();
  expect(sidebar!.x).toBeGreaterThan(tree!.x + tree!.width);
  expect(Math.abs(sidebar!.y - branch!.y)).toBeLessThan(2);
  await page.keyboard.press('t');
  await expect(page.getByRole('combobox', { name: 'Tìm file' })).toBeFocused();
  await page.getByRole('combobox', { name: 'Tìm file' }).fill('src');
  await expect(page.getByRole('option', { name: 'src/index.ts' })).toBeVisible();
  await page.getByRole('option', { name: 'src/index.ts' }).click();
  await expect(page).toHaveURL(/view=blob/);
  await page.getByRole('link', { name: 'Hướng dẫn', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Bắt đầu với repository này' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Điều hướng repository' }).getByRole('link', { name: 'Hướng dẫn', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('navigation', { name: 'Điều hướng repository' }).getByRole('link', { name: 'Mã nguồn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Code', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
