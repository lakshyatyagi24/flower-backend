import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested,
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
}
