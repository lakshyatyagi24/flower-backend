import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StaleOrdersJob } from './stale-orders.job';
import { RAZORPAY_CLIENT, RazorpaySdkClient } from './razorpay.client';

@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StaleOrdersJob, { provide: RAZORPAY_CLIENT, useClass: RazorpaySdkClient }],
  exports: [PaymentsService],
})
export class PaymentsModule {}
