import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsIndianPhone } from '../../common/validators';

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsIndianPhone() phone?: string;
}
