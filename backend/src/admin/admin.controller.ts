import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OriginGuard } from '../auth/origin.guard';
import { AdminListQueryDto, AdminResolveOperationDto, AdminStatusDto, AdminUnresolvedQueryDto } from './admin.dto';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AccessTokenGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats') stats() { return this.admin.stats(); }
  @Get('users') users(@Query() query: AdminListQueryDto) { return this.admin.listUsers(query); }
  @Get('repositories') repositories(@Query() query: AdminListQueryDto) { return this.admin.listRepositories(query); }
  @Get('audit') audit(@Query() query: AdminListQueryDto) { return this.admin.listAudit(query); }

  @Get('operations/unresolved')
  listUnresolvedOperations(@Query() query: AdminUnresolvedQueryDto) {
    return this.admin.listUnresolvedOperations(query);
  }

  @Get('operations/:id')
  getOperationDetails(@Param('id', ParseUUIDPipe) id: string, @Query('type') type?: string) {
    return this.admin.getOperationDetails(id, type);
  }

  @Post('operations/:id/resolve')
  @UseGuards(OriginGuard)
  resolveOperation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminResolveOperationDto, @Req() request: AuthenticatedRequest) {
    return this.admin.resolveOperation(request.user.id, id, dto);
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
