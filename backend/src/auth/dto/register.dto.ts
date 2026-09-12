import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(39)
  @Matches(/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  username!: string;

  @IsEmail()
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
