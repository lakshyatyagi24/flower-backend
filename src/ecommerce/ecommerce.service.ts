import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EcommerceService {
  constructor(private readonly prisma: PrismaService) {}

  // Return top-level categories with minimal fields and children
  async getCategories() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        children: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  // Return all categories with full hierarchy
  async getAllCategories() {
    return this.prisma.category.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        parentId: true,
        children: {
          select: { id: true, name: true, slug: true, image: true, parentId: true },
          orderBy: { id: 'asc' },
        },
      },
    });
  }

  // Create a new category
  async createCategory(data: { name: string; slug: string; image?: string; parentId?: number }) {
    // Check if creating a main category and enforce 8 limit
    if (!data.parentId) {
      const mainCategoryCount = await this.prisma.category.count({
        where: { parentId: null },
      });
      if (mainCategoryCount >= 8) {
        throw new BadRequestException('Maximum 8 main categories allowed');
      }
    }

    try {
      return await this.prisma.category.create({
        data,
        select: {
          id: true,
          name: true,
          slug: true,
          image: true,
          parentId: true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
        throw new BadRequestException('A category with this slug already exists. Please choose a different slug.');
      }
      throw error;
    }
  }

  // Update an existing category
  async updateCategory(id: number, data: { name?: string; slug?: string; image?: string }) {
    try {
      return await this.prisma.category.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          slug: true,
          image: true,
          parentId: true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
        throw new BadRequestException('A category with this slug already exists. Please choose a different slug.');
      }
      throw error;
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
      throw new BadRequestException('Category not found');
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
      orderBy: { sortOrder: 'asc' },
      select: {
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
      },
    });
  }

  // Get single slider by ID
  async getSlider(id: number) {
    const slider = await this.prisma.slider.findUnique({
      where: { id },
      select: {
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
      },
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
    // Validate config JSON if provided
    if (data.config && typeof data.config === 'string') {
      try {
        data.config = JSON.parse(data.config);
      } catch (error) {
        throw new BadRequestException('Invalid JSON in config field');
      }
    }

    // Set default sortOrder if not provided
    if (data.sortOrder === undefined || data.sortOrder === null) {
      // Get the maximum sortOrder and add 1
      const result = await this.prisma.slider.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const maxSort = result ? result.sortOrder : 0;
      data.sortOrder = maxSort + 1;
    }

    // Validate sortOrder uniqueness
    const existingSlider = await this.prisma.slider.findFirst({
      where: { sortOrder: data.sortOrder },
    });
    if (existingSlider) {
      throw new BadRequestException(`A slider with sort order ${data.sortOrder} already exists. Please choose a different sort order.`);
    }

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
        select: {
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
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException('A slider with this sort order already exists');
      }
      throw error;
    }
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

    // Validate config JSON if provided
    if (data.config && typeof data.config === 'string') {
      try {
        data.config = JSON.parse(data.config);
      } catch (error) {
        throw new BadRequestException('Invalid JSON in config field');
      }
    }

    // Validate sortOrder uniqueness if being updated
    if (data.sortOrder !== undefined && data.sortOrder !== existingSlider.sortOrder) {
      const conflictingSlider = await this.prisma.slider.findFirst({
        where: { sortOrder: data.sortOrder },
      });
      if (conflictingSlider) {
        throw new BadRequestException('A slider with this sort order already exists');
      }
    }

    try {
      return await this.prisma.slider.update({
        where: { id },
        data: {
          title: data.title !== undefined ? data.title : existingSlider.title,
          eyebrow: data.eyebrow !== undefined ? data.eyebrow : existingSlider.eyebrow,
          subtitle: data.subtitle !== undefined ? data.subtitle : existingSlider.subtitle,
          alt: data.alt !== undefined ? data.alt : existingSlider.alt,
          image: data.image !== undefined ? data.image : existingSlider.image,
          href: data.href !== undefined ? data.href : existingSlider.href,
          config: data.config !== undefined ? data.config : existingSlider.config,
          sortOrder: data.sortOrder !== undefined ? data.sortOrder : existingSlider.sortOrder,
          active: data.active !== undefined ? data.active : existingSlider.active,
        },
        select: {
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
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BadRequestException('A slider with this sort order already exists');
      }
      throw error;
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
