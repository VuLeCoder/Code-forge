import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OriginGuard } from '../auth/origin.guard';
import { InvitationsService } from './invitations.service';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @UseGuards(AccessTokenGuard)
  list(@Req() request: AuthenticatedRequest) {
    return this.invitations.list(request.user.id);
  }

  @Post(':id/accept')
  @UseGuards(OriginGuard, AccessTokenGuard)
  accept(
    @Param('id', new ParseUUIDPipe({ version: '4', exceptionFactory: () => new BadRequestException({ error: { code: 'INVALID_ID', message: 'ID không hợp lệ.' } }) })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invitations.accept(request.user.id, id);
  }

  @Post(':id/decline')
  @UseGuards(OriginGuard, AccessTokenGuard)
  decline(
    @Param('id', new ParseUUIDPipe({ version: '4', exceptionFactory: () => new BadRequestException({ error: { code: 'INVALID_ID', message: 'ID không hợp lệ.' } }) })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.invitations.decline(request.user.id, id);
  }
}
