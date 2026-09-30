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

@Module({
  imports: [AuthModule, TokensModule],
  controllers: [RepositoriesController, GitHttpController],
  providers: [RepositoriesService, RepositoryPolicy, OptionalAccessTokenGuard, GitStorageService, RepositoryPurgeService, GitHttpService],
  exports: [RepositoriesService, OptionalAccessTokenGuard],
})
export class RepositoriesModule {}
