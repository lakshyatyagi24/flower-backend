import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Count only ACTIVE products so storefront navigation can hide empty categories.
const ACTIVE_PRODUCT_COUNT = { _count: { select: { products: { where: { active: true } } } } } as const;

type WithCount<T extends { _count: { products: number } }> = Omit<T, '_count'> & { productCount: number };

function withProductCount<T extends { _count: { products: number }; children?: any[] }>(row: T): WithCount<T> {
  const { _count, children, ...rest } = row as any;
  return {
    ...rest,
    ...(children ? { children: children.map((c: any) => withProductCount(c)) } : {}),
    productCount: _count.products,
  };
}

const CATEGORY_BASE_FIELDS = {
  id: true,
  name: true,
  slug: true,
  image: true,
  description: true,
  productType: true,
  defaultSaleMode: true,
  defaultGstRate: true,
  sortOrder: true,
  active: true,
} as const;

const CATEGORY_WRITE_SELECT = {
  ...CATEGORY_BASE_FIELDS,
  parentId: true,
} as const;

const SLIDER_SELECT = {
  id: true,
  title: true,
  eyebrow: true,
  subtitle: true,
  alt: true,
  image: true,
  href: true,
  config: true,
  sortOrder: true,
  active: true,
} as const;

const CATEGORY_ORDER = [{ sortOrder: 'asc' }, { id: 'asc' }] as const;
const MAX_MAIN_CATEGORIES = 8;
const SLUG_TAKEN_MESSAGE = 'A category with this slug already exists. Please choose a different slug.';

interface SliderInput {
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  alt?: string;
  image?: string;
  href?: string;
  config?: any;
  sortOrder?: number;
  active?: boolean;
}

/** Slider fields that fall back to the existing value when not supplied on update. */
const SLIDER_MERGE_FIELDS = ['title', 'eyebrow', 'subtitle', 'alt', 'image', 'href', 'sortOrder', 'active'] as const;

/** Accept config as an object or a JSON string; throws 400 on malformed JSON. */
function parseSliderConfig(config: any): any {
  if (!config || typeof config !== 'string') return config;
  try {
    return JSON.parse(config);
  } catch (error) {
    throw new BadRequestException('Invalid JSON in config field');
  }
}

function rethrowCategoryError(error: any): never {
  if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
    throw new BadRequestException(SLUG_TAKEN_MESSAGE);
  }
  throw error;
}

function rethrowSliderError(error: any): never {
  if (error.code === 'P2002') {
    throw new BadRequestException('A slider with this sort order already exists');
  }
  throw error;
}

function mergeSliderUpdate(existing: any, data: SliderInput) {
  const merged: Record<string, unknown> = {};
  for (const key of SLIDER_MERGE_FIELDS) {
    merged[key] = data[key] !== undefined ? data[key] : existing[key];
  }
  merged.config = data.config !== undefined ? { ...existing.config, ...data.config } : existing.config;
  return merged;
}

@Injectable()
export class EcommerceService {
  constructor(private readonly prisma: PrismaService) {}

  // Return top-level active categories sorted by sortOrder
  async getCategories() {
    const rows = await this.prisma.category.findMany({
      where: { parentId: null, active: true },
      orderBy: [...CATEGORY_ORDER],
      select: {
        ...CATEGORY_BASE_FIELDS,
        ...ACTIVE_PRODUCT_COUNT,
        children: { select: { id: true, name: true, slug: true, active: true, ...ACTIVE_PRODUCT_COUNT } },
      },
    });
    return rows.map(withProductCount);
  }

  // Return all categories with full hierarchy (admin)
  async getAllCategories() {
    const rows = await this.prisma.category.findMany({
      orderBy: [...CATEGORY_ORDER],
      select: {
        ...CATEGORY_BASE_FIELDS,
        parentId: true,
        ...ACTIVE_PRODUCT_COUNT,
        children: {
          select: { ...ACTIVE_PRODUCT_COUNT, ...CATEGORY_BASE_FIELDS, parentId: true },
          orderBy: [...CATEGORY_ORDER],
        },
      },
    });
    return rows.map(withProductCount);
  }

  // Create a new category
  async createCategory(data: {
    name: string;
    slug: string;
    image?: string;
    description?: string;
    parentId?: number;
    productType?: 'CUT_FLOWER' | 'PLANT' | 'BOUQUET' | 'ARRANGEMENT' | 'HAMPER';
    defaultSaleMode?: 'PURCHASE' | 'ENQUIRY';
    defaultGstRate?: number;
    sortOrder?: number;
    active?: boolean;
  }) {
    if (!data.parentId) await this.assertMainCategoryCapacity();

    try {
      return await this.prisma.category.create({
        data: {
          name: data.name,
          slug: data.slug,
          image: data.image,
          description: data.description,
          parentId: data.parentId ?? null,
          productType: data.productType ?? 'CUT_FLOWER',
          defaultSaleMode: data.defaultSaleMode ?? 'PURCHASE',
          defaultGstRate: typeof data.defaultGstRate === 'number' ? data.defaultGstRate : 0,
          sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
          active: data.active ?? true,
        },
        select: CATEGORY_WRITE_SELECT,
      });
    } catch (error: any) {
      rethrowCategoryError(error);
    }
  }

