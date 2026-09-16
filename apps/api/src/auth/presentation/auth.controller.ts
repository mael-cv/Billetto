import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { LoginUseCase } from '../application/login.use-case';
import { RegisterUseCase } from '../application/register.use-case';
import { SessionTokenService } from '../application/session-token.service';
import type { Actor } from '../domain/actor';
import { Authenticated, CurrentActor, SkipCsrf } from './auth.decorators';
import { type LoginDto, loginSchema, type RegisterDto, registerSchema } from './auth.dto';
import { clearSessionCookie, issueCsrfToken, setSessionCookie } from './cookies';

const toUser = (actor: Actor) => ({
  id: actor.userId,
  email: actor.email,
  prenom: actor.prenom,
  nom: actor.nom,
  role: actor.role,
  organisateurId: actor.organisateurId,
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: LoginUseCase,
    private readonly register: RegisterUseCase,
    private readonly tokens: SessionTokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Émet le jeton CSRF à renvoyer dans l'en-tête X-CSRF-Token. */
  @Get('csrf')
  @SkipCsrf()
  csrf(@Res({ passthrough: true }) reply: FastifyReply) {
    return { csrfToken: issueCsrfToken(reply, this.config) };
  }

  @Post('login')
  @HttpCode(200)
  async doLogin(@Body(new ZodPipe(loginSchema)) body: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const actor = await this.login.execute(body.email, body.password);
    return this.openSession(actor, reply);
  }

  @Post('register')
  @HttpCode(201)
  async doRegister(
    @Body(new ZodPipe(registerSchema)) body: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const actor = await this.register.execute(body);
    return this.openSession(actor, reply);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) reply: FastifyReply): void {
    clearSessionCookie(reply, this.config);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentActor() actor: Actor) {
    return { user: toUser(actor) };
  }

  private openSession(actor: Actor, reply: FastifyReply) {
    setSessionCookie(reply, this.tokens.sign(actor), this.config);
    // Rotation du jeton CSRF au changement de privilège (fixation de session).
    const csrfToken = issueCsrfToken(reply, this.config);
    return { user: toUser(actor), csrfToken };
  }
}
