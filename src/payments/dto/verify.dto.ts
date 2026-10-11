import { IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class VerifyDto {
  @IsInt()
  @Min(1)
  orderId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  razorpayOrderId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  razorpayPaymentId!: string;

  // HMAC-SHA256 hex digest: exactly 64 lowercase hex chars.
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'signature must be a 64-character hex string' })
  signature!: string;
}
