import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OptionalJwtAuthGuard } from '../auth/auth.guard';
import { JwtPayload } from '../auth/jwt.util';
import { PaymentsService } from './payments.service';
import { CreateRzpOrderDto } from './dto/create-rzp-order.dto';
import { VerifyDto } from './dto/verify.dto';

@Controller('payments/razorpay')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('order')
  create(@Body() body: CreateRzpOrderDto, @Req() req: { user?: JwtPayload }) {
    return this.payments.createRazorpayOrder(body.orderId, req.user?.sub ?? null, body.email ?? null);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify')
  verify(@Body() body: VerifyDto) {
    return this.payments.verify(body);
  }
}
