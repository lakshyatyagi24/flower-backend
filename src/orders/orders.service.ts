import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface OrderItemInput {
  productId: number;
  quantity: number;
}

interface CreateOrderInput {
  items: OrderItemInput[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress: string;
  city?: string;
  postalCode?: string;
  notes?: string;
  paymentMethod?: string;
}

const ALLOWED_STATUSES = ['PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'] as const;
type OrderStatus = (typeof ALLOWED_STATUSES)[number];

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private include = {
    items: {
      select: {
        id: true,
        productId: true,
        productName: true,
        quantity: true,
        unitPrice: true,
        gstRate: true,
        gstAmount: true,
        product: { select: { id: true, slug: true, image: true } },
      },
    },
    user: { select: { id: true, email: true, name: true } },
  } as const;

  private async loadShippingRate(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'shipping.flatRate' } });
    if (!setting) return 0;
    const v = parseFloat(setting.value);
    return isNaN(v) ? 0 : v;
  }

  private async loadFreeShippingThreshold(): Promise<number | null> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'shipping.freeThreshold' } });
    if (!setting) return null;
    const v = parseFloat(setting.value);
    return isNaN(v) ? null : v;
  }

  async create(userId: number | null, input: CreateOrderInput) {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException('Order must have at least one item');
    }
    if (!input.customerName?.trim()) throw new BadRequestException('Customer name is required');
    if (!input.customerEmail?.trim()) throw new BadRequestException('Customer email is required');
    if (!input.shippingAddress?.trim()) throw new BadRequestException('Shipping address is required');

    const productIds = input.items.map((i) => i.productId);
    type ProductRow = {
      id: number;
      name: string;
      price: number;
      stock: number;
      active: boolean;
      saleMode: 'PURCHASE' | 'ENQUIRY';
      gstRate: number;
      minOrderQty: number;
    };
    const products: ProductRow[] = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products are unavailable');
    }
    const productMap = new Map<number, ProductRow>(products.map((p) => [p.id, p]));

    let subtotal = 0;
    let gstTotal = 0;
    const itemRows = input.items.map((it) => {
      const product = productMap.get(it.productId)!;
      if (!product.active) throw new BadRequestException(`Product "${product.name}" is not available`);
      if (product.saleMode === 'ENQUIRY') {
        throw new BadRequestException(`"${product.name}" is enquiry-only — please send an enquiry instead`);
      }
      const qty = Math.max(product.minOrderQty || 1, Math.floor(it.quantity || 1));
      if (product.stock > 0 && qty > product.stock) {
        throw new BadRequestException(`Only ${product.stock} of "${product.name}" available`);
      }
      const lineTotal = product.price * qty;
      const gstRate = product.gstRate || 0;
      const gstAmount = +((lineTotal * gstRate) / 100).toFixed(2);
      subtotal += lineTotal;
      gstTotal += gstAmount;
      return {
        productId: product.id,
        productName: product.name,
        quantity: qty,
        unitPrice: product.price,
        gstRate,
        gstAmount,
      };
    });

    const flatRate = await this.loadShippingRate();
    const freeThreshold = await this.loadFreeShippingThreshold();
    const shipping = freeThreshold !== null && subtotal >= freeThreshold ? 0 : flatRate;
    const gst = +gstTotal.toFixed(2);
    const total = +(subtotal + shipping + gst).toFixed(2);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId: userId ?? null,
          subtotal,
          shipping,
          gst,
          total,
          status: 'PENDING',
          paymentMethod: input.paymentMethod || 'COD',
          customerName: input.customerName.trim(),
          customerEmail: input.customerEmail.trim().toLowerCase(),
          customerPhone: input.customerPhone?.trim() || null,
          shippingAddress: input.shippingAddress.trim(),
          city: input.city?.trim() || null,
          postalCode: input.postalCode?.trim() || null,
          notes: input.notes?.trim() || null,
          items: { create: itemRows },
        },
        include: this.include,
      });

      // Decrement stock for tracked products
      for (const it of itemRows) {
        const p = productMap.get(it.productId)!;
        if (p.stock > 0) {
          await tx.product.update({
            where: { id: p.id },
            data: { stock: { decrement: it.quantity } },
          });
        }
      }

      return order;
    });
  }

  async listMine(userId: number) {
    return this.prisma.order.findMany({
      where: { userId },
      include: this.include,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMine(userId: number, id: number) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Not your order');
    return order;
  }

  async track(id: number, email: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    if (!order) throw new NotFoundException('Order not found');
    if (!email || order.customerEmail?.toLowerCase() !== email.trim().toLowerCase()) {
      throw new ForbiddenException('Email does not match this order');
    }
    // Strip internal-only fields before returning to the public tracking endpoint.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { adminNotes: _adminNotes, ...publicOrder } = order;
    return publicOrder;
  }

  async listAll(params: { status?: string; take?: number; skip?: number }) {
    const where: Record<string, unknown> = {};
    if (params.status && (ALLOWED_STATUSES as readonly string[]).includes(params.status)) {
      where.status = params.status;
    }
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const skip = Math.max(params.skip ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: this.include,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, take, skip };
  }

  async getOne(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: this.include });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async updateStatus(id: number, status: string) {
    if (!(ALLOWED_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order not found');
    return this.prisma.order.update({
      where: { id },
      data: { status: status as OrderStatus },
      include: this.include,
    });
  }

  /**
   * Generic admin-only update for fulfillment fields. Each field is optional so
   * admins can edit a tracking number without re-supplying everything else.
   */
  async adminUpdate(
    id: number,
    patch: {
      status?: string;
      trackingNumber?: string | null;
      courierName?: string | null;
      adminNotes?: string | null;
      shippingAddress?: string | null;
      city?: string | null;
      postalCode?: string | null;
      customerPhone?: string | null;
    },
  ) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order not found');

    const data: Record<string, unknown> = {};
    if (patch.status !== undefined) {
      if (!(ALLOWED_STATUSES as readonly string[]).includes(patch.status)) {
        throw new BadRequestException('Invalid status');
      }
      data.status = patch.status as OrderStatus;
    }
    if (patch.trackingNumber !== undefined) data.trackingNumber = patch.trackingNumber || null;
    if (patch.courierName !== undefined) data.courierName = patch.courierName || null;
    if (patch.adminNotes !== undefined) data.adminNotes = patch.adminNotes || null;
    if (patch.shippingAddress !== undefined) data.shippingAddress = patch.shippingAddress || null;
    if (patch.city !== undefined) data.city = patch.city || null;
    if (patch.postalCode !== undefined) data.postalCode = patch.postalCode || null;
    if (patch.customerPhone !== undefined) data.customerPhone = patch.customerPhone || null;

    return this.prisma.order.update({
      where: { id },
      data,
      include: this.include,
    });
  }

  async stats() {
    const [orderCount, productCount, customerCount, totalAgg, recentOrders, openEnquiries] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
      this.prisma.order.aggregate({ _sum: { total: true } }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          customerName: true,
          total: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.enquiry.count({ where: { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } } }),
    ]);
    return {
      orderCount,
      productCount,
      customerCount,
      revenue: totalAgg._sum.total ?? 0,
      recentOrders,
      openEnquiries,
    };
  }
}
