/** Env value, trimmed; whitespace-only counts as unset. */
export const envTrim = (name: string): string => (process.env[name] ?? '').trim();

/**
 * Online payments are on only when BOTH Razorpay keys are configured. Pure (reads env each call) so
 * OrdersService can use it without importing PaymentsModule (which already imports OrdersModule).
 */
export const isOnlinePaymentsEnabled = (): boolean =>
  !!envTrim('RAZORPAY_KEY_ID') && !!envTrim('RAZORPAY_KEY_SECRET');
