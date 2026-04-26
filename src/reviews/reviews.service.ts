import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface UpsertReviewInput {
  rating: number;
  title?: string | null;
  body: string;
}

interface ListParams {
  take?: number;
  skip?: number;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true,
    productId: true,
    userId: true,
    rating: true,
    title: true,
    body: true,
    createdAt: true,
    updatedAt: true,
    user: { select: { id: true, name: true } },
  } as const;

  private validate(input: UpsertReviewInput) {
    if (
      typeof input.rating !== 'number' ||
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5
    ) {
      throw new BadRequestException('Rating must be an integer between 1 and 5');
    }
    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('Review body is required');
    if (body.length > 2000) {
      throw new BadRequestException('Review body must be 2000 characters or fewer');
    }
    if (input.title && input.title.length > 200) {
      throw new BadRequestException('Title must be 200 characters or fewer');
    }
  }

  async listForProduct(productId: number, params: ListParams) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    const take = Math.min(Math.max(params.take ?? 20, 1), 100);
    const skip = Math.max(params.skip ?? 0, 0);
    const [items, total, agg] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId },
        orderBy: { createdAt: 'desc' },
        select: this.select,
        take,
        skip,
      }),
      this.prisma.review.count({ where: { productId } }),
      this.prisma.review.aggregate({
        where: { productId },
        _avg: { rating: true },
      }),
    ]);
    return {
      items,
      total,
      take,
      skip,
      averageRating: agg._avg.rating ?? 0,
    };
  }

  async upsertForProduct(
    productId: number,
    userId: number,
    input: UpsertReviewInput,
  ) {
    this.validate(input);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    const data = {
      rating: input.rating,
      title: input.title?.trim() || null,
      body: input.body.trim(),
    };
    return this.prisma.review.upsert({
      where: { productId_userId: { productId, userId } },
      create: { ...data, productId, userId },
      update: data,
      select: this.select,
    });
  }

  async update(
    reviewId: number,
    userId: number,
    role: 'CUSTOMER' | 'ADMIN',
    input: Partial<UpsertReviewInput>,
  ) {
    const existing = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!existing) throw new NotFoundException('Review not found');
    if (existing.userId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException('You can only edit your own reviews');
    }
    const next: UpsertReviewInput = {
      rating: input.rating ?? existing.rating,
      title: input.title === undefined ? existing.title : input.title,
      body: input.body ?? existing.body,
    };
    this.validate(next);
    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        rating: next.rating,
        title: next.title?.trim?.() || null,
        body: next.body.trim(),
      },
      select: this.select,
    });
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

  async listAll(params: { productId?: number; take?: number; skip?: number }) {
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const skip = Math.max(params.skip ?? 0, 0);
    const where = params.productId ? { productId: params.productId } : {};
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          ...this.select,
          product: { select: { id: true, name: true, slug: true } },
        },
        take,
        skip,
      }),
      this.prisma.review.count({ where }),
    ]);
    return { items, total, take, skip };
  }
}
