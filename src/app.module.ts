import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [EcommerceModule, EventsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
