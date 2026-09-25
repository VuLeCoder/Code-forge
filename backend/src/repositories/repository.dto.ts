import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { RepositoryVisibility } from '@prisma/client';

// ASCII route segment, without traversal or the reserved Git transport suffix.
const REPOSITORY_NAME = /^(?!.*\.\.)(?!.*\.git$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateRepositoryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(REPOSITORY_NAME)
  name!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(RepositoryVisibility)
  visibility?: RepositoryVisibility;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  initializeReadme?: boolean;
}

export class UpdateRepositoryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(REPOSITORY_NAME)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(RepositoryVisibility)
  visibility?: RepositoryVisibility;
}
