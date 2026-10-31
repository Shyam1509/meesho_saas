import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import { ReconciliationService } from './reconciliation.service';

/**
 * Settlement ↔ order reconciliation (Milestone 5). Exports the matcher so the import confirm can run it
 * inside its own transaction.
 */
@Module({
  imports: [AuthorizationModule, AuditModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, ReconciliationMatcherService],
  exports: [ReconciliationMatcherService],
})
export class ReconciliationModule {}
