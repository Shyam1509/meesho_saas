import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

/** Settlement entry list with as-reported totals (Milestone 5). */
@Module({
  imports: [AuthorizationModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
})
export class SettlementsModule {}
