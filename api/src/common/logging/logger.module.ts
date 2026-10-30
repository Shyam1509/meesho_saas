import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../../config/app-config.service';
import { buildPinoHttpOptions } from './pino-http.options';

/** Structured JSON logging via nestjs-pino; see buildPinoHttpOptions for what is (not) logged. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: buildPinoHttpOptions(config.logLevel),
      }),
    }),
  ],
})
export class AppLoggerModule {}
