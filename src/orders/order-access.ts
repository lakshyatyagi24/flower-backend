export interface OrderOwnerFields {
  userId?: number | null;
  customerEmail?: string | null;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

export function emailMatches(order: OrderOwnerFields, email: string | null | undefined): boolean {
  const given = norm(email);
  return !!given && norm(order.customerEmail) === given;
}

/**
 * The ONE ownership rule for customer-initiated order actions (pay, switch to COD).
 * - An order that belongs to an account (userId set) is accessible only with that account's token. Knowing the
 *   email is NOT enough, so an anonymous caller who knows a registered customer's email + order id gets
 *   nothing.
 * - A guest order (userId null) is accessible by its email, with or without a token.
 * Callers must answer false identically for unknown ids and wrong guesses (no oracle).
 * Public tracking (OrdersService.track) is deliberately email-based and does not use this helper.
 */
export function canAccessOrder(
  order: OrderOwnerFields | null | undefined,
  caller: { userId: number | null; email: string | null | undefined },
): boolean {
  if (!order) return false;
  if (order.userId) return !!caller.userId && order.userId === caller.userId;
  return emailMatches(order, caller.email);
}
