import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CurrentUser, JwtAuthGuard, Roles } from '../auth/auth.guard';
import { JwtPayload } from '../auth/jwt.util';

interface ReviewBody {
  rating: number;
  title?: string | null;
  body: string;
}

function parseId(raw: string, label: string): number {
  const numeric = parseInt(raw, 10);
  if (isNaN(numeric)) throw new BadRequestException(`Invalid ${label} ID`);
  return numeric;
}

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('products/:id/reviews')
  async listForProduct(
    @Param('id') id: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.reviews.listForProduct(parseId(id, 'product'), {
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('products/:id/reviews')
  async upsertForProduct(
    @Param('id') id: string,
    @Body() body: ReviewBody,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reviews.upsertForProduct(parseId(id, 'product'), user.sub, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('reviews/:id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<ReviewBody>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reviews.update(parseId(id, 'review'), user.sub, user.role, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('reviews/:id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.reviews.remove(parseId(id, 'review'), user.sub, user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get('reviews')
  async listAll(
    @Query('productId') productId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.reviews.listAll({
      productId: productId ? parseInt(productId, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }
}
