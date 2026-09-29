import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GitHttpService } from './git-http.service';

@Controller('git/:owner/:repository')
export class GitHttpController {
  constructor(private readonly transport: GitHttpService) {}

  @Get('info/refs')
  advertise(@Param('owner') owner: string, @Param('repository') repository: string, @Req() req: Request, @Res() res: Response) {
    return this.transport.serve(owner, repository, true, req, res);
  }

  @Post('git-upload-pack')
  upload(@Param('owner') owner: string, @Param('repository') repository: string, @Req() req: Request, @Res() res: Response) {
    return this.transport.serve(owner, repository, false, req, res);
  }
}
