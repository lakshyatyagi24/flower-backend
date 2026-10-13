import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CurrentUser, JwtAuthGuard, OptionalJwtAuthGuard, Roles } from '../auth/auth.guard';
import { JwtPayload } from '../auth/jwt.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { SetPaymentMethodDto } from './dto/set-payment-method.dto';
import { AdminUpdateOrderDto } from './dto/admin-update-order.dto';
import { TrackOrderDto } from './dto/track-order.dto';

// GET and POST tracking share ONE bucket per client, so the combined limit is 20/min.
const TRACK_BUCKET = (_ctx: unknown, tracker: string, name: string) => `order-track-${name}-${tracker}`;

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Anyone (logged in or guest) can place an order. Tighter than the global limit: a guest can put any
  // email on an order, so this also bounds confirmation-mail spam towards a third party.
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  async create(@Body() body: CreateOrderDto, @Req() req: { user?: JwtPayload }) {
    return this.orders.create(req.user?.sub ?? null, body);
  }

  // Customer switches their own unpaid online order to cash on delivery (logged-in owner, or guest + email).
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Put(':id/payment-method')
  async setPaymentMethod(
    @Param('id') id: string,
    @Body() body: SetPaymentMethodDto,
    @Req() req: { user?: JwtPayload },
  ) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    return this.orders.switchToCod(numeric, req.user?.sub ?? null, body.email ?? null);
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

  // Public tracking by order id + email, email in the BODY (preferred: never reaches access logs).
  @Throttle({ default: { limit: 20, ttl: 60_000, generateKey: TRACK_BUCKET } })
  @HttpCode(200)
  @Post('track/:id')
  async trackPost(@Param('id') id: string, @Body() body: TrackOrderDto) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    return this.orders.track(numeric, body.email);
  }

  // Legacy: email in the query string (ends up in access logs). Kept so older clients and links keep working;
  // the storefront uses the POST variant above.
  @Throttle({ default: { limit: 20, ttl: 60_000, generateKey: TRACK_BUCKET } })
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
    @Query('paymentStatus') paymentStatus?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('attention') attention?: string,
    @Query('sort') sort?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.orders.listAll({
      status: typeof status === 'string' ? status : undefined,
      paymentStatus: typeof paymentStatus === 'string' ? paymentStatus : undefined,
      paymentMethod: typeof paymentMethod === 'string' ? paymentMethod : undefined,
      attention: typeof attention === 'string' ? attention : undefined,
      sort: typeof sort === 'string' ? sort : undefined,
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
  async updateStatus(@Param('id') id: string, @Body() body: UpdateStatusDto) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    return this.orders.updateStatus(numeric, body.status);
  }

  // Generic admin patch endpoint. Used to update tracking, courier, admin notes
  // and editable customer/address fields without forcing the whole order through.
  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Put(':id')
  async adminUpdate(
    @Param('id') id: string,
    @Body() body: AdminUpdateOrderDto,
  ) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid order ID');
    return this.orders.adminUpdate(numeric, body);
  }
}