  // Enforce the cap on active top-level categories
  private async assertMainCategoryCapacity() {
    const mainCategoryCount = await this.prisma.category.count({
      where: { parentId: null, active: true },
    });
    if (mainCategoryCount >= MAX_MAIN_CATEGORIES) {
      throw new BadRequestException('Maximum 8 main categories allowed');
    }
  }

  // Update an existing category
  async updateCategory(id: number, data: {
    name?: string;
    slug?: string;
    image?: string;
    description?: string;
    productType?: 'CUT_FLOWER' | 'PLANT' | 'BOUQUET' | 'ARRANGEMENT' | 'HAMPER';
    defaultSaleMode?: 'PURCHASE' | 'ENQUIRY';
    defaultGstRate?: number;
    sortOrder?: number;
    active?: boolean;
  }) {
    try {
      return await this.prisma.category.update({
        where: { id },
        data,
        select: CATEGORY_WRITE_SELECT,
      });
    } catch (error: any) {
      rethrowCategoryError(error);
    }
  }

  // Delete a category
  async deleteCategory(id: number) {
    // Check if category has children or products
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        products: true,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category.children.length > 0) {
      throw new BadRequestException('Cannot delete category with subcategories');
    }

    if (category.products.length > 0) {
      throw new BadRequestException('Cannot delete category with associated products');
    }

    return this.prisma.category.delete({
      where: { id },
    });
  }

  // Simple products endpoint used by other features
  async getProducts() {
    return this.prisma.product.findMany({ take: 20, select: { id: true, name: true, slug: true, price: true } });
  }

  // Return sliders with optional inactive inclusion
  async getSliders(includeInactive: boolean = false) {
    return this.prisma.slider.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: SLIDER_SELECT,
    });
  }

  // Get single slider by ID
  async getSlider(id: number) {
    const slider = await this.prisma.slider.findUnique({
      where: { id },
      select: SLIDER_SELECT,
    });

    if (!slider) {
      throw new NotFoundException('Slider not found');
    }

    return slider;
  }

  // Create a new slider
  async createSlider(data: {
    title?: string;
    eyebrow?: string;
    subtitle?: string;
    alt?: string;
    image?: string;
    href?: string;
    config?: any;
    sortOrder?: number;
    active?: boolean;
  }) {
    data.config = parseSliderConfig(data.config);

    if (data.sortOrder === undefined || data.sortOrder === null) {
      data.sortOrder = await this.nextSliderSortOrder();
    }

    // sortOrder is intentionally not unique — see updateSlider. Ordering is
    // stabilized by an id tiebreak in getSliders().

    try {
      return await this.prisma.slider.create({
        data: {
          title: data.title || null,
          eyebrow: data.eyebrow || null,
          subtitle: data.subtitle || null,
          alt: data.alt || null,
          image: data.image || null,
          href: data.href || null,
          config: data.config || {},
          sortOrder: data.sortOrder,
          active: data.active !== undefined ? data.active : true,
        },
        select: SLIDER_SELECT,
      });
    } catch (error: any) {
      rethrowSliderError(error);
    }
  }

  // Maximum existing sortOrder plus one
  private async nextSliderSortOrder(): Promise<number> {
    const result = await this.prisma.slider.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (result ? result.sortOrder : 0) + 1;
  }

  // Update an existing slider
  async updateSlider(id: number, data: {
    title?: string;
    eyebrow?: string;
    subtitle?: string;
    alt?: string;
    image?: string;
    href?: string;
    config?: any;
    sortOrder?: number;
    active?: boolean;
  }) {
    // Check if slider exists
    const existingSlider = await this.prisma.slider.findUnique({
      where: { id },
    });

    if (!existingSlider) {
      throw new NotFoundException('Slider not found');
    }

    data.config = parseSliderConfig(data.config);

    // NOTE: sortOrder is intentionally NOT unique. The admin reorder feature
    // swaps two sliders' sortOrder values with two parallel updates; a
    // uniqueness guard here made every swap fail. Ties are broken by id in
    // getSliders(), so transient/duplicate sortOrders are harmless.

    try {
      return await this.prisma.slider.update({
        where: { id },
        data: mergeSliderUpdate(existingSlider, data) as any,
        select: SLIDER_SELECT,
      });
    } catch (error: any) {
      rethrowSliderError(error);
    }
  }

  // Delete a slider
  async deleteSlider(id: number) {
    // Check if slider exists
    const slider = await this.prisma.slider.findUnique({
      where: { id },
    });

    if (!slider) {
      throw new NotFoundException('Slider not found');
    }

    return this.prisma.slider.delete({
      where: { id },
    });
  }
}
