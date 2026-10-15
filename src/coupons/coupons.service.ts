import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '../common/money';
import { CouponLike, couponError, evaluateCoupon, FINISHED_MESSAGES, MIN_DISCOUNTED_TOTAL, normalizeCouponCode } from './coupon-rules';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

type Shape = { type: 'PERCENT' | 'FLAT'; value: number; maxDiscount: number | null };

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public preview: is this code usable for this (client-supplied, therefore advisory) subtotal and how much
   * does it take off? OrdersService.create repeats the check inside its transaction with the server-computed
   * subtotal, so nothing here is trusted for money. `db` lets a caller pass a transaction client.
   */
  async validate(
    code: string,
    subtotal: number,
    db: { coupon: { findUnique: (a: any) => Promise<any> } } = this.prisma as any,
    opts: { hideFinished?: boolean } = {},
  ) {
    const normalized = normalizeCouponCode(code);
    const coupon: CouponLike | null = normalized ? await db.coupon.findUnique({ where: { code: normalized } }) : null;
    let discount: number;
    try {
      discount = evaluateCoupon(coupon, subtotal);
    } catch (err) {
      // Public preview only: an expired or used-up code is reported like an unknown one, so strangers cannot probe
      // which codes have existed. Order creation keeps the specific reasons (it is authoritative and throttled).
      if (opts.hideFinished && FINISHED_MESSAGES.includes(String((err as { response?: { message?: string } }).response?.message))) {
        throw couponError('Coupon not found');
      }
      throw err;
    }
    return { discount, coupon: coupon! };
  }

  /** The lowest total a discounted order may have (Razorpay needs at least one rupee). */
  readonly minTotal = MIN_DISCOUNTED_TOTAL;

  list() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreateCouponDto) {
    const shape = this.assertShape({
      type: dto.type,
      value: dto.value,
      maxDiscount: dto.maxDiscount ?? null,
    });
    try {
      return await this.prisma.coupon.create({
        data: {
          code: normalizeCouponCode(dto.code),
          type: shape.type,
          value: round2(shape.value),
          minSubtotal: round2(dto.minSubtotal ?? 0),
          maxDiscount: shape.maxDiscount === null ? null : round2(shape.maxDiscount),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          maxUses: dto.maxUses ?? null,
          active: dto.active ?? true,
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new ConflictException('A coupon with this code already exists');
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateCouponDto) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Coupon not found');
    // Validate the MERGED result so e.g. switching to PERCENT with a value of 500 is caught.
    const shape = this.assertShape({
      type: dto.type ?? existing.type,
      value: dto.value ?? existing.value,
      maxDiscount: dto.maxDiscount === undefined ? existing.maxDiscount : dto.maxDiscount,
    });
    const data: Record<string, unknown> = {
      type: shape.type,
      value: round2(shape.value),
      maxDiscount: shape.maxDiscount === null ? null : round2(shape.maxDiscount),
    };
    if (dto.minSubtotal != null) data.minSubtotal = round2(dto.minSubtotal);
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.coupon.update({ where: { id }, data });
  }

  /**
   * A coupon that has been used (usedCount > 0) is never hard-deleted: orders refer to its code and a later
   * cancellation must still be able to give the use back. The admin deactivates it instead.
   */
  async remove(id: number) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Coupon not found');
    if (existing.usedCount > 0) {
      throw new ConflictException(
        `This coupon has been used ${existing.usedCount} time${existing.usedCount === 1 ? '' : 's'} and cannot be deleted. Deactivate it instead.`,
      );
    }
    // Guarded: a use consumed between the read and this delete makes it match nothing.
    const res = await this.prisma.coupon.deleteMany({ where: { id, usedCount: 0 } });
    if (res.count !== 1) {
      throw new ConflictException('This coupon was just used and cannot be deleted. Deactivate it instead.');
    }
    return { deleted: true };
  }

  private assertShape(s: Shape): Shape {
    if (!(s.value > 0)) throw new BadRequestException('Value must be greater than 0');
    if (s.type === 'PERCENT' && s.value > 100) throw new BadRequestException('A percentage coupon cannot exceed 100%');
    if (s.maxDiscount !== null) {
      if (s.type === 'FLAT') throw new BadRequestException('Max discount applies to percentage coupons only');
      if (!(s.maxDiscount > 0)) throw new BadRequestException('Max discount must be greater than 0');
    }
    return s;
  }
}
