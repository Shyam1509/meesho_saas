import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { HealthResponseDto } from './dto/health-response.dto';

/** Upper bound for the DB probe so a hung pool cannot hang the health endpoint. */
export const DB_CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async check(): Promise<HealthResponseDto> {
    const dbUp = await this.isDatabaseUp();
    return {
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'up' : 'down',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async isDatabaseUp(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`DB check timed out after ${DB_CHECK_TIMEOUT_MS} ms`),
          ),
        DB_CHECK_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([
        this.sequelize.authenticate({ logging: false }),
        timeout,
      ]);
      return true;
    } catch (err) {
      this.logger.warn(
        `Database health check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
