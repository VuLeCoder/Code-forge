import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  login!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
