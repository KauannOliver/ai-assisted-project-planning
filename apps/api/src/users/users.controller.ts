import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param,
  Patch, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { IsArray, IsEmail, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { Role, UserStatus } from '@tic/database';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreateUserDto {
  @IsNotEmpty({ message: 'Nome é obrigatório.' }) name: string;
  @IsEmail({}, { message: 'E-mail inválido.' }) @IsNotEmpty({ message: 'E-mail é obrigatório.' }) email: string;
  @IsEnum(Role, { message: 'Perfil inválido.' }) role: Role;
  @IsArray({ message: 'departmentIds deve ser um array de strings.' }) @IsOptional() departmentIds?: string[];
}

class UpdateUserDto {
  @IsOptional() @IsNotEmpty({ message: 'Nome não pode ser vazio.' }) name?: string;
  @IsEmail({}, { message: 'E-mail inválido.' }) @IsOptional() email?: string;
  @IsEnum(Role, { message: 'Perfil inválido.' }) @IsOptional() role?: Role;
  @IsArray({ message: 'departmentIds deve ser um array de strings.' }) @IsOptional() departmentIds?: string[];
}

class UserDepartmentsDto {
  @IsArray({ message: 'departmentIds deve ser um array de strings.' }) departmentIds: string[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  private assertCanManageAdmin(actor: any, targetRole: Role, proposedRole?: Role) {
    if (actor.role !== Role.ADMIN && (targetRole === Role.ADMIN || proposedRole === Role.ADMIN)) {
      throw new ForbiddenException({
        code: 'ADMIN_ACCOUNT_RESTRICTED',
        message: 'Somente um Administrador pode cadastrar ou gerenciar outro Administrador.',
      });
    }
  }

  private activeAdminCount(client: any = this.prisma) {
    return client.user.count({ where: { role: Role.ADMIN, status: UserStatus.ACTIVE, deletedAt: null } });
  }

  private async findManageableUser(id: string, actor: any, client: any = this.prisma) {
    const user = await client.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) {
      throw new BadRequestException({ code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' });
    }
    this.assertCanManageAdmin(actor, user.role);
    return user;
  }

  private validateDepartments(role: Role, departmentIds: string[] | undefined) {
    if ((role === Role.MANAGER || role === Role.DIRECTOR) && (!departmentIds || departmentIds.length === 0)) {
      throw new BadRequestException({
        code: 'DEPARTMENT_SCOPE_REQUIRED',
        message: 'Usuários com perfil Gerente ou Diretor devem ter pelo menos um departamento associado.',
      });
    }
  }

  @Get()
  findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true, name: true, email: true, role: true, status: true,
        forcePasswordChange: true, invalidAttempts: true, lastLoginAt: true, createdAt: true,
        departments: { select: { department: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  async create(@Req() req: any, @Body() body: CreateUserDto) {
    this.assertCanManageAdmin(req.user, body.role, body.role);
    this.validateDepartments(body.role, body.departmentIds);
    const email = body.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException({ code: 'EMAIL_ALREADY_EXISTS', message: 'Já existe um usuário cadastrado com este e-mail.' });
    }
    const passwordHash = bcrypt.hashSync('Mudar@123', bcrypt.genSaltSync(10));
    return this.prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: { name: body.name.trim(), email, role: body.role, passwordHash, forcePasswordChange: true, status: UserStatus.ACTIVE },
      });
      if (body.departmentIds?.length) {
        await tx.userDepartmentScope.createMany({
          data: [...new Set(body.departmentIds)].map(departmentId => ({ userId: user.id, departmentId })),
        });
      }
      return tx.user.findUnique({
        where: { id: user.id },
        select: { id: true, name: true, email: true, role: true, status: true, forcePasswordChange: true, createdAt: true },
      });
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, name: true, email: true, role: true, status: true,
        forcePasswordChange: true, lastLoginAt: true, createdAt: true,
        departments: { select: { department: { select: { id: true, code: true, name: true, status: true } } } },
      },
    });
    if (!user) throw new BadRequestException({ code: 'USER_NOT_FOUND', message: 'Usuário não encontrado.' });
    return user;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateUserDto, @Req() req: any) {
    const user = await this.findManageableUser(id, req.user);
    const finalRole = body.role ?? user.role;
    this.assertCanManageAdmin(req.user, user.role, finalRole);
    const currentDepartments = await this.prisma.userDepartmentScope.findMany({ where: { userId: id }, select: { departmentId: true } });
    const departmentIds = body.departmentIds ?? currentDepartments.map(item => item.departmentId);
    this.validateDepartments(finalRole, departmentIds);

    if (user.role === Role.ADMIN && finalRole !== Role.ADMIN && user.status === UserStatus.ACTIVE && await this.activeAdminCount() <= 1) {
      throw new BadRequestException({ code: 'LAST_ACTIVE_ADMIN', message: 'O último Administrador ativo não pode perder o perfil administrativo.' });
    }
    const email = body.email?.trim().toLowerCase();
    if (email && email !== user.email && await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException({ code: 'EMAIL_ALREADY_EXISTS', message: 'Este e-mail já está sendo utilizado por outro usuário.' });
    }

    return this.prisma.$transaction(async tx => {
      const accessChanged = finalRole !== user.role || body.departmentIds !== undefined || (email !== undefined && email !== user.email);
      const updated = await tx.user.update({
        where: { id },
        data: {
          name: body.name?.trim(), email, role: body.role,
          ...(accessChanged ? { tokenVersion: { increment: 1 } } : {}),
        },
        select: { id: true, name: true, email: true, role: true, status: true, forcePasswordChange: true },
      });
      if (body.departmentIds !== undefined) {
        await tx.userDepartmentScope.deleteMany({ where: { userId: id } });
        if (departmentIds.length) {
          await tx.userDepartmentScope.createMany({
            data: [...new Set(departmentIds)].map(departmentId => ({ userId: id, departmentId })),
          });
        }
      }
      return updated;
    });
  }

  @Post(':id/activate')
  async activate(@Param('id') id: string, @Req() req: any) {
    await this.findManageableUser(id, req.user);
    await this.prisma.user.update({ where: { id }, data: { status: UserStatus.ACTIVE, tokenVersion: { increment: 1 } } });
    return { message: 'Usuário ativado com sucesso.' };
  }

  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    if (id === req.user.id) {
      throw new BadRequestException({ code: 'CANNOT_DEACTIVATE_SELF', message: 'Você não pode desativar seu próprio usuário logado.' });
    }
    const user = await this.findManageableUser(id, req.user);
    if (user.role === Role.ADMIN && user.status === UserStatus.ACTIVE && await this.activeAdminCount() <= 1) {
      throw new BadRequestException({ code: 'LAST_ACTIVE_ADMIN', message: 'O último Administrador ativo não pode ser desativado.' });
    }
    await this.prisma.user.update({ where: { id }, data: { status: UserStatus.INACTIVE, tokenVersion: { increment: 1 } } });
    return { message: 'Usuário desativado com sucesso. Sessões ativas foram revogadas.' };
  }

  @Put(':id/departments')
  async updateDepartments(@Param('id') id: string, @Body() body: UserDepartmentsDto, @Req() req: any) {
    const user = await this.findManageableUser(id, req.user);
    this.validateDepartments(user.role, body.departmentIds);
    await this.prisma.$transaction(async tx => {
      await tx.userDepartmentScope.deleteMany({ where: { userId: id } });
      if (body.departmentIds.length) {
        await tx.userDepartmentScope.createMany({
          data: [...new Set(body.departmentIds)].map(departmentId => ({ userId: id, departmentId })),
        });
      }
      await tx.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
    });
    return { message: 'Escopo departamental atualizado com sucesso. Sessões ativas foram revogadas.' };
  }

  @Roles('ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    if (id === req.user.id) {
      throw new BadRequestException({ code: 'CANNOT_DELETE_SELF', message: 'Você não pode excluir seu próprio usuário logado.' });
    }
    const user = await this.findManageableUser(id, req.user);
    if (user.role === Role.ADMIN && user.status === UserStatus.ACTIVE && await this.activeAdminCount() <= 1) {
      throw new BadRequestException({ code: 'LAST_ACTIVE_ADMIN', message: 'O último Administrador ativo não pode ser excluído.' });
    }
    await this.prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id },
        data: { status: UserStatus.INACTIVE, deletedAt: new Date(), deletedById: req.user.id, tokenVersion: { increment: 1 } },
      });
      await tx.businessEvent.create({
        data: {
          aggregateType: 'USER', aggregateId: id, eventType: 'USER_DELETED',
          description: `Usuário ${user.name} excluído logicamente.`, userId: req.user.id, actorName: req.user.name,
          metadata: { targetUserId: id, targetName: user.name, targetEmail: user.email, targetRole: user.role },
        },
      });
    });
    return { message: `Usuário ${user.name} excluído. O histórico foi preservado.` };
  }
}
