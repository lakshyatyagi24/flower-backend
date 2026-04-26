import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // Public — used by storefront for store name, contact, shipping thresholds
  @Get()
  async getPublic() {
    return this.settings.getPublic();
  }

  // Admin only — full settings including secrets
  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get('admin')
  async getAll() {
    return this.settings.getAll();
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Put()
  async update(@Body() body: Record<string, string>) {
    return this.settings.upsert(body);
  }
}
