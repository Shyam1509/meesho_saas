import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Account and workspace dashboards: documented metrics, account comparison, trend (Milestone 7). */
@Module({
  imports: [AuthorizationModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
