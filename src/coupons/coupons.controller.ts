import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto, ValidateCouponDto } from './dto/coupon.dto';

function parseId(id: string): number {
  // Strict: digits only (parseInt would accept "1abc" as 1), and small enough for a Postgres int.
  if (!/^[0-9]{1,9}$/.test(id)) throw new BadRequestException('Invalid coupon ID');
  return Number(id);
}

@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  // Public preview for the checkout. Tight per-IP limit: it is a code-guessing surface. Unknown, inactive, expired and used-up
  // codes all get the same "not found" here (order creation keeps the specific reasons). Returns only what the shopper needs, never usage counters or limits.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('validate')
  async validate(@Body() body: ValidateCouponDto) {
    const { discount, coupon } = await this.coupons.validate(body.code, body.subtotal, undefined, { hideFinished: true });
    // minTotal: the checkout blocks an order whose total (after discount, shipping and GST) would be below it.
    return { code: coupon.code, type: coupon.type, value: coupon.value, discount, minTotal: this.coupons.minTotal };
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get()
  list() {
    return this.coupons.list();
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Post()
  create(@Body() body: CreateCouponDto) {
    return this.coupons.create(body);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateCouponDto) {
    return this.coupons.update(parseId(id), body);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.coupons.remove(parseId(id));
  }
}
