import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CreateTokenDto } from './token.dto';
import { TokensService } from './tokens.service';

@Controller('tokens')
@UseGuards(AccessTokenGuard)
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Req() req: AuthenticatedRequest) { return this.tokens.list(req.user.id); }

  @Post()
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'private, no-store')
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTokenDto) { return this.tokens.create(req.user.id, dto); }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  @Header('Cache-Control', 'private, no-store')
  revoke(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.tokens.revoke(req.user.id, id); }
}
