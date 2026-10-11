import { IsEmail, IsInt, IsOptional, Min } from 'class-validator';

export class CreateRzpOrderDto {
  @IsInt()
  @Min(1)
  orderId!: number;

  /** Required for guests: must match the email on the order. */
  @IsOptional()
  @IsEmail()
  email?: string;
}
