import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CouponsService } from './coupons.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, code: 'SAVE10', type: 'PERCENT', value: 10, minSubtotal: 0, maxDiscount: null, expiresAt: null,
  maxUses: null, usedCount: 0, active: true, createdAt: new Date(), ...over,
});

function make(found: any = row()) {
  const prisma: any = {
    coupon: {
      findUnique: jest.fn(async () => found),
      findMany: jest.fn(async () => [found]),
      create: jest.fn(async ({ data }: any) => ({ id: 2, usedCount: 0, createdAt: new Date(), ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...found, ...data })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  return { prisma, svc: new CouponsService(prisma) };
}

describe('CouponsService.validate', () => {
  it('looks the code up trimmed and upper-cased', async () => {
    const { svc, prisma } = make();
    const r = await svc.validate('  save10 ', 500);
    expect(prisma.coupon.findUnique).toHaveBeenCalledWith({ where: { code: 'SAVE10' } });
    expect(r.discount).toBe(50);
    expect(r.coupon.code).toBe('SAVE10');
  });
  it('unknown, inactive and blank all say "Coupon not found"', async () => {
    await expect(make(null).svc.validate('NOPE', 500)).rejects.toThrow('Coupon not found');
    await expect(make(row({ active: false })).svc.validate('SAVE10', 500)).rejects.toThrow('Coupon not found');
    const { svc, prisma } = make(null);
    await expect(svc.validate('   ', 500)).rejects.toThrow('Coupon not found');
    expect(prisma.coupon.findUnique).not.toHaveBeenCalled();
  });
  it('surfaces expired, usage limit and minimum-subtotal errors', async () => {
    await expect(make(row({ expiresAt: new Date('2020-01-01') })).svc.validate('SAVE10', 500)).rejects.toThrow('Coupon expired');
    await expect(make(row({ maxUses: 1, usedCount: 1 })).svc.validate('SAVE10', 500)).rejects.toThrow('Coupon usage limit reached');
    await expect(make(row({ minSubtotal: 800 })).svc.validate('SAVE10', 500)).rejects.toThrow('Add ₹300 more to use this coupon');
  });
  it('public preview (hideFinished) reports expired and used-up codes as not found; order creation keeps the reasons', async () => {
    const hide = { hideFinished: true };
    const expired = make(row({ expiresAt: new Date('2020-01-01') }));
    await expect(expired.svc.validate('SAVE10', 500, undefined, hide)).rejects.toThrow('Coupon not found');
    await expect(expired.svc.validate('SAVE10', 500)).rejects.toThrow('Coupon expired');
    const full = make(row({ maxUses: 1, usedCount: 1 }));
    await expect(full.svc.validate('SAVE10', 500, undefined, hide)).rejects.toThrow('Coupon not found');
    await expect(full.svc.validate('SAVE10', 500)).rejects.toThrow('Coupon usage limit reached');
    // the minimum-subtotal hint is still given (the shopper needs it)
    await expect(make(row({ minSubtotal: 800 })).svc.validate('SAVE10', 500, undefined, hide)).rejects.toThrow('Add ₹300 more');
  });
  it('exposes the discounted-total floor', () => {
    expect(make().svc.minTotal).toBe(1);
  });
  it('can validate against a transaction client', async () => {
    const tx: any = { coupon: { findUnique: jest.fn(async () => row({ type: 'FLAT', value: 40 })) } };
    expect((await make().svc.validate('save10', 500, tx)).discount).toBe(40);
  });
});

describe('CouponsService admin CRUD', () => {
  it('create stores an UPPERCASE code with defaults', async () => {
    const { svc, prisma } = make();
    await svc.create({ code: ' welcome-5 ', type: 'FLAT', value: 5 } as any);
    expect(prisma.coupon.create.mock.calls[0][0].data).toMatchObject({
      code: 'WELCOME-5', type: 'FLAT', value: 5, minSubtotal: 0, maxDiscount: null, expiresAt: null, maxUses: null, active: true,
    });
  });
  it('rejects percent over 100, non-positive value, max discount on FLAT', async () => {
    const { svc } = make();
    await expect(svc.create({ code: 'ABC', type: 'PERCENT', value: 101 } as any)).rejects.toThrow('cannot exceed 100%');
    await expect(svc.create({ code: 'ABC', type: 'PERCENT', value: 0 } as any)).rejects.toThrow('greater than 0');
    await expect(svc.create({ code: 'ABC', type: 'FLAT', value: -1 } as any)).rejects.toThrow('greater than 0');
    await expect(svc.create({ code: 'ABC', type: 'FLAT', value: 5, maxDiscount: 5 } as any)).rejects.toThrow('percentage coupons only');
    await expect(svc.create({ code: 'ABC', type: 'PERCENT', value: 5, maxDiscount: 0 } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ code: 'ABC', type: 'PERCENT', value: 100 } as any)).resolves.toBeDefined();
  });
  it('duplicate code is a 409', async () => {
    const { svc, prisma } = make();
    prisma.coupon.create.mockRejectedValue({ code: 'P2002' });
    await expect(svc.create({ code: 'ABC', type: 'FLAT', value: 5 } as any)).rejects.toBeInstanceOf(ConflictException);
  });
  it('update validates the MERGED coupon (type switch with an old big value)', async () => {
    const { svc } = make(row({ type: 'FLAT', value: 500 }));
    await expect(svc.update(1, { type: 'PERCENT' })).rejects.toThrow('cannot exceed 100%');
    const m = make(row({ type: 'PERCENT', value: 10, maxDiscount: 50 }));
    await expect(m.svc.update(1, { type: 'FLAT' })).rejects.toThrow('percentage coupons only');
    await expect(m.svc.update(1, { type: 'FLAT', maxDiscount: null, value: 30 })).resolves.toBeDefined();
  });
  it('update of an unknown id is 404; null clears expiry and max uses', async () => {
    await expect(make(null).svc.update(9, { active: false })).rejects.toBeInstanceOf(NotFoundException);
    const { svc, prisma } = make(row({ expiresAt: new Date(), maxUses: 3 }));
    await svc.update(1, { expiresAt: null, maxUses: null, active: false });
    expect(prisma.coupon.update.mock.calls[0][0].data).toMatchObject({ expiresAt: null, maxUses: null, active: false });
  });
  it('delete: unused coupons are removed with a usedCount=0 guard; used ones are refused (409)', async () => {
    const a = make();
    await expect(a.svc.remove(1)).resolves.toEqual({ deleted: true });
    expect(a.prisma.coupon.deleteMany).toHaveBeenCalledWith({ where: { id: 1, usedCount: 0 } });
    const b = make(row({ usedCount: 3 }));
    await expect(b.svc.remove(1)).rejects.toThrow('used 3 times');
    expect(b.prisma.coupon.deleteMany).not.toHaveBeenCalled();
    const c = make();
    c.prisma.coupon.deleteMany.mockResolvedValue({ count: 0 });
    await expect(c.svc.remove(1)).rejects.toBeInstanceOf(ConflictException);
    await expect(make(null).svc.remove(1)).rejects.toBeInstanceOf(NotFoundException);
  });
});
