import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EnquiriesService } from './enquiries.service';
import { JwtAuthGuard, OptionalJwtAuthGuard, Roles } from '../auth/auth.guard';
import { JwtPayload } from '../auth/jwt.util';

interface CreateEnquiryBody {
  productId?: number | null;
  productName?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  quantity?: number;
  eventDate?: string;
  occasion?: string;
  budget?: number;
  address?: string;
  city?: string;
  message?: string;
  source?: string;
}

@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  // Anyone (logged in or guest) can submit an enquiry
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  async create(@Body() body: CreateEnquiryBody, @Req() req: { user?: JwtPayload }) {
    return this.enquiries.create({ ...body, userId: req.user?.sub ?? null });
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.enquiries.list({
      status,
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get('stats')
  async stats() {
    return this.enquiries.stats();
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid enquiry ID');
    return this.enquiries.getById(numeric);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; adminNotes?: string },
  ) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid enquiry ID');
    if (!body?.status) throw new BadRequestException('Status is required');
    return this.enquiries.updateStatus(numeric, body.status, body.adminNotes);
  }
}
