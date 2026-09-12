import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.constants';
import { AccessTokenGuard } from './access-token.guard';
import type { AuthenticatedRequest } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { OriginGuard } from './origin.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Post('register')
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.register(dto);
    this.setCookies(response, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto);
    this.setCookies(response, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    try {
      const result = await this.auth.refresh(request.cookies?.[REFRESH_COOKIE] as string | undefined);
      this.setCookies(response, result.accessToken, result.refreshToken);
      return { user: result.user };
    } catch (error) {
      this.clearCookies(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OriginGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(request.cookies?.[REFRESH_COOKIE] as string | undefined);
    this.clearCookies(response);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@Req() request: AuthenticatedRequest) {
    return {
      user: {
        id: request.user.id,
        username: request.user.username,
        email: request.user.email,
        systemRole: request.user.systemRole,
        status: request.user.status,
        createdAt: request.user.createdAt,
      },
    };
  }

  private setCookies(response: Response, accessToken: string, refreshToken: string): void {
    const secure = this.config.getOrThrow<boolean>('COOKIE_SECURE');
    const sameSite = this.config.getOrThrow<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE');
    response.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      maxAge: this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS') * 1000,
    });
    response.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api/v1/auth',
      maxAge: this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
    });
  }

  private clearCookies(response: Response): void {
    const options = {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: this.config.getOrThrow<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE'),
    };
    response.clearCookie(ACCESS_COOKIE, { ...options, path: '/' });
    response.clearCookie(REFRESH_COOKIE, { ...options, path: '/api/v1/auth' });
  }
}
