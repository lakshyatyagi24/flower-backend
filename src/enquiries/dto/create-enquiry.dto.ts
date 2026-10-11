import { IsDateString, IsEmail, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsIndianPhone } from '../../common/validators';

export class CreateEnquiryDto {
  @IsOptional() @IsInt() productId?: number | null;
  @IsOptional() @IsString() @MaxLength(120) productName?: string;
  @IsString() @MaxLength(80) customerName!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsIndianPhone() customerPhone!: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsOptional() @IsString() @MaxLength(80) occasion?: string;
  @IsOptional() @IsNumber() @Min(0) budget?: number;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsString() @MaxLength(40) source?: string;
}
