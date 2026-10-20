import { BadRequestException } from '@nestjs/common';

export const ALLOWED_STATUSES = ['PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ALLOWED_STATUSES)[number];

// Legal forward transitions. COMPLETED and CANCELLED are terminal. This keeps
// the customer-facing tracking timeline coherent and lets cancellation restock
// exactly once (you cannot resurrect a CANCELLED order and re-cancel it).
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAID', 'SHIPPED', 'CANCELLED'],
  PAID: ['SHIPPED', 'COMPLETED', 'CANCELLED'],
  SHIPPED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const PAYMENT_STATUSES = ['UNPAID', 'PAID', 'FAILED', 'REFUNDED'] as const;
export const PAYMENT_METHODS = ['COD', 'RAZORPAY'] as const;
export const MISMATCH_MARKER = 'AMOUNT MISMATCH';
export const POST_SWITCH_MARKER = 'CAPTURED AFTER SWITCH';

export function isOrderStatus(value: string): value is OrderStatus {
  return (ALLOWED_STATUSES as readonly string[]).includes(value);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) return;
  if (!STATUS_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Cannot change order status from ${from} to ${to}`);
  }
}
