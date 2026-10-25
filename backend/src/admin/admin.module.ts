import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';

@Module({
  imports: [AuthModule, RepositoriesModule, MaintenanceModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
