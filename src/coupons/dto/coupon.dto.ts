import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class ValidateCouponDto {
  @IsString() @MaxLength(64) code!: string;
  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100_000_000) subtotal!: number;
}

/** Cross-field rules (percent <= 100, max discount only for PERCENT) live in CouponsService. */
export class CreateCouponDto {
  @Transform(upper)
  @Matches(/^[A-Z0-9_-]{3,32}$/, { message: 'Code must be 3-32 characters: letters, digits, "-" or "_"' })
  code!: string;
  @IsIn(['PERCENT', 'FLAT']) type!: 'PERCENT' | 'FLAT';
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0.01, { message: 'Value must be greater than 0' }) @Max(10_000_000) value!: number;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0, { message: 'Minimum subtotal cannot be negative' }) @Max(100_000_000) minSubtotal?: number;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0.01, { message: 'Max discount must be greater than 0' }) @Max(100_000_000) maxDiscount?: number | null;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsInt() @Min(1, { message: 'Max uses must be at least 1' }) @Max(10_000_000) maxUses?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** The code is immutable (orders and the usage give-back refer to it); everything else is editable. */
export class UpdateCouponDto {
  @IsOptional() @IsIn(['PERCENT', 'FLAT']) type?: 'PERCENT' | 'FLAT';
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0.01, { message: 'Value must be greater than 0' }) @Max(10_000_000) value?: number;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0, { message: 'Minimum subtotal cannot be negative' }) @Max(100_000_000) minSubtotal?: number;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0.01, { message: 'Max discount must be greater than 0' }) @Max(100_000_000) maxDiscount?: number | null;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsInt() @Min(1, { message: 'Max uses must be at least 1' }) @Max(10_000_000) maxUses?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
