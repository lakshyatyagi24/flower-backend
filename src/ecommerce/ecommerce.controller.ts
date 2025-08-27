import { Controller, Get } from '@nestjs/common';
import { EcommerceService } from './ecommerce.service';

@Controller()
export class EcommerceController {
  constructor(private readonly ecommerceService: EcommerceService) {}

  // GET /categories -> top-level categories
  @Get('categories')
  async findAll() {
    return this.ecommerceService.getCategories();
  }

  // GET /sliders -> homepage sliders
  @Get('sliders')
  async getSliders() {
    return this.ecommerceService.getSliders();
  }
}
