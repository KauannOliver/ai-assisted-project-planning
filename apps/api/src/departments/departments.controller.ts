import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Body, 
  Param, 
  UseGuards, 
  BadRequestException 
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { UserStatus } from '@tic/database';

class CreateDepartmentDto {
  @IsNotEmpty({ message: 'Código é obrigatório.' })
  @Matches(/^[A-Z0-9_-]+$/, { message: 'O código deve conter apenas letras maiúsculas, números, traços e sublinhados.' })
  code: string;

  @IsNotEmpty({ message: 'Nome do departamento é obrigatório.' })
  name: string;
}

class UpdateDepartmentDto {
  @IsOptional()
  @Matches(/^[A-Z0-9_-]+$/, { message: 'O código deve conter apenas letras maiúsculas, números, traços e sublinhados.' })
  code?: string;

  @IsOptional()
  @IsNotEmpty({ message: 'Nome do departamento não pode ser vazio.' })
  name?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post()
  async create(@Body() body: CreateDepartmentDto) {
    const existing = await this.prisma.department.findUnique({
      where: { code: body.code },
    });

    if (existing) {
      throw new BadRequestException({
        code: 'DEPARTMENT_CODE_EXISTS',
        message: `Já existe um departamento com o código ${body.code}.`,
      });
    }

    return this.prisma.department.create({
      data: {
        code: body.code,
        name: body.name,
        status: UserStatus.ACTIVE,
      },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateDepartmentDto,
  ) {
    const dept = await this.prisma.department.findUnique({ where: { id } });
    if (!dept) {
      throw new BadRequestException({
        code: 'DEPARTMENT_NOT_FOUND',
        message: 'Departamento não encontrado.',
      });
    }

    if (body.code && body.code !== dept.code) {
      const existing = await this.prisma.department.findUnique({
        where: { code: body.code },
      });
      if (existing) {
        throw new BadRequestException({
          code: 'DEPARTMENT_CODE_EXISTS',
          message: `O código ${body.code} já está em uso por outro departamento.`,
        });
      }
    }

    return this.prisma.department.update({
      where: { id },
      data: {
        code: body.code,
        name: body.name,
      },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/activate')
  async activate(@Param('id') id: string) {
    return this.prisma.department.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    // Check if department is being used in user department scopes
    const scopesCount = await this.prisma.userDepartmentScope.count({
      where: { departmentId: id },
    });

    if (scopesCount > 0) {
      throw new BadRequestException({
        code: 'DEPARTMENT_IN_USE',
        message: 'Não é possível desativar este departamento pois ele está associado ao escopo de visualização de usuários.',
      });
    }

    return this.prisma.department.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
    });
  }
}
