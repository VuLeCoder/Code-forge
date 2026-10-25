import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminStatusDto {
  @IsIn(['ACTIVE', 'LOCKED']) status!: 'ACTIVE' | 'LOCKED';
}

export class AdminListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(30) action?: string;
  @IsOptional() @IsString() @MaxLength(4) page?: string;
}

export class AdminUnresolvedQueryDto {
  @IsOptional() @IsString() @MaxLength(36) repositoryId?: string;
  @IsOptional() @IsIn(['PUSH', 'MERGE']) type?: 'PUSH' | 'MERGE';
  @IsOptional() @IsString() @MaxLength(4) page?: string;
}

export class AdminResolveOperationDto {
  @IsIn(['PUSH', 'MERGE']) type!: 'PUSH' | 'MERGE';
  @IsIn(['MARK_FAILED', 'RETRY_RECONCILE']) action!: 'MARK_FAILED' | 'RETRY_RECONCILE';
  @IsString() @MaxLength(200) reason!: string;
}
