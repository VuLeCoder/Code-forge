import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest, AuthPrincipal } from '../auth/auth.types';
import { OriginGuard } from '../auth/origin.guard';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';
import { CreateRepositoryDto, UpdateRepositoryDto } from './repository.dto';
import { RepositoriesService } from './repositories.service';

@Controller()
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}

  @Get('repositories')
  list(@Query('q') search?: string, @Query('page') rawPage?: string) {
    const page = rawPage === undefined ? 1 : Number(rawPage);
    if ((search !== undefined && (typeof search !== 'string' || search.length > 100)) ||
      !Number.isSafeInteger(page) || page < 1 || page > 1000) {
      throw new BadRequestException('Tham số tìm kiếm hoặc trang không hợp lệ.');
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
}
