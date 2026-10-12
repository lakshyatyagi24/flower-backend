import { isOnlinePaymentsEnabled } from './config';

describe('isOnlinePaymentsEnabled', () => {
  const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  const set = (id?: string, secret?: string) => {
    if (id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = id;
    if (secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = secret;
  };
  afterEach(() => set(saved.id, saved.secret));

  it.each([
    ['both unset', undefined, undefined, false],
    ['both empty', '', '', false],
    ['both whitespace', '  ', ' \t ', false],
    ['only id', 'rzp_test_x', undefined, false],
    ['only secret', undefined, 'sec', false],
    ['id set, secret whitespace', 'rzp_test_x', '   ', false],
    ['both set', 'rzp_test_x', 'sec', true],
    ['both set with padding', ' rzp_test_x ', ' sec ', true],
  ])('%s -> %s', (_n, id, secret, expected) => {
    set(id as any, secret as any);
    expect(isOnlinePaymentsEnabled()).toBe(expected);
  });
});
