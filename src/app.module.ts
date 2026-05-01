import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { EventsModule } from './events/events.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';
import { ReviewsModule } from './reviews/reviews.module';
import { EnquiriesModule } from './enquiries/enquiries.module';

@Module({
  imports: [
    EcommerceModule,
    EventsModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    SettingsModule,
    UsersModule,
    ReviewsModule,
    EnquiriesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
