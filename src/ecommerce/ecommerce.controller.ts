import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { EcommerceService } from './ecommerce.service';

@Controller()
export class EcommerceController {
  constructor(private readonly ecommerceService: EcommerceService) {}

  // GET /categories -> top-level categories
  @Get('categories')
  async findAll() {
    return this.ecommerceService.getCategories();
  }

  // GET /categories/all -> all categories with hierarchy
  @Get('categories/all')
  async findAllWithHierarchy() {
    return this.ecommerceService.getAllCategories();
  }

  // POST /categories -> create new category
  @Post('categories')
  async createCategory(
    @Body() data: { name: string; slug: string; image?: string; parentId?: number },
  ) {
    return this.ecommerceService.createCategory(data);
  }

  // PUT /categories/:id -> update category
  @Put('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @Body() data: { name?: string; slug?: string; image?: string },
  ) {
    return this.ecommerceService.updateCategory(parseInt(id), data);
  }

  // DELETE /categories/:id -> delete category
  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string) {
    return this.ecommerceService.deleteCategory(parseInt(id));
  }

  // GET /sliders -> homepage sliders
  @Get('sliders')
  async getSliders() {
    return this.ecommerceService.getSliders();
  }
}
