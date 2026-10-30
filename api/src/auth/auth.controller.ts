import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import { getRequestId } from '../common/logging/request-id';
import { AppConfigService } from '../config/app-config.service';
import { AuthCookieService } from './auth-cookie.service';
import {
  AuthService,
  type SignedIn,
  TooManyLoginAttemptsException,
} from './auth.service';
import type { AuthenticatedUser } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { LoginDto, RegisterDto } from './dto/auth-request.dto';
import { AuthConfigDto, MeResponseDto } from './dto/auth-response.dto';
import { Public } from './public.decorator';
import { RegistrationEnabledGuard } from './registration-enabled.guard';

const CSRF_FORBIDDEN_DOC = {
  type: ErrorResponseDto,
  description:
    'CSRF check failed (missing/invalid X-XSRF-TOKEN or foreign Origin)',
};

/**
 * Sign-in endpoints. Cookies are an HTTP concern and are set here; everything else is in AuthService.
 * Session cookie: msaas_sid (or __Host-msaas_sid when secure), HttpOnly, SameSite=Strict, Path=/.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
    private readonly config: AppConfigService,
  ) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'Public auth settings for the sign-in screens' })
  @ApiOkResponse({ type: AuthConfigDto })
  getConfig(): AuthConfigDto {
    return { registrationEnabled: this.config.authRegistrationEnabled };
  }

  @Get('csrf')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sets the msaas_xsrf cookie (keeps an existing valid token)',
  })
  @ApiNoContentResponse({ description: 'msaas_xsrf cookie set' })
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    this.cookies.ensureXsrf(req, res);
  }

  @Post('register')
  @Public()
  @UseGuards(ThrottlerGuard, RegistrationEnabledGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiSecurity('xsrf')
  @ApiOperation({
    summary: 'Create an account, its first workspace and a session',
  })
  @ApiCreatedResponse({
    type: MeResponseDto,
    description: 'Signed in: session cookie set, XSRF token rotated',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Registration disabled, or CSRF check failed',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email already registered',
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponseDto> {
    const signedIn = await this.auth.register(
      body,
      this.cookies.readSessionToken(req),
      getRequestId(req),
    );
    return this.startSession(res, signedIn);
  }

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({
    type: MeResponseDto,
    description: 'Signed in: session cookie set, XSRF token rotated',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description:
      '"Invalid email or password." (unknown email, wrong password or disabled user)',
  })
  @ApiForbiddenResponse(CSRF_FORBIDDEN_DOC)
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description:
      'Per-IP rate limit, or too many failed attempts (per 15 minutes: 5 for this email from this IP, 50 for this email overall)',
  })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponseDto> {
    try {
      // req.ip is the socket peer: 'trust proxy' is not set (deployment decision, M9).
      const signedIn = await this.auth.login(
        body,
        this.cookies.readSessionToken(req),
        req.ip,
      );
      return this.startSession(res, signedIn);
    } catch (err) {
      if (err instanceof TooManyLoginAttemptsException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      throw err;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity('xsrf')
  @ApiOperation({
    summary: 'Revoke the presented session (if any) and clear the cookie',
  })
  @ApiNoContentResponse({ description: 'Signed out (idempotent)' })
  @ApiForbiddenResponse(CSRF_FORBIDDEN_DOC)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.cookies.readSessionToken(req));
    this.cookies.clearSession(res);
    this.cookies.rotateXsrf(res);
  }

  @Get('me')
  @ApiCookieAuth('session')
  @ApiOperation({ summary: 'The signed-in user and their workspaces' })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: '"Authentication required."',
  })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.auth.me(user);
  }

  private startSession(res: Response, signedIn: SignedIn): MeResponseDto {
    this.cookies.setSession(res, signedIn.token);
    this.cookies.rotateXsrf(res);
    return signedIn.me;
  }
}
