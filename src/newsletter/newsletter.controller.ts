import { Body, Controller, Get, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';
import { NewsletterService } from './newsletter.service';
import { SubscribeDto } from './dto/subscribe.dto';

function toInt(raw: string | undefined, def: number, max?: number): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return def;
  const n = parseInt(raw, 10);
  return max !== undefined ? Math.min(n, max) : n;
}

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly svc: NewsletterService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  async subscribe(@Body() body: SubscribeDto) {
    await this.svc.subscribe(body.email, body.source ?? 'footer');
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard) @Roles('ADMIN') @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="subscribers.csv"')
  export() {
    return this.svc.exportCsv();
  }

  @UseGuards(JwtAuthGuard) @Roles('ADMIN') @Get()
  list(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.svc.list(toInt(take, 50, 500), toInt(skip, 0));
  }
}
