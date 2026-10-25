import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminStatusDto {
  @IsIn(['ACTIVE', 'LOCKED']) status!: 'ACTIVE' | 'LOCKED';
}

export class AdminListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(20) action?: string;
  @IsOptional() @IsString() @MaxLength(4) page?: string;
}
