import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ListParams {
  category?: string;
  q?: string;
  featured?: boolean;
  active?: boolean;
  take?: number;
  skip?: number;
}

interface ProductInput {
  name: string;
  slug?: string;
  description?: string;
  price: number;
  image?: string;
  stock?: number;
  featured?: boolean;
  active?: boolean;
  categoryId?: number | null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeImageUrl(input?: string | null): string | null {
  if (!input) return null;
  let value = String(input).trim();
  if (!value) return null;

  value = value.replace(/\\\//g, '/');

  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(value)) break;
    try {
      value = decodeURIComponent(value);
    } catch {
      break;
    }
  }

  value = value
    .replace(/^https::\/\//i, 'https://')
    .replace(/^http::\/\//i, 'http://')
    .replace(/^https:\/([^/])/i, 'https://$1')
    .replace(/^http:\/([^/])/i, 'http://$1');

  if (value.startsWith('//')) value = `https:${value}`;
  if (/^cdn\.shopify\.com\//i.test(value)) value = `https://${value}`;
  if (/^http:\/\/cdn\.shopify\.com/i.test(value)) value = value.replace(/^http:\/\//i, 'https://');

  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true,
    name: true,
    slug: true,
    description: true,
    price: true,
    image: true,
    stock: true,
    featured: true,
    active: true,
    categoryId: true,
    category: { select: { id: true, name: true, slug: true } },
    createdAt: true,
    updatedAt: true,
  } as const;

  private async attachRatings<T extends { id: number }>(products: T[]): Promise<(T & { averageRating: number; reviewCount: number })[]> {
    if (products.length === 0) return [];
    const ids = products.map((p) => p.id);
    const groups = await this.prisma.review.groupBy({
      by: ['productId'],
      where: { productId: { in: ids } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const map = new Map<number, { avg: number; count: number }>();
    for (const g of groups) {
      map.set(g.productId, { avg: g._avg.rating ?? 0, count: g._count._all });
    }
    return products.map((p) => {
      const stats = map.get(p.id);
      return {
        ...p,
        averageRating: stats?.avg ?? 0,
        reviewCount: stats?.count ?? 0,
      };
    });
  }

  private async attachRating<T extends { id: number }>(product: T): Promise<T & { averageRating: number; reviewCount: number }> {
    const agg = await this.prisma.review.aggregate({
      where: { productId: product.id },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return {
      ...product,
      averageRating: agg._avg.rating ?? 0,
      reviewCount: agg._count._all,
    };
  }

  async list(params: ListParams) {
    const where: Record<string, unknown> = {};
    if (params.active !== undefined) where.active = params.active;
    if (params.featured !== undefined) where.featured = params.featured;
    if (params.category) {
      where.category = { slug: params.category };
    }
    if (params.q) {
      const q = params.q;
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const skip = Math.max(params.skip ?? 0, 0);
    const [rawItems, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: this.select,
        take,
        skip,
      }),
      this.prisma.product.count({ where }),
    ]);
    const sanitizedItems = rawItems.map((item) => ({
      ...item,
      image: normalizeImageUrl(item.image),
    }));
    const items = await this.attachRatings(sanitizedItems);
    return { items, total, take, skip };
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug }, select: this.select });
    if (!product) throw new NotFoundException('Product not found');
    return this.attachRating({ ...product, image: normalizeImageUrl(product.image) });
  }

  async getById(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id }, select: this.select });
    if (!product) throw new NotFoundException('Product not found');
    return this.attachRating({ ...product, image: normalizeImageUrl(product.image) });
  }

  async create(input: ProductInput) {
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    if (typeof input.price !== 'number' || input.price < 0) throw new BadRequestException('Valid price is required');
    const slug = (input.slug?.trim() || slugify(input.name)).toLowerCase();
    if (!slug) throw new BadRequestException('Slug could not be derived');
    try {
      return await this.prisma.product.create({
        data: {
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          price: input.price,
          image: normalizeImageUrl(input.image ?? null),
          stock: input.stock ?? 0,
          featured: input.featured ?? false,
          active: input.active ?? true,
          categoryId: input.categoryId ?? null,
        },
        select: this.select,
      });
    } catch (e: any) {
      if (e?.code === 'P2002' && e.meta?.target?.includes?.('slug')) {
        throw new BadRequestException('A product with this slug already exists');
      }
      throw e;
    }
  }

  async update(id: number, input: Partial<ProductInput>) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.slug !== undefined) data.slug = slugify(input.slug);
    if (input.description !== undefined) data.description = input.description;
    if (input.price !== undefined) {
      if (typeof input.price !== 'number' || input.price < 0) throw new BadRequestException('Invalid price');
      data.price = input.price;
    }
    if (input.image !== undefined) data.image = normalizeImageUrl(input.image);
    if (input.stock !== undefined) data.stock = Math.max(0, Math.floor(input.stock));
    if (input.featured !== undefined) data.featured = !!input.featured;
    if (input.active !== undefined) data.active = !!input.active;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    try {
      return await this.prisma.product.update({ where: { id }, data, select: this.select });
    } catch (e: any) {
      if (e?.code === 'P2002' && e.meta?.target?.includes?.('slug')) {
        throw new BadRequestException('A product with this slug already exists');
      }
      throw e;
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { orderItems: { take: 1 } },
    });
    if (!existing) throw new NotFoundException('Product not found');
    if (existing.orderItems.length > 0) {
      // soft-disable instead of delete to preserve order history
      return this.prisma.product.update({
        where: { id },
        data: { active: false },
        select: this.select,
      });
    }
    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }
}
