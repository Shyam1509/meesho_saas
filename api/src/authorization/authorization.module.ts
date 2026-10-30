import { Module } from '@nestjs/common';
import { WorkspaceAccessService } from './workspace-access.service';

/** Workspace/account membership and role checks shared by every tenant-scoped module. */
@Module({
  providers: [WorkspaceAccessService],
  exports: [WorkspaceAccessService],
})
export class AuthorizationModule {}
