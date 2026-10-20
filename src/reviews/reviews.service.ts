import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { REVIEW_BODY_MAX, REVIEW_STATUSES, REVIEW_TITLE_MAX, ReviewStatusValue } from './dto/upsert-review.dto';

interface UpsertReviewInput {
  rating: number;
  title?: string | null;
  body: string;
}

interface ListParams {
  take?: number;
  skip?: number;
}

function isValidRating(rating: unknown): boolean {
  return typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

/** Trimmed, null-normalised review content used for change detection and writes. */
function normalizeContent(input: UpsertReviewInput) {
  return {
    rating: input.rating,
    title: input.title?.trim?.() || null,
    body: input.body.trim(),
  };
}

function sameContent(
  existing: { rating: number; title: string | null; body: string },
  data: { rating: number; title: string | null; body: string },
): boolean {
  return existing.rating === data.rating && existing.title === data.title && existing.body === data.body;
}

export const NOT_A_BUYER_MESSAGE = 'Only customers who received this product can review it';

/**
 * Moderation model:
 *  - Only APPROVED reviews are public and counted in ratings / popularity (R22).
 *  - New reviews, and edits by the author that change the content, go back to PENDING
 *    (stops "get approved, then edit into something else").
 *  - Posting requires a COMPLETED order (the final fulfilled status) containing the product,
 *    matched by Order.userId only. Guest orders are never attached to accounts by email, so a
 *    guest who later registers cannot review from that order (documented gap).
 */
@Injectable()
export class ReviewsService {
  private readonly log = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private select = {
    id: true,
    productId: true,
    userId: true,
    rating: true,
    title: true,
    body: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    user: { select: { id: true, name: true } },
  } as const;

  private adminSelect = {
    ...this.select,
    user: { select: { id: true, name: true, email: true } },
    product: { select: { id: true, name: true, slug: true } },
  } as const;

  /** Public shape: never includes status (every public item is APPROVED). */
  private toPublic<T extends { status?: unknown }>(r: T): Omit<T, 'status'> {
    const { status: _status, ...rest } = r;
    return rest;
  }

  private validate(input: UpsertReviewInput) {
    if (!isValidRating(input.rating)) {
      throw new BadRequestException('Rating must be an integer between 1 and 5');
    }
    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('Review body is required');
    if (body.length > REVIEW_BODY_MAX) {
      throw new BadRequestException(`Review body must be ${REVIEW_BODY_MAX} characters or fewer`);
    }
    if (input.title && input.title.trim().length > REVIEW_TITLE_MAX) {
      throw new BadRequestException(`Title must be ${REVIEW_TITLE_MAX} characters or fewer`);
    }
  }

  async hasReceivedProduct(userId: number, productId: number): Promise<boolean> {
    const n = await this.prisma.order.count({
      where: { userId, status: 'COMPLETED', items: { some: { productId } } },
    });
    return n > 0;
  }

  async listForProduct(productId: number, params: ListParams, viewerId?: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    const take = Math.min(Math.max(params.take ?? 20, 1), 100);
    const skip = Math.max(params.skip ?? 0, 0);
    const where = { productId, status: 'APPROVED' as const };
    const [items, total, agg, own] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: this.select,
        take,
        skip,
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({ where, _avg: { rating: true } }),
      viewerId
        ? this.prisma.review.findUnique({
            where: { productId_userId: { productId, userId: viewerId } },
            select: this.select,
          })
        : Promise.resolve(null),
    ]);
    return {
      items: items.map((r) => this.toPublic(r)),
      total,
      take,
      skip,
      averageRating: agg._avg.rating ?? 0,
      // The caller's own review in ANY status (so the author can see "awaiting approval"). Never someone else's.
      ownReview: own ?? null,
    };
  }

  async eligibility(productId: number, userId: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const [canReview, existing] = await Promise.all([
      this.hasReceivedProduct(userId, productId),
      this.prisma.review.findUnique({
        where: { productId_userId: { productId, userId } },
        select: { id: true },
      }),
    ]);
    return { canReview, hasReview: !!existing };
  }

  /** userId -> time of the last review email sent for them (in memory; resets on restart). */
  private readonly lastNotified = new Map<number, number>();
  static readonly NOTIFY_COOLDOWN_MS = 10 * 60_000;
  private static readonly NOTIFY_MAP_MAX = 1000;

  /** True (and records it) when this user has not triggered a review email in the cooldown window. */
  private takeNotifySlot(userId: number): boolean {
    const now = Date.now();
    const last = this.lastNotified.get(userId);
    if (last !== undefined && now - last < ReviewsService.NOTIFY_COOLDOWN_MS) return false;
    if (this.lastNotified.size >= ReviewsService.NOTIFY_MAP_MAX) this.makeNotifyRoom(now);
    this.lastNotified.delete(userId); // re-insert so insertion order tracks recency
    this.lastNotified.set(userId, now);
    return true;
  }

  /** Evict expired entries, then the oldest ones, until the map is below its cap. */
  private makeNotifyRoom(now: number): void {
    for (const [k, t] of this.lastNotified) {
      if (now - t >= ReviewsService.NOTIFY_COOLDOWN_MS) this.lastNotified.delete(k);
    }
    // Still full of recent entries: drop the oldest (Map keeps insertion order).
    while (this.lastNotified.size >= ReviewsService.NOTIFY_MAP_MAX) {
      this.lastNotified.delete(this.lastNotified.keys().next().value as number);
    }
  }

  /**
   * Fire-and-forget admin email. Called only when a review is new or moves into PENDING from another status,
   * and at most once per user per 10 minutes. Never throws and is never awaited by the request.
   */
  private notifyPending(
    review: { id: number; userId: number; rating: number; title: string | null; body: string; productId: number; user: { name: string | null } },
    edited: boolean,
  ): void {
    if (!this.takeNotifySlot(review.userId)) return;
    void (async () => {
      try {
        const product = await this.prisma.product.findUnique({ where: { id: review.productId }, select: { name: true } });
        await this.mail.sendReviewPending({
          id: review.id,
          productName: product?.name ?? `Product #${review.productId}`,
          rating: review.rating,
          title: review.title,
          body: review.body,
          authorName: review.user?.name ?? null,
          edited,
        });
      } catch (e) {
        this.log.error(`review pending notification failed for review ${review.id}: ${(e as Error)?.message ?? String(e)}`);
      }
    })();
  }

  async upsertForProduct(productId: number, userId: number, input: UpsertReviewInput) {
    this.validate(input);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (!(await this.hasReceivedProduct(userId, productId))) {
      throw new ForbiddenException(NOT_A_BUYER_MESSAGE);
    }
    const data = normalizeContent(input);
    const existing = await this.prisma.review.findUnique({
      where: { productId_userId: { productId, userId } },
    });
    if (existing && sameContent(existing, data)) {
      // Re-submitting identical content keeps the current status (no free re-queue, no admin mail).
      return this.prisma.review.findUniqueOrThrow({ where: { id: existing.id }, select: this.select });
    }
    const saved = await this.prisma.review.upsert({
      where: { productId_userId: { productId, userId } },
      create: { ...data, productId, userId, status: 'PENDING' },
      update: { ...data, status: 'PENDING' },
      select: this.select,
    });
    if (!existing || existing.status !== 'PENDING') this.notifyPending(saved, !!existing);
    return saved;
  }

  async update(
    reviewId: number,
    userId: number,
    role: 'CUSTOMER' | 'ADMIN',
    input: Partial<UpsertReviewInput>,
  ) {
    const existing = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!existing) throw new NotFoundException('Review not found');
    const isAuthor = existing.userId === userId;
    if (!isAuthor && role !== 'ADMIN') {
      throw new ForbiddenException('You can only edit your own reviews');
    }
    const next: UpsertReviewInput = {
      rating: input.rating ?? existing.rating,
      title: input.title === undefined ? existing.title : input.title,
      body: input.body ?? existing.body,
    };
    this.validate(next);
    const data = normalizeContent(next);
    const unchanged = sameContent(existing, data);
    // Author edits re-enter moderation; an admin correcting someone else's text does not change its status.
    const requeue = isAuthor && !unchanged;
    const saved = await this.prisma.review.update({
      where: { id: reviewId },
      data: requeue ? { ...data, status: 'PENDING' } : data,
      select: this.select,
    });
    if (requeue && existing.status !== 'PENDING') this.notifyPending(saved, true);
    return saved;
  }

  async remove(reviewId: number, userId: number, role: 'CUSTOMER' | 'ADMIN') {
    const existing = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!existing) throw new NotFoundException('Review not found');
    if (existing.userId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException('You can only delete your own reviews');
    }
    await this.prisma.review.delete({ where: { id: reviewId } });
    return { success: true };
  }

  async setStatus(reviewId: number, status: ReviewStatusValue) {
    if (!REVIEW_STATUSES.includes(status)) throw new BadRequestException('Invalid status');
    const existing = await this.prisma.review.findUnique({ where: { id: reviewId }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundException('Review not found');
    if (existing.status === status) {
      // Idempotent: repeating a transition is a success, not an error and not a write.
      return this.prisma.review.findUniqueOrThrow({ where: { id: reviewId }, select: this.adminSelect });
    }
    return this.prisma.review.update({ where: { id: reviewId }, data: { status }, select: this.adminSelect });
  }

  async listAll(params: { productId?: number; status?: string; take?: number; skip?: number }) {
    if (params.status !== undefined && !REVIEW_STATUSES.includes(params.status as ReviewStatusValue)) {
      throw new BadRequestException('status must be PENDING, APPROVED or REJECTED');
    }
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const skip = Math.max(params.skip ?? 0, 0);
    const base = params.productId ? { productId: params.productId } : {};
    const where = params.status ? { ...base, status: params.status as ReviewStatusValue } : base;
    const [items, total, groups] = await Promise.all([
      this.prisma.review.findMany({
        where,
        // Pending queue is worked oldest-first so the longest-waiting review is never pushed past the page cap.
        orderBy: params.status === 'PENDING' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
        select: this.adminSelect,
        take,
        skip,
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const g of groups) counts[g.status] = g._count._all;
    return { items, total, take, skip, counts };
  }
}
