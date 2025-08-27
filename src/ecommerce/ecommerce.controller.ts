import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  async getSliders(@Query('includeInactive') includeInactive?: string) {
    return this.ecommerceService.getSliders(includeInactive === 'true');
  }

  // GET /sliders/:id -> get single slider
  @Get('sliders/:id')
  async getSlider(@Param('id') id: string) {
    const sliderId = parseInt(id);
    if (isNaN(sliderId)) {
      throw new BadRequestException('Invalid slider ID');
    }
    return this.ecommerceService.getSlider(sliderId);
  }

  // POST /sliders -> create new slider
  @Post('sliders')
  async createSlider(
    @Body() data: {
      title?: string;
      eyebrow?: string;
      subtitle?: string;
      alt?: string;
      image?: string;
      href?: string;
      config?: any;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    return this.ecommerceService.createSlider(data);
  }

  // PUT /sliders/:id -> update slider
  @Put('sliders/:id')
  async updateSlider(
    @Param('id') id: string,
    @Body() data: {
      title?: string;
      eyebrow?: string;
      subtitle?: string;
      alt?: string;
      image?: string;
      href?: string;
      config?: any;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    const sliderId = parseInt(id);
    if (isNaN(sliderId)) {
      throw new BadRequestException('Invalid slider ID');
    }
    return this.ecommerceService.updateSlider(sliderId, data);
  }

  // DELETE /sliders/:id -> delete slider
  @Delete('sliders/:id')
  async deleteSlider(@Param('id') id: string) {
    const sliderId = parseInt(id);
    if (isNaN(sliderId)) {
      throw new BadRequestException('Invalid slider ID');
    }
    return this.ecommerceService.deleteSlider(sliderId);
  }
}
