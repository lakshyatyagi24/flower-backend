import { BadRequestException, ConflictException } from '@nestjs/common';
import { joinRefundNote, splitRefundNote } from './refund-note';
import {
  assertTransition,
  isOrderStatus,
  MISMATCH_MARKER,
  OrderStatus,
  POST_SWITCH_MARKER,
} from './order-status';

export interface AdminOrderPatch {
  status?: string;
  trackingNumber?: string | null;
  courierName?: string | null;
  adminNotes?: string | null;
  shippingAddress?: string | null;
  city?: string | null;
  postalCode?: string | null;
  customerPhone?: string | null;
  paymentStatus?: 'REFUNDED';
  refundNote?: string | null;
}

const NULLABLE_TEXT_FIELDS = [
  'trackingNumber',
  'courierName',
  'adminNotes',
  'shippingAddress',
  'city',
  'postalCode',
  'customerPhone',
] as const;

/** Validates the patch against the existing order and returns the Prisma `data` for the plain field edits. */
export function buildAdminData(patch: AdminOrderPatch, existingStatus: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!isOrderStatus(patch.status)) throw new BadRequestException('Invalid status');
    const from = existingStatus as OrderStatus;
    // Only treat it as a transition when the status actually changes, so an
    // admin can edit tracking/notes without re-validating an unchanged status.
    if (from !== patch.status) {
      assertTransition(from, patch.status);
      data.status = patch.status;
    }
  }
  for (const key of NULLABLE_TEXT_FIELDS) {
    if (patch[key] !== undefined) data[key] = patch[key] || null;
  }
  if (patch.paymentStatus !== undefined && patch.paymentStatus !== 'REFUNDED') {
    throw new BadRequestException('Invalid payment status');
  }
  return data;
}

/**
 * Admin text replaces only the ADMIN part of refundNote; system trace lines are always preserved
 * (and system-looking lines in the submitted text are stripped, so they cannot be forged/duplicated).
 */
export function planRefundNoteWrite(
  submitted: string | null | undefined,
  readNote: string | null,
): { writeNote: boolean; newNote: string | null | undefined } {
  if (submitted === undefined) return { writeNote: false, newNote: undefined };
  const newNote = joinRefundNote(splitRefundNote(submitted).admin, splitRefundNote(readNote).system);
  return { writeNote: newNote !== readNote, newNote };
}

/** PAID, or UNPAID with our own trace that money was captured (post-COD-switch capture / mismatch). */
export function assertRefundEligible(paymentStatus: string, readNote: string | null): void {
  const traced = readNote !== null && (readNote.includes(POST_SWITCH_MARKER) || readNote.includes(MISMATCH_MARKER));
  const eligible = paymentStatus === 'PAID' || (paymentStatus === 'UNPAID' && traced);
  if (!eligible) throw new ConflictException('Only a paid order can be marked refunded');
}
