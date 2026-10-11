import { Body, Controller, Headers, HttpCode, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
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

  /** Called by Razorpay, not browsers: no auth, signature-checked over the raw body. */
  @SkipThrottle()
  @HttpCode(200)
  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}
