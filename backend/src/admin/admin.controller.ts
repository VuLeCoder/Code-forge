import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OriginGuard } from '../auth/origin.guard';
import { AdminGitJournalListQueryDto, AdminListQueryDto, AdminResolveGitJournalDto, AdminStatusDto } from './admin.dto';
import { AdminGuard } from './admin.guard';
import { AdminGitJournalService } from './admin-git-journal.service';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AccessTokenGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly journals: AdminGitJournalService) {}

  @Get('stats') stats() { return this.admin.stats(); }
  @Get('users') users(@Query() query: AdminListQueryDto) { return this.admin.listUsers(query); }
  @Get('repositories') repositories(@Query() query: AdminListQueryDto) { return this.admin.listRepositories(query); }
  @Get('audit') audit(@Query() query: AdminListQueryDto) { return this.admin.listAudit(query); }
  @Get('git-journals') gitJournals(@Query() query: AdminGitJournalListQueryDto) { return this.journals.list(query); }

  @Post('git-journals/:type/:operationId/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  resolveGitJournal(@Param('type') type: string, @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body() dto: AdminResolveGitJournalDto, @Req() request: AuthenticatedRequest) {
    return this.journals.resolve(request.user.id, type, operationId, dto);
  }

  @Patch('users/:id/status')
  @UseGuards(OriginGuard)
  setUserStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminStatusDto, @Req() request: AuthenticatedRequest) {
    return this.admin.setUserStatus(request.user.id, id, dto.status);
  }

  @Patch('repositories/:id/status')
  @UseGuards(OriginGuard)
  setRepositoryStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminStatusDto, @Req() request: AuthenticatedRequest) {
    return this.admin.setRepositoryStatus(request.user.id, id, dto.status);
  }

  @Post('repositories/:id/restore')
  @UseGuards(OriginGuard)
  restoreRepository(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.admin.restoreRepository(request.user.id, id);
  }
}
