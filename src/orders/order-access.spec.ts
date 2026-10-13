import { canAccessOrder, emailMatches } from './order-access';

describe('canAccessOrder', () => {
  const guest = { userId: null, customerEmail: 'Guest@Example.com ' };
  const acct = { userId: 5, customerEmail: 'owner@example.com' };

  it('guest order: matching email (case/space-insensitive) works with or without a token', () => {
    expect(canAccessOrder(guest, { userId: null, email: 'guest@example.com' })).toBe(true);
    expect(canAccessOrder(guest, { userId: 9, email: ' GUEST@example.com' })).toBe(true);
  });
  it('guest order: wrong or missing email is refused', () => {
    expect(canAccessOrder(guest, { userId: null, email: 'other@example.com' })).toBe(false);
    expect(canAccessOrder(guest, { userId: null, email: null })).toBe(false);
    expect(canAccessOrder(guest, { userId: 9, email: '' })).toBe(false);
  });
  it('account order: only that account, never the email alone', () => {
    expect(canAccessOrder(acct, { userId: 5, email: null })).toBe(true);
    expect(canAccessOrder(acct, { userId: null, email: 'owner@example.com' })).toBe(false);
    expect(canAccessOrder(acct, { userId: 6, email: 'owner@example.com' })).toBe(false);
  });
  it('an order without a stored email never matches an empty email', () => {
    expect(canAccessOrder({ userId: null, customerEmail: null }, { userId: null, email: '' })).toBe(false);
    expect(emailMatches({ customerEmail: '' }, '')).toBe(false);
  });
  it('no order is no access', () => {
    expect(canAccessOrder(null, { userId: 1, email: 'a@b.co' })).toBe(false);
  });
});
