import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { RepositoryPolicy } from './repository.policy';

@Module({
  imports: [AuthModule],
  controllers: [RepositoriesController],
  providers: [RepositoriesService, RepositoryPolicy, OptionalAccessTokenGuard],
  exports: [RepositoriesService, OptionalAccessTokenGuard],
})
export class RepositoriesModule {}
