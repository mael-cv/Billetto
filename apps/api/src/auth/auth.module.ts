import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoginUseCase } from './application/login.use-case';
import { RegisterUseCase } from './application/register.use-case';
import { SessionTokenService } from './application/session-token.service';
import { CREDENTIALS_REPOSITORY } from './domain/credentials.repository';
import { PASSWORD_HASHER } from './domain/password-hasher';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { PrismaCredentialsRepository } from './infrastructure/prisma-credentials.repository';
import { AuthController } from './presentation/auth.controller';
import { AuthGuard } from './presentation/auth.guard';
import { CsrfGuard } from './presentation/csrf.guard';

@Module({
  controllers: [AuthController],
  providers: [
    LoginUseCase,
    RegisterUseCase,
    SessionTokenService,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: CREDENTIALS_REPOSITORY, useClass: PrismaCredentialsRepository },
    // Ordre : CSRF d'abord, puis identification / autorisation.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionTokenService],
})
export class AuthModule {}
