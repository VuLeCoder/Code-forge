import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsISO8601, IsString, Length } from 'class-validator';

export class CreateTokenDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(['repo:read', 'repo:write'], { each: true })
  scopes!: string[];

  @IsISO8601({ strict: true })
  expiresAt!: string;
}
