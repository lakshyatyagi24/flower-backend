import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type EnquiryStatusValue = 'NEW' | 'CONTACTED' | 'QUOTED' | 'CONVERTED' | 'CLOSED';
const VALID_STATUSES: EnquiryStatusValue[] = ['NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'CLOSED'];

interface CreateEnquiryInput {
  productId?: number | null;
  productName?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  quantity?: number;
  eventDate?: string;
  occasion?: string;
  budget?: number;
  address?: string;
  city?: string;
  message?: string;
  source?: string;
  userId?: number | null;
}

interface ListParams {
  status?: string;
  take?: number;
  skip?: number;
}

const PHONE_REGEX = /^[+\d][\d\s\-()]{6,18}$/;

@Injectable()
export class EnquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true,
    userId: true,
    productId: true,
    productName: true,
    customerName: true,
    customerEmail: true,
    customerPhone: true,
    quantity: true,
    eventDate: true,
    occasion: true,
    budget: true,
    address: true,
    city: true,
    message: true,
    source: true,
    status: true,
    adminNotes: true,
    createdAt: true,
    updatedAt: true,
    product: { select: { id: true, name: true, slug: true } },
    user: { select: { id: true, email: true, name: true } },
  } as const;

  async create(input: CreateEnquiryInput) {
    const name = input.customerName?.trim();
    const phone = input.customerPhone?.trim();
    if (!name) throw new BadRequestException('Name is required');
    if (!phone || !PHONE_REGEX.test(phone)) throw new BadRequestException('Valid phone number is required');

    const email = input.customerEmail?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Invalid email');
    }

    let productName = input.productName?.trim() || null;
    if (input.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: input.productId } });
      if (!product) throw new BadRequestException('Product does not exist');
      if (!productName) productName = product.name;
    }

    let eventDate: Date | null = null;
    if (input.eventDate) {
      const parsed = new Date(input.eventDate);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid event date');
      eventDate = parsed;
    }

    return this.prisma.enquiry.create({
      data: {
        userId: input.userId ?? null,
        productId: input.productId ?? null,
        productName,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        quantity: input.quantity && input.quantity > 0 ? Math.floor(input.quantity) : null,
        eventDate,
        occasion: input.occasion?.trim() || null,
        budget: typeof input.budget === 'number' && input.budget >= 0 ? input.budget : null,
        address: input.address?.trim() || null,
        city: input.city?.trim() || null,
        message: input.message?.trim() || null,
        source: input.source?.trim() || 'website',
      },
      select: this.select,
    });
  }

  async list(params: ListParams) {
    const where: Record<string, unknown> = {};
    if (params.status) {
      if (!VALID_STATUSES.includes(params.status as EnquiryStatusValue)) {
        throw new BadRequestException('Invalid status');
      }
      where.status = params.status;
    }
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const skip = Math.max(params.skip ?? 0, 0);
    const [items, total, openCount] = await Promise.all([
      this.prisma.enquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: this.select,
        take,
        skip,
      }),
      this.prisma.enquiry.count({ where }),
      this.prisma.enquiry.count({ where: { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } } }),
    ]);
    return { items, total, take, skip, openCount };
  }

  async getById(id: number) {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id }, select: this.select });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    return enquiry;
  }

  async updateStatus(id: number, status: string, adminNotes?: string) {
    if (!VALID_STATUSES.includes(status as EnquiryStatusValue)) {
      throw new BadRequestException('Invalid status');
    }
    const existing = await this.prisma.enquiry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Enquiry not found');
    return this.prisma.enquiry.update({
      where: { id },
      data: {
        status: status as EnquiryStatusValue,
        ...(adminNotes !== undefined ? { adminNotes: adminNotes || null } : {}),
      },
      select: this.select,
    });
  }

  async stats() {
    const groups = await this.prisma.enquiry.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus: Record<EnquiryStatusValue, number> = {
      NEW: 0,
      CONTACTED: 0,
      QUOTED: 0,
      CONVERTED: 0,
      CLOSED: 0,
    };
    for (const g of groups) {
      byStatus[g.status as EnquiryStatusValue] = g._count._all;
    }
    const open = byStatus.NEW + byStatus.CONTACTED + byStatus.QUOTED;
    const total = open + byStatus.CONVERTED + byStatus.CLOSED;
    return { byStatus, open, total };
  }
}
