import { Injectable, BadRequestException } from '@nestjs/common';
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

    return this.prisma.category.create({
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        parentId: true,
      },
    });
  }

  // Update an existing category
  async updateCategory(id: number, data: { name?: string; slug?: string; image?: string }) {
    return this.prisma.category.update({
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

  // Return active sliders ordered by sortOrder (include config JSON)
  async getSliders() {
    return this.prisma.slider.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, title: true, eyebrow: true, subtitle: true, alt: true, image: true, href: true, config: true },
    });
  }
}
