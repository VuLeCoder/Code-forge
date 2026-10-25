import { Module } from '@nestjs/common';
import { RepositoriesModule } from '../repositories/repositories.module';
import { MaintenanceJobsService } from './maintenance-jobs.service';

@Module({ imports: [RepositoriesModule], providers: [MaintenanceJobsService] })
export class MaintenanceModule {}
