import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

// Liveness only (no DB query). Uptime monitors poll this through nginx at
// https://api.freshpetalsindia.com/healthz; skip the throttler so a monitor
// (or a burst of checks from one IP) can never produce a false 429 alarm.
@SkipThrottle()
@Controller('healthz')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
