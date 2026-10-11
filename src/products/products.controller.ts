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
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // Public storefront listing — only ever returns active products. The
  // `active` query param is intentionally NOT honored here so anonymous
  // callers cannot enumerate hidden/discontinued products via ?active=false.
  @Get()
  async list(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('featured') featured?: string,
    @Query('productType') productType?: string,
    @Query('saleMode') saleMode?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.products.list({
      category,
      q,
      featured: featured === undefined ? undefined : featured === 'true',
      active: true,
      productType,
      saleMode,
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  // Admin listing — authenticated; can see inactive/soft-disabled products.
  // active=all (default) → no filter; active=true|false → that filter.
  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get('admin')
  async listAdmin(
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('featured') featured?: string,
    @Query('active') active?: string,
    @Query('productType') productType?: string,
    @Query('saleMode') saleMode?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.products.list({
      category,
      q,
      featured: featured === undefined ? undefined : featured === 'true',
      active: active === undefined || active === 'all' ? undefined : active === 'true',
      productType,
      saleMode,
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
  async create(@Body() body: CreateProductDto) {
    return this.products.create(body);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProductDto) {
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
