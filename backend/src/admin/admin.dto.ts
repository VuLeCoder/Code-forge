import { IsISO8601, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminStatusDto {
  @IsIn(['ACTIVE', 'LOCKED']) status!: 'ACTIVE' | 'LOCKED';
}

export class AdminListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsString() @MaxLength(4) page?: string;
}

export class AdminGitJournalListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['PUSH', 'MERGE']) type?: 'PUSH' | 'MERGE';
  @IsOptional() @IsString() @MaxLength(4) page?: string;
}

export class AdminResolveGitJournalDto {
  @IsISO8601({ strict: true }) revision!: string;
  @IsIn(['OPERATOR_REVIEW']) reasonCode!: 'OPERATOR_REVIEW';
}
