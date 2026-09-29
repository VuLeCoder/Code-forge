import { expect, test } from '@playwright/test';

test('M3.5 paginates through proxy, opens direct commit URLs and parents, preserves branch and fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref') ?? 'main';
    const branches = ['main', 'feature/demo'].map((name) => ({ name, commitSha: 'a'.repeat(40), isDefault: name === 'main' }));
    return route.fulfill({ json: { branches, selectedBranch: branches.find((branch) => branch.name === ref) } });
  });
  await page.goto('/alice/hello-world?ref=feature%2Fdemo');
  await page.getByRole('navigation', { name: 'Nội dung repository' }).getByRole('link', { name: 'Lịch sử commit' }).click();
  const history = page.getByRole('region', { name: 'Lịch sử commit', exact: true });
  await expect(history.getByRole('listitem')).toHaveCount(20);
  await history.getByRole('link', { name: 'Trang sau' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(page).toHaveURL(/page=2&snapshot=/);
  await page.reload();
  await expect(history.getByRole('link', { name: 'Commit 1', exact: true })).toBeVisible();
  await history.getByRole('link', { name: 'Trang trước' }).click();
  await history.getByRole('link', { name: 'Commit 21', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Chi tiết commit', exact: true });
  await expect(detail.getByRole('heading', { name: 'Commit 21', exact: true })).toBeVisible();
  await expect(detail.getByText('Tác giả ü <author@example.test>', { exact: true })).toBeVisible();
  await expect(detail.getByText('Committer <committer@example.test>', { exact: true })).toBeVisible();
  await expect(detail.locator('time').first()).toContainText('UTC');
  await expect(detail.locator('pre')).toContainText('<script>window.commitExecuted = true</script>');
  expect(await page.evaluate(() => 'commitExecuted' in window)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await detail.getByRole('link', { name: '14'.padStart(40, '0'), exact: true }).click();
  await expect(detail.getByRole('heading', { name: 'Commit 20', exact: true })).toBeVisible();
  await page.goBack();
  await expect(detail.getByRole('heading', { name: 'Commit 21', exact: true })).toBeVisible();
  await detail.getByRole('link', { name: '← Về lịch sử commit' }).click();
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue('feature/demo');
  await page.getByLabel('Branch', { exact: true }).selectOption('main');
  await expect(page).toHaveURL(/\?ref=main&view=commits$/);
  await expect(history.getByRole('listitem')).toHaveCount(20);
  const response = await page.request.get('/api/v1/repos/alice/hello-world/commits?page=1&page=2');
  expect(response.status()).toBe(400);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect((await page.request.get('/api/v1/repos/alice/hello-world/commits?ref=a&ref=b')).status()).toBe(400);
  expect((await page.request.get('/api/v1/repos/alice/hello-world/commits?snapshot=a&snapshot=b')).status()).toBe(400);
  const commitResponse = await page.request.get(`/api/v1/repos/alice/hello-world/commits/${'1'.padStart(40, '0')}`);
  expect(commitResponse.status()).toBe(200);
  expect(commitResponse.headers()['cache-control']).toBe('private, no-store');
  await page.goto(`/alice/hello-world?view=commit&sha=${'1'.padStart(40, '0')}`);
  await expect(detail.getByText('Commit đầu tiên, không có commit cha.')).toBeVisible();
});

test('M3.5 handles malformed and missing SHA, invalid page, empty/reset history and retry', async ({ page }) => {
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  const detail = page.getByRole('region', { name: 'Chi tiết commit', exact: true });
  for (const [sha, text] of [['bad', 'SHA commit không hợp lệ'], ['f'.repeat(40), 'Commit không tồn tại']]) {
    await page.goto(`/alice/hello-world?view=commit&sha=${sha}`);
    await expect(detail.getByRole('alert')).toContainText(text);
  }
  await page.goto('/alice/hello-world?view=commits&page=0');
  const history = page.getByRole('region', { name: 'Lịch sử commit', exact: true });
  await expect(history.getByRole('alert')).toContainText('Trang lịch sử phải');
  await page.goto('/alice/hello-world?view=commits&page=3');
  await expect(history.getByText('Trang này không có commit.')).toBeVisible();
  await page.route('**/api/v1/repos/alice/hello-world/commits?**', (route) => route.fulfill({ json: { commits: [], page: 1000, hasMore: true, snapshot: 'a'.repeat(40), storageState: 'READY' } }));
  await page.goto('/alice/hello-world?view=commits&page=1000');
  await expect(history.getByText('Đã đạt giới hạn 1.000 trang.', { exact: false })).toBeVisible();
  await expect(history.getByRole('link', { name: 'Trang sau' })).toHaveCount(0);
  await page.unroute('**/api/v1/repos/alice/hello-world/commits?**');
  for (const state of ['EMPTY', 'RESET']) {
    await page.route('**/api/v1/repos/alice/hello-world/commits?**', (route) => route.fulfill({ json: { commits: [], page: 1, hasMore: false, snapshot: null, storageState: state } }));
    await page.goto('/alice/hello-world?view=commits');
    await expect(history.getByText('Chưa có commit trên branch này.')).toBeVisible();
    if (state === 'RESET') await expect(history.getByText('Git storage đã được khởi tạo lại;', { exact: false })).toBeVisible();
    await page.unroute('**/api/v1/repos/alice/hello-world/commits?**');
  }
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/repos/alice/hello-world/commits/*', async (route) => { await pending; await route.fulfill({ status: 503, json: {} }); });
  await page.goto(`/alice/hello-world?view=commit&sha=${'1'.padStart(40, '0')}`);
  await expect(detail.getByRole('status')).toContainText('Đang tải commit');
  release();
  await expect(detail.getByRole('alert')).toContainText('Chưa thể tải commit');
  await page.unroute('**/api/v1/repos/alice/hello-world/commits/*');
  await detail.getByRole('button', { name: 'Tải lại commit' }).click();
  await expect(detail.getByRole('heading', { name: 'Commit 1', exact: true })).toBeVisible();
});

test('M3.4 renders branch README, GFM, safe links/images and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref') ?? 'main';
    const branches = ['main', 'feature/demo'].map((name) => ({ name, commitSha: 'a'.repeat(40), isDefault: name === 'main' }));
    return route.fulfill({ json: { branches, selectedBranch: branches.find((branch) => branch.name === ref) } });
  });
  await page.route('**/api/v1/repos/alice/hello-world/blob?**', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref');
    return route.fulfill({ json: { kind: 'text', content: `# README ${ref}\n\n## Usage\n\n**Bold** and *emphasis*\n\n- [x] Done\n\n| A | B |\n| - | - |\n| one | two |\n\n\`\`\`js\n${'long '.repeat(150)}\n\`\`\`\n\n[Source](src%20%23%20%C3%BC/hello%20%26%20%C3%BC.ts) [Folder](src%20%23%20%C3%BC/) [Anchor](#usage) [External](https://example.com)\n\n![Logo](logo.png) ![Missing](missing.png)\n\n<script>window.readmeXss=true</script>\n\n<img src=x onerror="window.readmeXss=true">\n\n[Bad](javascript:alert%281%29) [Encoded](java&#x73;cript:alert%281%29) [Escape](../../secret) ![Bad image](data:image/svg+xml,test)\n`, path: 'README.md', size: 2048, truncated: false } });
  });
  await page.goto('/alice/hello-world');
  const readme = page.getByRole('region', { name: 'README', exact: true });
  await expect(readme.getByRole('heading', { name: 'README main' })).toBeVisible();
  await expect(readme.locator('strong').filter({ hasText: /^Bold$/ })).toBeVisible();
  await expect(readme.getByRole('checkbox')).toBeChecked();
  await expect(readme.getByRole('table')).toBeVisible();
  await expect(readme.getByRole('img', { name: 'Logo', exact: true })).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(readme.getByText(/Không thể hiển thị ảnh: Missing/)).toBeVisible();
  for (const name of ['Bad', 'Encoded', 'Escape']) await expect(readme.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(readme.locator('script, iframe, img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => 'readmeXss' in window)).toBe(false);
  await expect(readme.getByRole('link', { name: 'External' })).toHaveAttribute('rel', 'noopener noreferrer');
  await readme.getByRole('link', { name: 'Anchor' }).click();
  await expect(page).toHaveURL(/#readme-usage$/);
  await expect(readme.locator('#readme-usage')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Branch', { exact: true }).selectOption('feature/demo');
  await expect(readme.getByRole('heading', { name: 'README feature/demo' })).toBeVisible();
  await expect(readme.getByRole('heading', { name: 'README main' })).toHaveCount(0);
  await page.reload();
  await expect(readme.getByRole('heading', { name: 'README feature/demo' })).toBeVisible();
  await expect(readme.getByRole('link', { name: 'Source', exact: true })).toHaveAttribute('href', /ref=feature%2Fdemo&path=src\+%23\+%C3%BC%2Fhello\+%26\+%C3%BC.ts&view=blob/);
  await readme.getByRole('link', { name: 'Folder', exact: true }).click();
  await expect(page.getByRole('link', { name: 'hello & ü.ts', exact: true })).toBeVisible();
  const imageResponse = await page.request.get('/api/v1/repos/alice/hello-world/image?ref=feature%2Fdemo&path=logo.png');
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()['cache-control']).toBe('private, no-store');
  expect((await page.request.get('/api/v1/repos/alice/hello-world/image?path=a&path=b')).status()).toBe(400);
});

test('M3.4 handles missing, empty, binary, large, truncated, loading and retry README', async ({ page }) => {
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  const branch = { name: 'main', commitSha: 'a'.repeat(40), isDefault: true };
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => route.fulfill({ json: { branches: [branch], selectedBranch: branch } }));
  let state = 'empty';
  await page.route('**/api/v1/repos/alice/hello-world/blob?**', (route) => route.fulfill(state === 'missing' ? { status: 404, json: { error: { code: 'PATH_NOT_FOUND' } } } : state === 'error' ? { status: 503, json: {} } : { json: { kind: state === 'binary' || state === 'large' ? state : 'text', content: state === 'empty' ? '' : '# Preview', truncated: state === 'truncated' } }));
  const readme = page.getByRole('region', { name: 'README', exact: true });
  for (const [next, message] of [['empty', 'README trống.'], ['binary', 'README là file nhị phân'], ['large', 'README vượt giới hạn'], ['truncated', 'README đã được cắt'], ['missing', 'README không còn tồn tại'], ['error', 'Chưa thể tải README.']]) {
    state = next;
    await page.goto('/alice/hello-world');
    await expect(readme.getByText(message, { exact: false })).toBeVisible();
  }
  state = 'text';
  await readme.getByRole('button', { name: 'Tải lại README' }).click();
  await expect(readme.getByRole('heading', { name: 'Preview' })).toBeVisible();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/repos/alice/hello-world/blob?**', async (route) => { await pending; await route.fulfill({ json: { kind: 'text', content: '# Loaded' } }); });
  await page.reload();
  await expect(readme.getByRole('status')).toContainText('Đang tải README');
  release();
  await expect(readme.getByRole('heading', { name: 'Loaded' })).toBeVisible();
  await page.goto('/alice/hello-world?path=src%20%23%20%C3%BC');
  await expect(page.getByText('Thư mục này chưa có README.')).toBeVisible();
});

test('M3.4 discovers nested case-insensitive README and resolves parent image and source links', async ({ page }) => {
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  const branch = { name: 'feature/demo', commitSha: 'a'.repeat(40), isDefault: false };
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => route.fulfill({ json: { branches: [branch], selectedBranch: branch } }));
  await page.route('**/api/v1/repos/alice/hello-world/tree?**', (route) => route.fulfill({ json: { storageState: 'READY', entries: [{ name: 'ReadMe.MD', path: 'docs/ReadMe.MD', type: 'file', navigable: true }] } }));
  await page.route('**/api/v1/repos/alice/hello-world/blob?**', (route) => {
    expect(new URL(route.request().url()).searchParams.get('path')).toBe('docs/ReadMe.MD');
    return route.fulfill({ json: { kind: 'text', content: '# Nested\n\n![Parent logo](../logo.png)\n\n[Root](../) [File](../code.ts) [Invalid](%2e%2e/%2e%2e/secret)' } });
  });
  await page.goto('/alice/hello-world?ref=feature%2Fdemo&path=docs');
  const readme = page.getByRole('region', { name: 'README', exact: true });
  await expect(readme.getByRole('heading', { name: 'Nested' })).toBeVisible();
  await expect(readme.getByRole('img', { name: 'Parent logo' })).toHaveAttribute('src', /^data:image\/png/);
  await expect(readme.getByRole('link', { name: 'Root', exact: true })).toHaveAttribute('href', '/alice/hello-world?ref=feature%2Fdemo');
  await expect(readme.getByRole('link', { name: 'File', exact: true })).toHaveAttribute('href', '/alice/hello-world?ref=feature%2Fdemo&path=code.ts&view=blob');
  await expect(readme.getByRole('link', { name: 'Invalid' })).toHaveCount(0);
});

test('M3.3 opens files through proxy with safe code, line numbers, URL and mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref') ?? 'main';
    const branches = ['main', 'feature/demo'].map((name) => ({ name, commitSha: 'a'.repeat(40), isDefault: name === 'main' }));
    return route.fulfill({ json: { branches, selectedBranch: branches.find((branch) => branch.name === ref), defaultBranch: 'main' } });
  });
  await page.goto('/alice/hello-world?ref=feature%2Fdemo&path=src+%23+%C3%BC');
  await page.getByRole('link', { name: 'hello & ü.ts', exact: true }).click();
  const viewer = page.getByRole('region', { name: 'Nội dung file', exact: true });
  await expect(viewer.getByRole('rowheader', { name: '3', exact: true })).toBeVisible();
  await expect(viewer.getByText('feature/demo', { exact: true })).toBeVisible();
  await expect(viewer.getByText('<script>window.sourceExecuted = true</script>', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => 'sourceExecuted' in window)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(viewer.getByRole('rowheader', { name: '1', exact: true })).toBeVisible();
  await viewer.getByRole('link', { name: '← Thư mục cha' }).click();
  await expect(page.getByRole('link', { name: 'hello & ü.ts', exact: true })).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeVisible();
  await page.getByLabel('Branch', { exact: true }).selectOption('main');
  await expect(page).toHaveURL(/\?ref=main$/);
  await page.getByRole('link', { name: 'README.md', exact: true }).click();
  await expect(viewer.getByText('main', { exact: true })).toBeVisible();
  const response = await page.request.get('/api/v1/repos/alice/hello-world/blob?path=a&path=b');
  expect(response.status()).toBe(400);
  expect(response.headers()['cache-control']).toBe('private, no-store');
});

