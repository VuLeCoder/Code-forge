import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { PullRequestStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest, AuthPrincipal } from '../auth/auth.types';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';
import { CreatePullRequestDto, MergePullRequestDto, UpdatePullRequestDto } from './pull-request.dto';
import { PullRequestsService } from './pull-requests.service';

@Controller('repos/:owner/:repo/pulls')
export class PullRequestsController {
  constructor(private readonly pulls: PullRequestsService) {}

  @Get()
  @UseGuards(OptionalAccessTokenGuard)
  list(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: Request & { user?: AuthPrincipal },
    @Query('page') page?: string, @Query('status') status?: string) {
    if (status !== undefined && !['OPEN', 'CLOSED', 'MERGED'].includes(status)) throw new BadRequestException('Trạng thái pull request không hợp lệ.');
    return this.pulls.list(owner, repo, request.user?.id, page, status as PullRequestStatus | undefined);
  }

  @Post()
  @UseGuards(OriginGuard, AccessTokenGuard)
  create(@Param('owner') owner: string, @Param('repo') repo: string, @Req() request: AuthenticatedRequest, @Body() dto: CreatePullRequestDto) {
    return this.pulls.create(owner, repo, request.user.id, dto);
  }

  @Get(':number')
  @UseGuards(OptionalAccessTokenGuard)
  detail(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number', ParseIntPipe) number: number,
    @Req() request: Request & { user?: AuthPrincipal }) {
    return this.pulls.detail(owner, repo, request.user?.id, number);
  }

  @Get(':number/compare')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalAccessTokenGuard)
  compare(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number', ParseIntPipe) number: number,
    @Req() request: Request & { user?: AuthPrincipal }, @Query('summary') summary?: string) {
    if (summary !== undefined && summary !== 'true' && summary !== 'false') throw new BadRequestException('summary phải là true hoặc false.');
    return this.pulls.compare(owner, repo, request.user?.id, number, summary === 'true');
  }

  @Get(':number/commits')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalAccessTokenGuard)
  compareCommits(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number', ParseIntPipe) number: number,
    @Req() request: Request & { user?: AuthPrincipal }, @Query('sourceSha') sourceSha?: string,
    @Query('targetSha') targetSha?: string, @Query('storageGeneration') storageGeneration?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.pulls.comparePage(owner, repo, request.user?.id, number, 'commits', { sourceSha, targetSha, storageGeneration, page, pageSize });
  }

  @Get(':number/files')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalAccessTokenGuard)
  compareFiles(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number', ParseIntPipe) number: number,
    @Req() request: Request & { user?: AuthPrincipal }, @Query('sourceSha') sourceSha?: string,
    @Query('targetSha') targetSha?: string, @Query('storageGeneration') storageGeneration?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.pulls.comparePage(owner, repo, request.user?.id, number, 'files', { sourceSha, targetSha, storageGeneration, page, pageSize });
  }

  @Get(':number/diff')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(OptionalAccessTokenGuard)
  compareDiff(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number', ParseIntPipe) number: number,
    @Req() request: Request & { user?: AuthPrincipal }, @Query('sourceSha') sourceSha?: string,
    @Query('targetSha') targetSha?: string, @Query('storageGeneration') storageGeneration?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.pulls.comparePage(owner, repo, request.user?.id, number, 'diff', { sourceSha, targetSha, storageGeneration, page, pageSize });
  }

  @Patch(':number')
  @UseGuards(OriginGuard, AccessTokenGuard)
  update(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number', ParseIntPipe) number: number,
    @Req() request: AuthenticatedRequest, @Body() dto: UpdatePullRequestDto) {
    return this.pulls.update(owner, repo, request.user.id, number, dto);
  }

  @Post(':number/merge')
  @HttpCode(200)
  @UseGuards(OriginGuard, AccessTokenGuard)
  async merge(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number', ParseIntPipe) number: number,
    @Req() request: AuthenticatedRequest, @Body() dto: MergePullRequestDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.pulls.merge(owner, repo, request.user.id, number, dto);
    if (result.status === 'RECONCILING') response.status(202);
    return result;
  }
}
