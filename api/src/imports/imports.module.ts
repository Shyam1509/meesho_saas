import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ProductsModule } from '../products/products.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { ImportCommitService } from './import-commit.service';
import { ImportParseLimiter } from './import-parse-limiter';
import { ImportUploadInterceptor } from './import-upload.interceptor';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * Report upload → preview → confirm/retry/cancel (Milestone 4); a completed confirm also runs the
 * settlement ↔ order matcher in its transaction (Milestone 5) and, for an orders CSV, creates missing
 * products and re-links the job's orders by SKU (Milestone 6).
 */
@Module({
  imports: [
    AuthorizationModule,
    AuditModule,
    ReconciliationModule,
    ProductsModule,
  ],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    ImportCommitService,
    ImportUploadInterceptor,
    ImportParseLimiter,
  ],
})
export class ImportsModule {}