test('M3.3 displays empty, binary, large, truncated, missing and retry states', async ({ page }) => {
  await page.route('**/api/v1/auth/*', (route) => route.fulfill({ status: 401, json: {} }));
  const branch = { name: 'main', commitSha: 'a'.repeat(40), isDefault: true };
  await page.route('**/api/v1/repos/alice/hello-world/branches*', (route) => route.fulfill({ json: { branches: [branch], selectedBranch: branch, defaultBranch: 'main' } }));
  const viewer = page.getByRole('region', { name: 'Nội dung file', exact: true });
  for (const [path, text] of [['empty', 'File trống.'], ['binary', 'File nhị phân'], ['large', 'File vượt giới hạn'], ['truncated', 'bản xem trước đã cắt'], ['missing', 'Đường dẫn không tồn tại']]) {
    await page.goto(`/alice/hello-world?view=blob&path=${path}`);
    await expect(viewer.getByText(text, { exact: false })).toBeVisible();
  }
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/repos/alice/hello-world/blob?**', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: { code: 'GIT_READ_UNAVAILABLE' } } });
  });
  await page.goto('/alice/hello-world?view=blob&path=README.md');
  await expect(viewer.getByRole('status')).toContainText('Đang tải file');
  release();
  await expect(viewer.getByRole('alert')).toContainText('Chưa thể tải');
  await page.unroute('**/api/v1/repos/alice/hello-world/blob?**');
  await viewer.getByRole('button', { name: 'Tải lại file' }).click();
  await expect(viewer.getByRole('rowheader', { name: '1', exact: true })).toBeVisible();
});

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
