import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { IsIndianPhone, IsIndianPin } from '../../common/validators';

export class OrderItemDto {
  @IsInt() @Min(1) productId!: number;
  @IsInt() @Min(1) quantity!: number;
}

export class CreateOrderDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];
  @IsString() @MaxLength(80) customerName!: string;
  @IsEmail() customerEmail!: string;
  @IsIndianPhone() customerPhone!: string;
  @IsString() @MaxLength(500) shippingAddress!: string;
  @IsString() @MaxLength(80) city!: string;
  @IsIndianPin() postalCode!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsIn(['COD', 'RAZORPAY']) paymentMethod?: 'COD' | 'RAZORPAY';
  /**
   * Requested delivery date, `YYYY-MM-DD` (an India/IST calendar date; a full timestamp is rejected).
   * REQUIRED for new orders: the storefront always sends it. The range and blackout rules are checked in
   * OrdersService.create via DeliveryService.validateDeliveryDate.
   */
  @IsDefined({ message: 'Please choose a delivery date' })
  @IsDateString({ strict: true }, { message: 'Delivery date must be a valid date in YYYY-MM-DD format' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Delivery date must be a valid date in YYYY-MM-DD format' })
  deliveryDate!: string;
}
