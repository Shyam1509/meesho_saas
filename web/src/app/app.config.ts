import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { provideApiHttpClient } from './core/api/provide-api-http-client';
import { AuthStateService } from './core/auth/auth-state.service';
import { AppTitleStrategy } from './core/title/app-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideApiHttpClient(),
    // Learn who is signed in (GET /auth/me) before the first navigation. Never fails: a 401 or an
    // unreachable API just means "signed out".
    provideAppInitializer(() => inject(AuthStateService).load()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
  ],
};
