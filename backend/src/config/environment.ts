import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  PORT = 4000;

  @IsString()
  @IsNotEmpty()
  API_PREFIX = 'api/v1';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  GIT_STORAGE_PATH = '../data/git';

  @IsString()
  @IsNotEmpty()
  FRONTEND_ORIGIN = 'http://localhost:3000';

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsInt()
  @Min(60)
  @Max(3600)
  @Type(() => Number)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  REFRESH_TOKEN_TTL_DAYS = 30;

  @IsInt()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  MAX_REPOSITORIES_PER_USER = 20;

  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  SOFT_DELETE_RETENTION_DAYS = 30;

  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  COOKIE_SECURE = false;

  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAME_SITE: 'lax' | 'strict' | 'none' = 'lax';
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Cấu hình môi trường không hợp lệ: ${errors.toString()}`);
  }
  if (validated.COOKIE_SAME_SITE === 'none' && !validated.COOKIE_SECURE) {
    throw new Error('Cấu hình môi trường không hợp lệ: COOKIE_SAME_SITE=none yêu cầu COOKIE_SECURE=true');
  }
  return validated;
}
