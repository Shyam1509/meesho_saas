import { Logger, Module } from '@nestjs/common';
import { SequelizeModule, SequelizeModuleOptions } from '@nestjs/sequelize';
import { AppConfigService } from '../config/app-config.service';

const sqlLogger = new Logger('Sequelize');

/**
 * MySQL connection. Schema changes go ONLY through sequelize-cli migrations (db/migrations):
 * synchronize is false and sync() is never called anywhere in the app.
 */
@Module({
  imports: [
    SequelizeModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): SequelizeModuleOptions => {
        const db = config.database;
        return {
          dialect: 'mysql',
          host: db.host,
          port: db.port,
          database: db.name,
          username: db.user,
          password: db.password,
          // Store and read DATETIME/TIMESTAMP values as UTC.
          timezone: '+00:00',
          // DECIMAL columns (money) are intentionally left as strings: enabling mysql2's
          // `decimalNumbers` dialect option would turn them into JS floats and lose precision.
          // (mysql2's default connection charset is already utf8mb4.)
          define: { underscored: true },
          pool: { max: 5, min: 0, acquire: 10_000, idle: 10_000 },
          autoLoadModels: true,
          synchronize: false,
          retryAttempts: 3,
          retryDelay: 2_000,
          // SQL is logged only in development, at debug level, through the app logger.
          logging: config.isDevelopment
            ? (sql: string) => sqlLogger.debug(sql)
            : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
