import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { RepositoryPolicy } from './repository.policy';
import { GitStorageService } from './git-storage.service';
import { RepositoryPurgeService } from './repository-purge.service';
import { GitHttpController } from './git-http.controller';
import { GitHttpService } from './git-http.service';
import { TokensModule } from '../tokens/tokens.module';
import { PullRequestsController } from './pull-requests.controller';
import { PullRequestsService } from './pull-requests.service';
import { RepositoryLockService } from './repository-lock.service';

@Module({
  imports: [AuthModule, TokensModule],
  controllers: [RepositoriesController, GitHttpController, PullRequestsController],
  providers: [RepositoriesService, PullRequestsService, RepositoryPolicy, OptionalAccessTokenGuard, GitStorageService, RepositoryPurgeService, GitHttpService, RepositoryLockService],
  exports: [RepositoriesService, OptionalAccessTokenGuard, RepositoryLockService, GitStorageService, RepositoryPurgeService],
})
export class RepositoriesModule {}
