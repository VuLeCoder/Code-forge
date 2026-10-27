import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest, AuthPrincipal } from '../auth/auth.types';
import { OriginGuard } from '../auth/origin.guard';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';
import { CreateRepositoryDto, InviteMemberDto, UpdateMemberRoleDto, UpdateRepositoryDto } from './repository.dto';
import { RepositoriesService } from './repositories.service';

@Controller()
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}

  @Get('repositories')
  list(@Query('q') search?: string, @Query('page') rawPage?: string) {
    const page = rawPage === undefined ? 1 : Number(rawPage);
    if ((search !== undefined && (typeof search !== 'string' || search.length > 100)) ||
      !Number.isSafeInteger(page) || page < 1 || page > 1000) {
      throw new BadRequestException({ error: { code: 'INVALID_REPOSITORY_LIST_QUERY', message: 'Tham số tìm kiếm hoặc trang không hợp lệ.', details: {} } });
    }
    return this.repositories.listPublic(search?.trim(), page);
  }

  @Get('repositories/owner/:username')
  @UseGuards(OptionalAccessTokenGuard)
  async listOwner(@Param('username') username: string, @Req() request: Request & { user?: AuthPrincipal }) {
    return this.repositories.listByUsername(username, request.user?.id);
  }

  @Post('repositories')
  @UseGuards(OriginGuard, AccessTokenGuard)
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateRepositoryDto) {
    return this.repositories.create(request.user.id, dto);
  }

  @Get('repositories/deleted')
  @UseGuards(AccessTokenGuard)
  listDeleted(@Req() request: AuthenticatedRequest) {
    return this.repositories.listDeleted(request.user.id);
  }

  @Get('repos/:owner/:repo')
  @UseGuards(OptionalAccessTokenGuard)
  read(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: Request & { user?: AuthPrincipal }) {
    return this.repositories.read(owner, repo, request.user?.id);
  }

  @Patch('repos/:owner/:repo')
  @UseGuards(OriginGuard, AccessTokenGuard)
  update(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: AuthenticatedRequest, @Body() dto: UpdateRepositoryDto) {
    return this.repositories.update(owner, repo, request.user.id, dto);
  }

  @Get('repos/:owner/:repo/branches')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(OptionalAccessTokenGuard)
  branches(@Param('owner') owner: string, @Param('repo') repo: string,
    @Req() request: Request & { user?: AuthPrincipal }) {
    // Read the raw query: ValidationPipe coerces duplicate primitive params to a string.
    return this.repositories.read(owner, repo, request.user?.id, { ref: request.query.ref as string | undefined });
  }

  @Get('repos/:owner/:repo/tree')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(OptionalAccessTokenGuard)
  tree(@Param('owner') owner: string, @Param('repo') repo: string,
    @Req() request: Request & { user?: AuthPrincipal }) {
    return this.repositories.read(owner, repo, request.user?.id, {
      tree: true, ref: request.query.ref as string | undefined, path: request.query.path as string | undefined,
    });
  }

  @Get('repos/:owner/:repo/blob')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(OptionalAccessTokenGuard)
  blob(@Param('owner') owner: string, @Param('repo') repo: string,
    @Req() request: Request & { user?: AuthPrincipal }) {
    return this.repositories.read(owner, repo, request.user?.id, {
      blob: true, ref: request.query.ref as string | undefined, path: request.query.path as string | undefined,
    });
  }

  @Get('repos/:owner/:repo/image')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(OptionalAccessTokenGuard)
  image(@Param('owner') owner: string, @Param('repo') repo: string,
    @Req() request: Request & { user?: AuthPrincipal }) {
    return this.repositories.read(owner, repo, request.user?.id, {
      blob: true, image: true, ref: request.query.ref as string | undefined, path: request.query.path as string | undefined,
    });
  }

  @Get('repos/:owner/:repo/commits')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(OptionalAccessTokenGuard)
  commits(@Param('owner') owner: string, @Param('repo') repo: string,
    @Req() request: Request & { user?: AuthPrincipal }) {
    return this.repositories.read(owner, repo, request.user?.id, {
      commits: true, ref: request.query.ref as string | undefined,
      page: request.query.page as string | undefined, snapshot: request.query.snapshot as string | undefined,
    });
  }

  @Get('repos/:owner/:repo/commits/:sha')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(OptionalAccessTokenGuard)
  commit(@Param('owner') owner: string, @Param('repo') repo: string, @Param('sha') sha: string,
    @Req() request: Request & { user?: AuthPrincipal }) {
    return this.repositories.read(owner, repo, request.user?.id, { sha });
  }

  @Delete('repos/:owner/:repo')
  @HttpCode(204)
  @UseGuards(OriginGuard, AccessTokenGuard)
  remove(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: AuthenticatedRequest) {
    return this.repositories.remove(owner, repo, request.user.id);
  }

  @Post('repos/:owner/:repo/restore')
  @UseGuards(OriginGuard, AccessTokenGuard)
  restore(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: AuthenticatedRequest) {
    return this.repositories.restore(owner, repo, request.user.id);
  }

  @Get('repos/:owner/:repo/members')
  @UseGuards(OriginGuard, AccessTokenGuard)
  listMembers(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: AuthenticatedRequest) {
    return this.repositories.listMembers(owner, repo, request.user.id);
  }

  @Patch('repos/:owner/:repo/members/:userId')
  @UseGuards(OriginGuard, AccessTokenGuard)
  updateMember(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('userId', new ParseUUIDPipe({ version: '4', exceptionFactory: () => new BadRequestException({ error: { code: 'INVALID_ID', message: 'ID không hợp lệ.' } }) })) memberUserId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.repositories.updateMemberRole(owner, repo, request.user.id, memberUserId, dto);
  }

  @Delete('repos/:owner/:repo/members/:userId')
  @HttpCode(204)
  @UseGuards(OriginGuard, AccessTokenGuard)
  removeMember(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('userId', new ParseUUIDPipe({ version: '4', exceptionFactory: () => new BadRequestException({ error: { code: 'INVALID_ID', message: 'ID không hợp lệ.' } }) })) memberUserId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.repositories.removeMember(owner, repo, request.user.id, memberUserId);
  }

  @Post('repos/:owner/:repo/invitations')
  @UseGuards(OriginGuard, AccessTokenGuard)
  inviteMember(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: InviteMemberDto,
  ) {
    return this.repositories.inviteMember(owner, repo, request.user.id, dto);
  }

  @Get('repos/:owner/:repo/invitations')
  @UseGuards(OriginGuard, AccessTokenGuard)
  listInvitations(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: AuthenticatedRequest) {
    return this.repositories.listInvitations(owner, repo, request.user.id);
  }

  @Delete('repos/:owner/:repo/invitations/:invitationId')
  @HttpCode(204)
  @UseGuards(OriginGuard, AccessTokenGuard)
  revokeInvitation(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('invitationId', new ParseUUIDPipe({ version: '4', exceptionFactory: () => new BadRequestException({ error: { code: 'INVALID_ID', message: 'ID không hợp lệ.' } }) })) invitationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.repositories.revokeInvitation(owner, repo, request.user.id, invitationId);
  }
}
