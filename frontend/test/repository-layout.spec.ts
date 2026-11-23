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
  await expect(page.getByText('đã push', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('complementary').getByRole('link', { name: 'README', exact: true })).toBeVisible();
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

for (const theme of ['light', 'dark']) {
  test(`repository description popup and commit contrast in ${theme}`, async ({ page }) => {
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: { id: 'owner', username: 'alice', role: 'USER' } } }));
    await page.route('**/api/v1/repos/alice/hello-world/branches*', route => route.fulfill({ json: { branches: [{ name: 'main', commitSha: 'a'.repeat(40), isDefault: true }], selectedBranch: { name: 'main', commitSha: 'a'.repeat(40), isDefault: true } } }));
    let description: string | null = 'Mô tả ban đầu';
    let fail = true;
    await page.route('**/api/v1/repos/alice/hello-world', async route => {
      if (route.request().method() === 'PATCH') {
        expect(route.request().postDataJSON()).toEqual({ description: 'Mô tả mới' });
        if (fail) { fail = false; await route.fulfill({ status: 503, json: {} }); return; }
        description = route.request().postDataJSON().description;
      }
      await route.fulfill({ json: { repository: { id: 'public-repo', owner: { username: 'alice' }, name: 'hello-world', description, visibility: 'PUBLIC', defaultBranch: 'main', permissions: { canRead: true, canWrite: true, canManage: true } } } });
    });
    await page.goto('/alice/hello-world');
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const sidebar = page.getByRole('complementary');
    await sidebar.getByRole('button', { name: 'Chỉnh sửa mô tả' }).click();
    const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa giới thiệu' });
    await expect(dialog.getByLabel('Mô tả', { exact: true })).toBeFocused();
    await dialog.getByLabel('Mô tả', { exact: true }).fill('Mô tả mới');
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Không thể lưu');
    await expect(sidebar).toContainText('Mô tả ban đầu');
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(sidebar).toContainText('Mô tả mới');
    await expect(page).toHaveURL(/hello-world$/);
    await sidebar.getByRole('button', { name: 'Chỉnh sửa mô tả' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Chỉnh sửa mô tả' })).toBeFocused();
    const sha = page.getByRole('link').filter({ has: page.locator('code') }).first();
    await expect(sha).toBeVisible();
    const measurements = await sha.evaluate(element => {
      const row = element.parentElement!.parentElement!;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      function rgb(color: string) { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); }
      function luminance(color: string) { const values = rgb(color).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; }
      const background = luminance(getComputedStyle(row).backgroundColor);
      return [...row.querySelectorAll('a, code, time')].map(node => {
        const style = getComputedStyle(node); const foreground = luminance(style.color);
        return { ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), size: parseFloat(style.fontSize) };
      });
    });
    for (const item of measurements) { expect(item.ratio).toBeGreaterThanOrEqual(4.5); expect(item.size).toBeGreaterThanOrEqual(14); }
    await sidebar.getByRole('link', { name: 'README', exact: true }).click();
    await expect(page).toHaveURL(/view=blob.*path=README.md/);
    // Mobile file layout is deferred; retain the overflow check at laptop width.
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.getByRole('region', { name: 'Nội dung file', exact: true }).getByRole('rowheader', { name: '1', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('file navigation stays compact beside tall code and contains long lines', async ({ page }) => {
  await page.route('**/api/v1/auth/*', route => route.fulfill({ status: 401, json: {} }));
  const branch = { name: 'main', commitSha: 'a'.repeat(40), isDefault: true };
  await page.route('**/api/v1/repos/alice/hello-world/branches*', route => route.fulfill({ json: { branches: [branch], selectedBranch: branch } }));
  const content = Array.from({ length: 200 }, () => 'const value = "' + 'x'.repeat(500) + '";').join('\n');
  await page.route('**/api/v1/repos/alice/hello-world/blob?*', route => route.fulfill({ json: { path: 'src/index.ts', size: content.length, objectSha: 'b'.repeat(40), commitSha: 'a'.repeat(40), kind: 'text', content, truncated: false } }));
  await page.goto('/alice/hello-world?view=blob&path=src/index.ts&ref=main');
  const workspace = page.getByRole('region', { name: 'Nội dung file', exact: true });
  await expect(workspace.getByRole('rowheader', { name: '200', exact: true })).toBeAttached();
  const heading = await page.getByRole('heading', { name: 'Tệp dự án' }).first().boundingBox();
  const picker = await page.getByLabel('Branch', { exact: true }).boundingBox();
  const finder = await page.getByRole('combobox', { name: 'Tìm file' }).boundingBox();
  const tree = await workspace.getByRole('complementary').boundingBox();
  expect(picker!.y - (heading!.y + heading!.height)).toBeLessThan(40);
  expect(tree!.y - (finder!.y + finder!.height)).toBeLessThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Thu gọn thanh tệp dự án' }).click();
  await expect(workspace.getByRole('complementary')).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Tìm file' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Mở thanh tệp dự án' }).click();
  await expect(workspace.getByRole('complementary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pusher avatar uses the current account photo and falls back after removal', async ({ page }) => {
  await page.route('**/api/v1/auth/*', route => route.fulfill({ status: 401, json: {} }));
  const branch = { name: 'main', commitSha: 'a'.repeat(40), isDefault: true };
  await page.route('**/api/v1/repos/alice/hello-world/branches*', route => route.fulfill({ json: { branches: [branch], selectedBranch: branch } }));
  const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
  let avatarUrl: string | null = avatar;
  await page.route('**/api/v1/repos/alice/hello-world/overview?*', route => route.fulfill({ json: {
    commit: { sha: branch.commitSha, subject: 'Avatar change', committedAt: '2026-11-23T00:00:00Z' },
    commitCount: 1, update: { username: 'bob', kind: 'PUSH', avatarUrl },
  } }));
  await page.goto('/alice/hello-world');
  const identity = page.locator('span').filter({ has: page.getByRole('link', { name: 'bob', exact: true }) }).filter({ has: page.locator('img') });
  await expect(identity.locator('img')).toHaveAttribute('src', avatar);
  avatarUrl = null;
  await page.reload();
  await expect(page.getByRole('link', { name: 'bob', exact: true })).toBeVisible();
  const fallback = page.getByRole('link', { name: 'bob', exact: true }).locator('..');
  await expect(fallback.locator('img')).toHaveCount(0);
  await expect(fallback).toContainText('B');
});
