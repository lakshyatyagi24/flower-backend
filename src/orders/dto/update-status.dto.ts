import { IsIn } from 'class-validator';
export const ORDER_STATUSES = ['PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'] as const;
export class UpdateStatusDto {
  @IsIn(ORDER_STATUSES) status!: (typeof ORDER_STATUSES)[number];
}
