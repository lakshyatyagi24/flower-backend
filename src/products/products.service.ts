import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ListParams {
  category?: string;
  q?: string;
  featured?: boolean;
  active?: boolean;
  productType?: string;
  saleMode?: string;
  take?: number;
  skip?: number;
  tag?: string;
  sort?: string;
  page?: number;
}

type ProductTypeValue = 'CUT_FLOWER' | 'PLANT' | 'BOUQUET' | 'ARRANGEMENT' | 'HAMPER';
type SaleModeValue = 'PURCHASE' | 'ENQUIRY';

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
  productType?: ProductTypeValue;
  saleMode?: SaleModeValue;
  gstRate?: number;
  unit?: string;
  minOrderQty?: number;
  tags?: string[];
}

const VALID_PRODUCT_TYPES: ProductTypeValue[] = ['CUT_FLOWER', 'PLANT', 'BOUQUET', 'ARRANGEMENT', 'HAMPER'];
const VALID_SALE_MODES: SaleModeValue[] = ['PURCHASE', 'ENQUIRY'];

/** Listing bounds: take is capped (admin screens request up to 200); page is capped so skip stays a small int. */
export const MAX_TAKE = 200;
export const MAX_PAGE = 100000;
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_MAX_LEN = 40;
const TAG_MAX_COUNT = 20;
const TAG_ERROR = 'Tags must be lowercase letters, numbers and hyphens';

/** Trim, lowercase and de-duplicate tags; throws 400 if any is not a valid slug or there are too many. */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) throw new BadRequestException('Tags must be an array');
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') throw new BadRequestException(TAG_ERROR);
    const tag = raw.trim().toLowerCase();
    if (!tag || tag.length > TAG_MAX_LEN || !TAG_RE.test(tag)) throw new BadRequestException(TAG_ERROR);
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > TAG_MAX_COUNT) throw new BadRequestException(`A product can have at most ${TAG_MAX_COUNT} tags`);
  return out;
}

