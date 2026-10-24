import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreatePullRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(256)
  title!: string;

  @IsOptional() @IsString() @MaxLength(10000)
  description?: string | null;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(255)
  sourceBranch!: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(255)
  targetBranch!: string;
}

export class UpdatePullRequestDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(256)
  title?: string;

  @IsOptional() @IsString() @MaxLength(10000)
  description?: string | null;

  @IsOptional() @IsEnum(['OPEN', 'CLOSED'])
  state?: 'OPEN' | 'CLOSED';
}

export class MergePullRequestDto {
  @IsUUID('4') operationId!: string;
  @Matches(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/) expectedSourceSha!: string;
  @Matches(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/) expectedTargetSha!: string;
  @IsInt() @Min(0) @Max(2147483647) storageGeneration!: number;
  @IsInt() @Min(1) @Max(2147483647) version!: number;
}
