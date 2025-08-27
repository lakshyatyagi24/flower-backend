import { Module } from '@nestjs/common';
import { EcommerceService } from './ecommerce.service';
import { EcommerceController } from './ecommerce.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EcommerceController],
  providers: [EcommerceService],
  exports: [EcommerceService],
})
export class EcommerceModule {}
