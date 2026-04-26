import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CurrentUser, JwtAuthGuard, OptionalJwtAuthGuard, Roles } from '../auth/auth.guard';
import { JwtPayload } from '../auth/jwt.util';

interface CreateOrderBody {
  items: { productId: number; quantity: number }[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  shippingAddress: string;
  city?: string;
  postalCode?: string;
  notes?: string;
  paymentMethod?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Anyone (logged in or guest) can place an order
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  async create(@Body() body: CreateOrderBody, @Req() req: { user?: JwtPayload }) {
    return this.orders.create(req.user?.sub ?? null, body);
  }

  // Authenticated user's own orders
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  async listMine(@CurrentUser() user: JwtPayload) {
    return this.orders.listMine(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine/:id')
  async getMine(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    return this.orders.getMine(user.sub, numeric);
  }

  // Public tracking by order id + email
  @Get('track/:id')
  async track(@Param('id') id: string, @Query('email') email: string) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    if (!email) throw new BadRequestException('Email is required to track order');
    return this.orders.track(numeric, email);
  }

  // Admin endpoints
  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get()
  async listAll(
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.orders.listAll({
      status,
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get('stats')
  async stats() {
    return this.orders.stats();
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    return this.orders.getOne(numeric);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    return this.orders.updateStatus(numeric, body.status);
  }
}
