import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { SellerAccountsController } from './seller-accounts.controller';
import { SellerAccountsService } from './seller-accounts.service';

@Module({
  imports: [AuthorizationModule, AuditModule],
  controllers: [SellerAccountsController],
  providers: [SellerAccountsService],
})
export class SellerAccountsModule {}
