import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { isIndianPin } from '../common/validators';
import { DeliveryService } from './delivery.service';

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('check')
  async check(
    @Query('pincode') pincode?: string,
  ): Promise<{ serviceable: boolean; restricted?: boolean; message: string }> {
    const pin = typeof pincode === 'string' ? pincode.trim() : '';
    if (!isIndianPin(pin)) {
      return { serviceable: false, message: 'Enter a valid 6-digit PIN code.' };
    }
    const { serviceable, restricted } = await this.delivery.check(pin);
    if (!restricted) {
      // No service area configured: do not claim we deliver; the order is confirmed at checkout.
      return { serviceable: true, restricted: false, message: "We'll confirm delivery to your PIN code at checkout." };
    }
    return {
      serviceable,
      restricted: true,
      message: serviceable ? 'We deliver to this PIN code.' : 'We do not deliver to this PIN code yet.',
    };
  }
}
