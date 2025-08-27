import { Injectable } from '@nestjs/common';
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
