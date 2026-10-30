import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from '../config/app-config.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthCookieService } from './auth-cookie.service';
import { authThrottlerOptions } from './auth-throttler';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf/csrf.guard';
import { LoginAttemptLimiter } from './login-attempt-limiter.service';
import { PasswordHasherService } from './password-hasher.service';
import { RegistrationEnabledGuard } from './registration-enabled.guard';
import { SessionService } from './session.service';

/**
 * Sessions, sign-in endpoints and the two global guards. APP_GUARD order is registration order:
 * CsrfGuard first (unsafe requests failing CSRF get 403 before anything else), then the default-deny
 * AuthGuard (401 unless @Public()). The XSRF cookie itself is seeded by middleware in app.setup.ts.
 */
@Module({
  imports: [
    WorkspacesModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: authThrottlerOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    AuthService,
    AuthCookieService,
    SessionService,
    PasswordHasherService,
    LoginAttemptLimiter,
    RegistrationEnabledGuard,
  ],
})
export class AuthModule {}
