import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';

interface ProductBody {
  name: string;
  slug?: string;
  description?: string;
  price: number;
  image?: string;
  stock?: number;
  featured?: boolean;
  active?: boolean;
  categoryId?: number | null;
}

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  async list(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('featured') featured?: string,
    @Query('active') active?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.products.list({
      category,
      q,
      featured: featured === undefined ? undefined : featured === 'true',
      active: active === undefined ? true : active === 'true',
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  @Get('slug/:slug')
  async bySlug(@Param('slug') slug: string) {
    return this.products.getBySlug(slug);
  }

  @Get(':id')
  async byId(@Param('id') id: string) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid product ID');
    return this.products.getById(numeric);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Post()
  async create(@Body() body: ProductBody) {
    return this.products.create(body);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Partial<ProductBody>) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid product ID');
    return this.products.update(numeric, body);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid product ID');
    return this.products.remove(numeric);
  }
}
