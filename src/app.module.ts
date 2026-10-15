import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';
import { ReviewsModule } from './reviews/reviews.module';
import { EnquiriesModule } from './enquiries/enquiries.module';
import { MailModule } from './mail/mail.module';
import { HealthController } from './health/health.controller';
import { UploadsModule } from './uploads/uploads.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { PaymentsModule } from './payments/payments.module';
import { DeliveryModule } from './delivery/delivery.module';
import { CouponsModule } from './coupons/coupons.module';
import { testSupportModules } from './test-support/test-support.env';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    MailModule,
    EcommerceModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    SettingsModule,
    UsersModule,
    ReviewsModule,
    EnquiriesModule,
    UploadsModule,
    NewsletterModule,
    PaymentsModule,
    DeliveryModule,
    CouponsModule,
    // Test-only endpoints: [] unless NODE_ENV=test and ENABLE_TEST_ENDPOINTS=1; throws in production if the flag is set.
    ...testSupportModules(),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
