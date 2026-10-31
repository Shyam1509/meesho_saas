import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Orders list / statuses / detail / status history (Milestone 5). */
@Module({
  imports: [AuthorizationModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
