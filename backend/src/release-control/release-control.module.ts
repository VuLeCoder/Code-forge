import { Global, Module } from '@nestjs/common';
import { ReleaseWriteFreezeGuard } from './release-write-freeze.guard';
import { ReleaseWriteFreezeService } from './release-write-freeze.service';

@Global()
@Module({
  providers: [ReleaseWriteFreezeService, ReleaseWriteFreezeGuard],
  exports: [ReleaseWriteFreezeService, ReleaseWriteFreezeGuard],
})
export class ReleaseControlModule {}
