import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/** Manual expenses, workspace-wide or per seller account, with an allowlisted category list (Milestone 6). */
@Module({
  imports: [AuthorizationModule, AuditModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
