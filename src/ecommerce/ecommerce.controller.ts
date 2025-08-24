import { Controller, Get } from '@nestjs/common';
import { EcommerceService } from './ecommerce.service';

@Controller('categories')
export class EcommerceController {
  constructor(private readonly ecommerceService: EcommerceService) {}

  @Get()
  async findAll() {
    return this.ecommerceService.getCategories();
  }
}
