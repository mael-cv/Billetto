import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../../../auth/domain/actor';
import { Authenticated, CurrentActor } from '../../../auth/presentation/auth.decorators';
import { idSchema, paginationSchema } from '../../../common/validation/schemas';
import { ZodPipe } from '../../../common/validation/zod.pipe';
import { ChangeUserRoleUseCase, ListUsersUseCase } from '../application/users.use-cases';

const listUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(254).optional(),
});

const changeRoleSchema = z.strictObject({
  role: z.enum(['visitor', 'organizer', 'admin']),
  organisateurId: idSchema.nullable().default(null),
});

@Controller('users')
@Authenticated('admin')
export class UsersController {
  constructor(
    private readonly listUsers: ListUsersUseCase,
    private readonly changeRole: ChangeUserRoleUseCase,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(listUsersQuerySchema)) query: z.infer<typeof listUsersQuerySchema>) {
    return this.listUsers.execute(actor, query.q, { page: query.page, pageSize: query.pageSize });
  }

  @Patch(':id/role')
  updateRole(
    @CurrentActor() actor: Actor,
    @Param('id', new ZodPipe(idSchema)) id: number,
    @Body(new ZodPipe(changeRoleSchema)) body: z.infer<typeof changeRoleSchema>,
  ) {
    return this.changeRole.execute(actor, id, body.role, body.organisateurId);
  }
}
