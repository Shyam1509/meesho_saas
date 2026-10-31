import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { AppLoggerModule } from './common/logging/logger.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { OrdersModule } from './orders/orders.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { SellerAccountsModule } from './seller-accounts/seller-accounts.module';
import { SettlementsModule } from './settlements/settlements.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DatabaseModule,
    HealthModule,
    AuditModule,
    AuthorizationModule,
    AuthModule,
    WorkspacesModule,
    SellerAccountsModule,
    ImportsModule,
    OrdersModule,
    SettlementsModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