const SORT_ORDERS: Record<string, Record<string, unknown>[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  price_asc: [{ price: 'asc' }, { id: 'desc' }],
  price_desc: [{ price: 'desc' }, { id: 'desc' }],
  // `popular` is handled separately in list(): Prisma cannot order by a FILTERED relation count, and
  // only APPROVED reviews may count (R22). The tiebreak matches `newest`.
  popular: [{ createdAt: 'desc' }, { id: 'desc' }],
};

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

  // Inline base64 data URIs — the admin product form uploads images this way
  // (reader.readAsDataURL). Pass them through untouched instead of nulling them.
  if (/^data:image\//i.test(value)) return value;

  // Site-relative paths (e.g. /images/x.jpg) are valid storefront images; keep them.
  if (/^\/(?!\/)/.test(value)) return value;

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

  // Upgrade bare-http remote hosts to https. The storefront renders images
  // with next/image, which only whitelists http for localhost; a plain-http
  // remote URL saves fine but crashes the storefront at render time.
  if (
    /^http:\/\//i.test(value) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value)
  ) {
    value = value.replace(/^http:\/\//i, 'https://');
  }

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
    productType: true,
    saleMode: true,
    gstRate: true,
    unit: true,
    minOrderQty: true,
    tags: true,
    categoryId: true,
    category: { select: { id: true, name: true, slug: true, productType: true, defaultSaleMode: true } },
    createdAt: true,
    updatedAt: true,
  } as const;

  private async attachRatings<T extends { id: number }>(products: T[]): Promise<(T & { averageRating: number; reviewCount: number })[]> {
    if (products.length === 0) return [];
    const ids = products.map((p) => p.id);
    const groups = await this.prisma.review.groupBy({
      by: ['productId'],
      where: { productId: { in: ids }, status: 'APPROVED' },
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
      where: { productId: product.id, status: 'APPROVED' },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return {
      ...product,
      averageRating: agg._avg.rating ?? 0,
      reviewCount: agg._count._all,
    };
  }

  /**
   * `popular` = most APPROVED reviews first, then newest. The catalogue is small, so rank all matching
   * ids in memory (id + createdAt only), slice the page, then load full rows for just that page.
   */
  private async fetchPopularPage(where: Record<string, unknown>, take: number, skip: number): Promise<[any[], number]> {
    const all = (await this.prisma.product.findMany({
      where,
      select: { id: true, createdAt: true },
    } as any)) as Array<{ id: number; createdAt: Date }>;
    const total = all.length;
    const groups = all.length
      ? await this.prisma.review.groupBy({
          by: ['productId'],
          where: { productId: { in: all.map((p) => p.id) }, status: 'APPROVED' },
          _count: { _all: true },
        })
      : [];
    const counts = new Map<number, number>(groups.map((g) => [g.productId, g._count._all]));
    all.sort(
      (a, b) =>
        (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
        b.id - a.id,
    );
    const pageIds = all.slice(skip, skip + take).map((p) => p.id);
    if (pageIds.length === 0) return [[], total];
    const rows = (await this.prisma.product.findMany({
      where: { id: { in: pageIds } },
      select: this.select,
    } as any)) as Array<{ id: number; image: string | null }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return [pageIds.map((id) => byId.get(id)).filter((r) => !!r), total];
  }

  async list(params: ListParams) {
    const where: Record<string, unknown> = {};
    if (params.active !== undefined) where.active = params.active;
    if (params.featured !== undefined) where.featured = params.featured;
    if (params.category) {
      where.category = { slug: params.category };
    }
    if (params.productType && VALID_PRODUCT_TYPES.includes(params.productType as ProductTypeValue)) {
      where.productType = params.productType;
    }
    if (params.saleMode && VALID_SALE_MODES.includes(params.saleMode as SaleModeValue)) {
      where.saleMode = params.saleMode;
    }
    if (typeof params.tag === 'string' && TAG_RE.test(params.tag) && params.tag.length <= TAG_MAX_LEN) {
      where.tags = { has: params.tag };
    }
    if (params.q) {
      const q = params.q;
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    const takeIn = Number.isFinite(params.take) ? Math.trunc(params.take as number) : 50;
    const take = Math.min(Math.max(takeIn, 1), MAX_TAKE);
    const pageGiven =
      typeof params.page === 'number' && Number.isInteger(params.page) && params.page >= 1;
    const skipIn = Number.isFinite(params.skip) ? Math.trunc(params.skip as number) : 0;
    // Bounded so a hostile ?page=1e20 / ?skip=1e20 can never reach Prisma as an
    // absurd offset (that would 500 on a public route).
    const page = pageGiven ? Math.min(params.page as number, MAX_PAGE) : undefined;
    const skip = page !== undefined ? (page - 1) * take : Math.min(Math.max(skipIn, 0), MAX_PAGE * MAX_TAKE);
    const pageOut = page ?? Math.floor(skip / take) + 1;
    const orderBy = Object.prototype.hasOwnProperty.call(SORT_ORDERS, params.sort ?? '')
      ? SORT_ORDERS[params.sort as string]
      : SORT_ORDERS.newest;
    const productPage = () =>
      this.prisma.product.findMany({ where, orderBy, select: this.select, take, skip });
    let rawItems: Awaited<ReturnType<typeof productPage>>;
    let total: number;
    if (params.sort === 'popular') {
      [rawItems, total] = await this.fetchPopularPage(where, take, skip);
    } else {
      [rawItems, total] = await Promise.all([productPage(), this.prisma.product.count({ where })]);
    }
    const sanitizedItems = rawItems.map((item) => ({
      ...item,
      image: normalizeImageUrl(item.image),
    }));
    const items = await this.attachRatings(sanitizedItems);
    return { items, total, take, skip, page: pageOut, pages: Math.max(1, Math.ceil(total / take)) };
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
    const saleMode: SaleModeValue = input.saleMode && VALID_SALE_MODES.includes(input.saleMode) ? input.saleMode : 'PURCHASE';
    if (saleMode === 'PURCHASE') {
      if (typeof input.price !== 'number' || input.price < 0) throw new BadRequestException('Valid price is required for purchase products');
    }
    // Always slugify (same as update): an explicit slug with &, <, spaces or capitals must not reach URLs/sitemaps.
    const slug = slugify(input.slug ?? '') || slugify(input.name);
    if (!slug) throw new BadRequestException('Slug could not be derived');
    const productType: ProductTypeValue = input.productType && VALID_PRODUCT_TYPES.includes(input.productType) ? input.productType : 'CUT_FLOWER';
    try {
      return await this.prisma.product.create({
        data: {
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          price: typeof input.price === 'number' ? input.price : 0,
          image: normalizeImageUrl(input.image ?? null),
          stock: input.stock ?? 0,
          featured: input.featured ?? false,
          active: input.active ?? true,
          productType,
          saleMode,
          gstRate: typeof input.gstRate === 'number' && input.gstRate >= 0 ? input.gstRate : 0,
          unit: input.unit?.trim() || 'piece',
          minOrderQty: input.minOrderQty && input.minOrderQty > 0 ? Math.floor(input.minOrderQty) : 1,
          categoryId: input.categoryId ?? null,
          tags: input.tags === undefined ? [] : normalizeTags(input.tags),
        },
        select: this.select,
      });
    } catch (e: any) {
      if (e?.code === 'P2002' && e.meta?.target?.includes?.('slug')) {
        throw new BadRequestException('A product with this slug already exists');
      }
      if (e?.code === 'P2003') {
        throw new BadRequestException('Selected category does not exist');
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
    if (input.productType !== undefined) {
      if (!VALID_PRODUCT_TYPES.includes(input.productType)) throw new BadRequestException('Invalid productType');
      data.productType = input.productType;
    }
    if (input.saleMode !== undefined) {
      if (!VALID_SALE_MODES.includes(input.saleMode)) throw new BadRequestException('Invalid saleMode');
      data.saleMode = input.saleMode;
    }
    if (input.gstRate !== undefined) {
      if (typeof input.gstRate !== 'number' || input.gstRate < 0) throw new BadRequestException('Invalid gstRate');
      data.gstRate = input.gstRate;
    }
    if (input.unit !== undefined) data.unit = input.unit?.trim() || 'piece';
    if (input.minOrderQty !== undefined) {
      data.minOrderQty = input.minOrderQty && input.minOrderQty > 0 ? Math.floor(input.minOrderQty) : 1;
    }
    if (input.tags !== undefined) data.tags = normalizeTags(input.tags);
    try {
      return await this.prisma.product.update({ where: { id }, data, select: this.select });
    } catch (e: any) {
      if (e?.code === 'P2002' && e.meta?.target?.includes?.('slug')) {
        throw new BadRequestException('A product with this slug already exists');
      }
      if (e?.code === 'P2003') {
        throw new BadRequestException('Selected category does not exist');
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
