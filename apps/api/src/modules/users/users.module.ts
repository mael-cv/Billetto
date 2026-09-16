import { Module } from '@nestjs/common';
import { ChangeUserRoleUseCase, ListUsersUseCase } from './application/users.use-cases';
import { USERS_REPOSITORY } from './domain/user';
import { PrismaUsersRepository } from './infrastructure/prisma-users.repository';
import { UsersController } from './presentation/users.controller';

@Module({
  controllers: [UsersController],
  providers: [ListUsersUseCase, ChangeUserRoleUseCase, { provide: USERS_REPOSITORY, useClass: PrismaUsersRepository }],
})
export class UsersModule {}
