import { joinRefundNote, splitRefundNote } from './refund-note';

const SW = 'Switched to COD; abandoned Razorpay order order_old';
const CAP = 'PAYMENT pay_1 CAPTURED AFTER SWITCH TO COD - REFUND';
const MIS = 'AMOUNT MISMATCH: payment pay_2 captured 1 vs expected 2 - review/refund manually';

describe('refund-note helpers', () => {
  it('splits admin text from system lines, keeping system order', () => {
    expect(splitRefundNote(`owner says hi\n${SW}\n${CAP}`)).toEqual({ admin: 'owner says hi', system: [SW, CAP] });
    expect(splitRefundNote(`${MIS}`)).toEqual({ admin: '', system: [MIS] });
    expect(splitRefundNote(null)).toEqual({ admin: '', system: [] });
    expect(splitRefundNote('')).toEqual({ admin: '', system: [] });
  });

  it('keeps multi-line admin text and handles CRLF', () => {
    expect(splitRefundNote(`line a\r\nline b\r\n${SW}`)).toEqual({ admin: 'line a\nline b', system: [SW] });
  });

  it('does not treat a mid-line mention as a system line', () => {
    expect(splitRefundNote('see AMOUNT MISMATCH above').system).toEqual([]);
  });

  it('joins admin then system lines; null when nothing remains', () => {
    expect(joinRefundNote('hi', [SW, CAP])).toBe(`hi\n${SW}\n${CAP}`);
    expect(joinRefundNote('', [SW])).toBe(SW);
    expect(joinRefundNote('  hi  ', [])).toBe('hi');
    expect(joinRefundNote('', [])).toBeNull();
  });
});
