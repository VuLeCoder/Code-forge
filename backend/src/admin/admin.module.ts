import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { AdminGitJournalService } from './admin-git-journal.service';

@Module({
  imports: [AuthModule, RepositoriesModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGitJournalService, AdminGuard],
})
export class AdminModule {}
