/**
 * refundNote mixes owner free text with system-written trace lines (the only record of money owed for
 * a COD-switched capture or an amount mismatch). Admin edits must replace only the admin part.
 */
const SYSTEM_LINE =
  /^(Switched to COD; abandoned Razorpay order |PAYMENT \S+ CAPTURED AFTER SWITCH TO COD|AMOUNT MISMATCH)/;

export function splitRefundNote(note: string | null | undefined): { admin: string; system: string[] } {
  const admin: string[] = [];
  const system: string[] = [];
  for (const line of (note ?? '').split(/\r?\n/)) {
    if (SYSTEM_LINE.test(line)) system.push(line);
    else admin.push(line);
  }
  return { admin: admin.join('\n').trim(), system };
}

/** Admin text first, then the preserved system lines; null when nothing remains. */
export function joinRefundNote(admin: string, system: string[]): string | null {
  const text = [admin.trim(), ...system].filter((l) => l.length > 0).join('\n');
  return text.length ? text : null;
}
