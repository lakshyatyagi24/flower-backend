import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ORDER_STATUSES } from './update-status.dto';

export class AdminUpdateOrderDto {
  @IsOptional() @IsIn(ORDER_STATUSES) status?: (typeof ORDER_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(80) trackingNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(80) courierName?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) adminNotes?: string | null;
  @IsOptional() @IsString() @MaxLength(500) shippingAddress?: string | null;
  @IsOptional() @IsString() @MaxLength(80) city?: string | null;
  @IsOptional() @IsString() @MaxLength(6) postalCode?: string | null;
  @IsOptional() @IsString() @MaxLength(15) customerPhone?: string | null;
  // Only a PAID order can be marked refunded (compare-and-set in the service).
  @IsOptional() @IsIn(['REFUNDED']) paymentStatus?: 'REFUNDED';
  @IsOptional() @IsString() @MaxLength(1000) refundNote?: string | null;
}
