import { BadRequestException } from '@nestjs/common';
import { PullRequestsController } from './pull-requests.controller';
import { RepositoriesController } from './repositories.controller';
import { GitHttpController } from './git-http.controller';
import { ALLOW_DURING_WRITE_FREEZE } from '../release-control/release-write-freeze.decorator';

function expectBadRequest(action: () => unknown, code: string, message: string): void {
  try {
    action();
    throw new Error('Expected the controller to reject the request.');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const exception = error as BadRequestException;
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({ error: { code, message, details: {} } });
  }
}

describe('repository controller query contracts', () => {
  it('keeps Git upload-pack readable during release freeze without exempting receive-pack', () => {
    const upload = Object.getOwnPropertyDescriptor(GitHttpController.prototype, 'upload')?.value as object | undefined;
    const receive = Object.getOwnPropertyDescriptor(GitHttpController.prototype, 'receive')?.value as object | undefined;
    expect(Reflect.getMetadata(ALLOW_DURING_WRITE_FREEZE, upload!)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_DURING_WRITE_FREEZE, receive!)).toBeUndefined();
  });

  it('returns a stable code for an invalid pull-request status', () => {
    const controller = new PullRequestsController({} as never);

    expectBadRequest(
      () => controller.list('owner', 'repo', {} as never, undefined, 'DRAFT'),
      'INVALID_PULL_REQUEST_STATUS',
      'Trạng thái pull request không hợp lệ.',
    );
  });

  it('returns a stable code for an invalid compare summary flag', () => {
    const controller = new PullRequestsController({} as never);

    expectBadRequest(
      () => controller.compare('owner', 'repo', 1, {} as never, 'yes'),
      'INVALID_SUMMARY',
      'summary phải là true hoặc false.',
    );
  });

  it.each([
    ['too-large-search', 'x'.repeat(101), undefined],
    ['invalid-page', undefined, '0'],
  ])('returns a stable code for an invalid public repository list query (%s)', (_caseName, search, page) => {
    const controller = new RepositoriesController({} as never);

    expectBadRequest(
      () => controller.list(search, page),
      'INVALID_REPOSITORY_LIST_QUERY',
      'Tham số tìm kiếm hoặc trang không hợp lệ.',
    );
  });
});
