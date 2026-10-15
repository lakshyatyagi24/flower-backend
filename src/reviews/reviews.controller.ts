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
import { Throttle } from '@nestjs/throttler';
import { ReviewsService } from './reviews.service';
import { CurrentUser, JwtAuthGuard, OptionalJwtAuthGuard, Roles } from '../auth/auth.guard';
import { JwtPayload } from '../auth/jwt.util';
import { UpsertReviewDto, UpdateReviewDto, SetReviewStatusDto } from './dto/upsert-review.dto';

function parseId(raw: string, label: string): number {
  const numeric = parseInt(raw, 10);
  if (isNaN(numeric)) throw new BadRequestException(`Invalid ${label} ID`);
  return numeric;
}

function optInt(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // Public list (APPROVED only). A valid token additionally returns the caller's own review in any status.
  @UseGuards(OptionalJwtAuthGuard)
  @Get('products/:id/reviews')
  async listForProduct(
    @Param('id') id: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.reviews.listForProduct(
      parseId(id, 'product'),
      { take: optInt(take), skip: optInt(skip) },
      user?.sub,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('products/:id/reviews/eligibility')
  async eligibility(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.reviews.eligibility(parseId(id, 'product'), user.sub);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('products/:id/reviews')
  async upsertForProduct(
    @Param('id') id: string,
    @Body() body: UpsertReviewDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reviews.upsertForProduct(parseId(id, 'product'), user.sub, body);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Patch('reviews/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateReviewDto,
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
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.reviews.listAll({
      productId: optInt(productId),
      status: status || undefined,
      take: optInt(take),
      skip: optInt(skip),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Patch('reviews/:id/status')
  async setStatus(@Param('id') id: string, @Body() body: SetReviewStatusDto) {
    return this.reviews.setStatus(parseId(id, 'review'), body.status);
  }
}
