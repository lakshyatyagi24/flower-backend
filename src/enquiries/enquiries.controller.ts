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
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { UpdateEnquiryStatusDto } from './dto/update-enquiry-status.dto';

@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  // Anyone (logged in or guest) can submit an enquiry
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  async create(@Body() body: CreateEnquiryDto, @Req() req: { user?: JwtPayload }) {
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
  async updateStatus(@Param('id') id: string, @Body() body: UpdateEnquiryStatusDto) {
    const numeric = parseInt(id, 10);
    if (isNaN(numeric)) throw new BadRequestException('Invalid enquiry ID');
    return this.enquiries.updateStatus(numeric, body.status, body.adminNotes ?? undefined);
  }
}
