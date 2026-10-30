import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ImportCommitService } from './import-commit.service';
import { ImportParseLimiter } from './import-parse-limiter';
import { ImportUploadInterceptor } from './import-upload.interceptor';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/** Report upload → preview → confirm/retry/cancel (Milestone 4). */
@Module({
  imports: [AuthorizationModule, AuditModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    ImportCommitService,
    ImportUploadInterceptor,
    ImportParseLimiter,
  ],
})
export class ImportsModule {}
