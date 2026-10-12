import { IsEmail, IsIn, IsOptional } from 'class-validator';

export class SetPaymentMethodDto {
  /** Only RAZORPAY -> COD is supported. */
  @IsIn(['COD'])
  paymentMethod!: 'COD';

  /** Required for guests: must match the email on the order. */
  @IsOptional()
  @IsEmail()
  email?: string;
}
