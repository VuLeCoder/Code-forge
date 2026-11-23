import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`commit per-file diffs, filtering and responsive layout in ${theme}`, async ({ page }) => {
    await page.route('**/api/v1/auth/*', route => route.fulfill({ status: 401, json: {} }));
    const sha = 'a'.repeat(40);
    await page.route('**/api/v1/repos/alice/hello-world/commits/*', route => route.fulfill({ json: { commit: {
      sha, parentShas: ['b'.repeat(40)], subject: 'Update files', message: 'Update files',
      author: { name: 'Alice', email: 'alice@example.test' }, committer: { name: 'Alice', email: 'alice@example.test' },
      authoredAt: '2026-11-23T00:00:00Z', committedAt: '2026-11-23T00:00:00Z',
      changes: { baseSha: 'b'.repeat(40), status: 'READY', files: [
        { path: 'src/main.ts', status: 'M', diffStatus: 'TEXT', diff: 'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -4,2 +4,2 @@\n-old value\n+' + 'new value '.repeat(100) + '\n context\n' },
        { path: 'renamed.txt', previousPath: 'old.txt', status: 'R', diffStatus: 'TEXT', diff: '' },
        { path: 'image.png', status: 'A', diffStatus: 'BINARY' },
        { path: 'large.txt', status: 'A', diffStatus: 'TRUNCATED' },
        { path: 'later.txt', status: 'A', diffStatus: 'UNAVAILABLE' },
      ] },
    } } }));
    await page.goto(`/alice/hello-world?view=commit&sha=${sha}`);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const commit = page.getByRole('region', { name: 'Chi tiết commit', exact: true });
    await expect(commit.getByText('Người ghi commit', { exact: true })).toBeHidden();
    await expect(commit.getByText('Thời gian commit', { exact: true })).toBeHidden();
    await commit.getByText('Thông tin chi tiết', { exact: true }).click();
    await expect(commit.getByText('Người ghi commit', { exact: true })).toBeVisible();
    await expect(commit.getByText(sha, { exact: true })).toBeVisible();
    await expect(commit.getByRole('link', { name: 'b'.repeat(40), exact: true })).toBeVisible();
    await commit.getByText('Thông tin chi tiết', { exact: true }).click();
    const changes = page.getByRole('region', { name: 'Thay đổi trong commit', exact: true });
    await expect(changes.getByRole('heading', { name: '5 file thay đổi' })).toBeVisible();
    const diff = changes.getByRole('region', { name: 'Diff của src/main.ts' });
    await expect(diff).toBeVisible();
    const removed = diff.getByRole('row').filter({ hasText: '-old value' });
    await expect(removed.getByRole('cell').nth(0)).toHaveText('4');
    await expect(removed.getByRole('cell').nth(1)).toBeEmpty();
    const added = diff.getByRole('row').filter({ hasText: '+new value' });
    await expect(added.getByRole('cell').nth(1)).toHaveText('4');
    await expect(diff.getByRole('row').filter({ hasText: ' context' }).getByRole('cell').nth(0)).toHaveText('5');
    await expect(changes.getByText('File nhị phân: không hiển thị diff văn bản.')).toBeVisible();
    await expect(changes.getByText('Diff vượt giới hạn hiển thị.', { exact: false })).toBeVisible();
    await changes.locator('summary').filter({ hasText: 'src/main.ts' }).click();
    await expect(diff).toBeHidden();
    await changes.locator('summary').filter({ hasText: 'src/main.ts' }).click();
    await expect(diff).toBeVisible();
    const filter = changes.getByRole('searchbox', { name: 'Lọc file' });
    await filter.fill('old.txt');
    await expect(changes.locator('details')).toHaveCount(1);
    await expect(changes.locator('summary')).toContainText('old.txt → renamed.txt');
    await filter.fill('does-not-exist');
    await expect(changes.getByRole('status')).toHaveText('Không có file phù hợp.');
    await filter.fill('');
    await changes.getByRole('navigation').getByRole('link').filter({ hasText: 'image.png' }).click();
    await expect(page).toHaveURL(/#commit-change-2$/);
    await page.screenshot({ path: `/tmp/commit-changes-${theme}-desktop.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/commit-changes-${theme}.png`, fullPage: true });
  });
}

for (const scenario of [
  { name: 'different committer', differentPerson: true, differentTime: false },
  { name: 'different commit time', differentPerson: false, differentTime: true },
  { name: 'different committer and time', differentPerson: true, differentTime: true },
]) {
  test(`commit summary shows ${scenario.name}`, async ({ page }) => {
    const sha = 'c'.repeat(40);
    await page.route('**/api/v1/auth/*', route => route.fulfill({ status: 401, json: {} }));
    await page.route('**/api/v1/repos/alice/hello-world/commits/*', route => route.fulfill({ json: { commit: {
      sha, parentShas: [], subject: 'Apply change', message: 'Apply change',
      author: { name: 'Alice', email: 'alice@example.test' },
      committer: { name: 'Alice', email: scenario.differentPerson ? 'other@example.test' : 'alice@example.test' },
      authoredAt: '2026-11-23T00:00:00Z',
      committedAt: scenario.differentTime ? '2026-11-23T01:00:00Z' : '2026-11-23T00:00:00+00:00',
    } } }));
    await page.goto(`/alice/hello-world?view=commit&sha=${sha}`);
    const commit = page.getByRole('region', { name: 'Chi tiết commit', exact: true });
    await expect(commit.getByRole('heading', { name: 'Apply change' })).toBeVisible();
    const summary = commit.locator(':scope > dl');
    await expect(summary.getByText('Người ghi commit', { exact: true })).toHaveCount(scenario.differentPerson ? 1 : 0);
    await expect(summary.getByText('Thời gian commit', { exact: true })).toHaveCount(scenario.differentTime ? 1 : 0);
    await commit.getByText('Thông tin chi tiết', { exact: true }).click();
    await expect(commit.getByText('Commit đầu tiên, không có commit cha.')).toBeVisible();
    await expect(commit.locator('details').getByText('Người ghi commit', { exact: true })).toBeVisible();
    await expect(commit.locator('details').getByText('Thời gian commit', { exact: true })).toBeVisible();
  });
}
