import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { InMemoryResetTokenStore } from './reset-token-sink';

@Controller('auth/_test')
export class TestSupportController {
  constructor(private readonly store: InMemoryResetTokenStore) {}

  @Get('last-reset-token')
  lastResetToken(@Query('email') email?: string) {
    const token = email ? this.store.last(email) : undefined;
    if (!token) throw new NotFoundException();
    return { token };
  }
}
