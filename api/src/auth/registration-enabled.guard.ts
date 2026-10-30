import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { REGISTRATION_DISABLED_MESSAGE } from './auth.service';

/**
 * Route guard on POST /auth/register: 403 when AUTH_REGISTRATION_ENABLED is false. Runs before body
 * validation, so a closed registration answers 403 whatever the body.
 */
@Injectable()
export class RegistrationEnabledGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(): boolean {
    if (!this.config.authRegistrationEnabled) {
      throw new ForbiddenException(REGISTRATION_DISABLED_MESSAGE);
    }
    return true;
  }
}
