import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class AccountDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(39)
  @Matches(/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  username?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEmail()
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  email?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, { message: 'Mật khẩu phải có ít nhất một chữ cái và một chữ số.' })
  newPassword?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(65000)
  @Matches(/^(?:data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2})?$/, { message: 'Ảnh đại diện không hợp lệ.' })
  avatarUrl?: string;
}
