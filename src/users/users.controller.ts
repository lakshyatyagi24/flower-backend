import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  // Admin: list customers with order counts
  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get('customers')
  async listCustomers() {
    const users = await this.prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone,
      createdAt: u.createdAt,
      orderCount: u._count.orders,
    }));
  }
}
