import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto, ValidateCouponDto } from './dto/coupon.dto';

function parseId(id: string): number {
  const n = parseInt(id, 10);
  if (isNaN(n)) throw new BadRequestException('Invalid coupon ID');
  return n;
}

@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  // Public preview for the checkout. Tight per-IP limit: it is a code-guessing surface. Unknown and inactive
  // codes get the same error. Returns only what the shopper needs, never usage counters or limits.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('validate')
  async validate(@Body() body: ValidateCouponDto) {
    const { discount, coupon } = await this.coupons.validate(body.code, body.subtotal);
    return { code: coupon.code, type: coupon.type, value: coupon.value, discount };
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
