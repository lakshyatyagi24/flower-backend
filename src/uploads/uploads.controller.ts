import { BadRequestException, Controller, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard, Roles } from '../auth/auth.guard';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Query('folder') folder = 'products') {
    if (!file) throw new BadRequestException('No file uploaded');
    const safeFolder = /^[a-z]+$/.test(folder) ? folder : 'products';
    return this.uploads.upload(file.buffer, file.mimetype, safeFolder);
  }
}
