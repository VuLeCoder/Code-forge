import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GitHttpService } from './git-http.service';
import { AllowDuringWriteFreeze } from '../release-control/release-write-freeze.decorator';

@Controller('git/:owner/:repository')
export class GitHttpController {
  constructor(private readonly transport: GitHttpService) {}

  @Get('info/refs')
  advertise(@Param('owner') owner: string, @Param('repository') repository: string, @Req() req: Request, @Res() res: Response) {
    return this.transport.serve(owner, repository, 'advertise', req, res);
  }

  @Post('git-upload-pack')
  @AllowDuringWriteFreeze()
  upload(@Param('owner') owner: string, @Param('repository') repository: string, @Req() req: Request, @Res() res: Response) {
    return this.transport.serve(owner, repository, 'git-upload-pack', req, res);
  }

  @Post('git-receive-pack')
  receive(@Param('owner') owner: string, @Param('repository') repository: string, @Req() req: Request, @Res() res: Response) {
    return this.transport.serve(owner, repository, 'git-receive-pack', req, res);
  }
}
