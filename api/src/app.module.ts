import { Module } from '@nestjs/common';
import { AppLoggerModule } from './common/logging/logger.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [AppConfigModule, AppLoggerModule, DatabaseModule, HealthModule],
})
export class AppModule {}
