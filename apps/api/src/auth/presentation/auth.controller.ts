import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { ActivityLogger } from '../../modules/activity/activity-logger.service';
import { LoginUseCase } from '../application/login.use-case';
import { ChangePasswordUseCase } from '../application/change-password.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { RegisterUseCase } from '../application/register.use-case';
import { SessionTokenService } from '../application/session-token.service';
import type { Actor } from '../domain/actor';
import { AllowDuringSetup, Authenticated, CurrentActor, OptionalAuth, Public, SkipCsrf } from './auth.decorators';
import { changePasswordSchema, type ChangePasswordDto, type LoginDto, loginSchema, type RegisterDto, registerSchema } from './auth.dto';
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
    private readonly changePassword: ChangePasswordUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly tokens: SessionTokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly activity: ActivityLogger,
  ) {}

  /** Émet le jeton CSRF à renvoyer dans l'en-tête X-CSRF-Token. */
  @Get('csrf')
  @Public()
  @SkipCsrf()
  @AllowDuringSetup()
  csrf(@Res({ passthrough: true }) reply: FastifyReply) {
    return { csrfToken: issueCsrfToken(reply, this.config) };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async doLogin(@Body(new ZodPipe(loginSchema)) body: LoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    let actor: Actor;
    try {
      actor = await this.login.execute(body.email, body.password);
    } catch (err) {
      // Trace des échecs (sans adresse ni mot de passe) : détection de la force brute.
      this.activity.record('connexion', { payload: { succes: false } });
      throw err;
    }
    this.activity.record('connexion', { utilisateurId: actor.userId, payload: { role: actor.role, succes: true } });
    return this.openSession(actor, reply);
  }

  /**
   * Réponse identique que l'adresse soit libre ou déjà utilisée, et aucune
   * session ouverte : l'inscription ne permet pas d'énumérer les comptes.
   * L'utilisateur se connecte ensuite avec ses identifiants.
   */
  @Post('register')
  @Public()
  @HttpCode(201)
  async doRegister(@Body(new ZodPipe(registerSchema)) body: RegisterDto) {
    await this.register.execute(body);
    return { message: 'Inscription enregistrée. Vous pouvez maintenant vous connecter.' };
  }

  /** Déconnexion : le jeton est révoqué en base (toutes les sessions du compte), pas seulement oublié du navigateur. */
  @Post('logout')
  @OptionalAuth()
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor | null, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    if (actor) await this.logoutUseCase.execute(actor);
    clearSessionCookie(reply, this.config);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentActor() actor: Actor) {
    return { user: toUser(actor) };
  }

  @Post('password')
  @Authenticated()
  @HttpCode(204)
  async updatePassword(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.changePassword.execute(actor, body.currentPassword, body.newPassword);
    // Le compteur de version a été incrémenté en base : toutes les sessions sont révoquées.
    clearSessionCookie(reply, this.config);
  }

  private openSession(actor: Actor, reply: FastifyReply) {
    setSessionCookie(reply, this.tokens.sign(actor), this.config);
    // Rotation du jeton CSRF au changement de privilège (fixation de session).
    const csrfToken = issueCsrfToken(reply, this.config);
    return { user: toUser(actor), csrfToken };
  }
}
