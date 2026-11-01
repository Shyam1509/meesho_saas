import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ExportLimiter } from './export-limiter';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** CSV exports of orders, settlement entries and expenses (Milestone 7). */
@Module({
  imports: [AuthorizationModule, AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExportLimiter],
})
export class ReportsModule {}
