import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RAZORPAY_CLIENT, RazorpaySdkClient } from './razorpay.client';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, { provide: RAZORPAY_CLIENT, useClass: RazorpaySdkClient }],
  exports: [PaymentsService],
})
export class PaymentsModule {}
