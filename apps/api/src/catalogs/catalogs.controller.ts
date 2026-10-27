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
import { CatalogType, UserStatus } from '@tic/database';
import { IsNotEmpty, IsOptional, IsInt, IsString } from 'class-validator';

class CreateCatalogItemDto {
  @IsNotEmpty({ message: 'Código é obrigatório.' })
  code: string;

  @IsNotEmpty({ message: 'Nome é obrigatório.' })
  name: string;

  @IsOptional()
  value?: string;

  @IsOptional()
  @IsInt({ message: 'A ordem deve ser um número inteiro.' })
  order?: number;
}

class UpdateCatalogItemDto {
  @IsOptional()
  @IsNotEmpty({ message: 'Nome não pode ser vazio.' })
  name?: string;

  @IsOptional()
  value?: string;

  @IsOptional()
  @IsInt({ message: 'A ordem deve ser um número inteiro.' })
  order?: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('catalogs')
export class CatalogsController {
  constructor(private prisma: PrismaService) {}

  private mapType(type: string): CatalogType {
    const t = type.toLowerCase();
    switch (t) {
      case 'systems':
      case 'system':
        return CatalogType.SYSTEM;
      case 'classifications':
      case 'classification':
        return CatalogType.CLASSIFICATION;
      case 'flows':
      case 'flow_type':
        return CatalogType.FLOW_TYPE;
      case 'priorities':
      case 'business_priority':
        return CatalogType.BUSINESS_PRIORITY;
      case 'classes':
      case 'class':
        return CatalogType.CLASS;
      case 'phases':
      case 'phase':
        return CatalogType.PHASE;
      case 'impediments':
      case 'impediment_type':
        return CatalogType.IMPEDIMENT_TYPE;
      case 'modalities':
      case 'resource_modality':
        return CatalogType.RESOURCE_MODALITY;
      case 'roles':
      case 'role':
        return CatalogType.ROLE;
      default:
        throw new BadRequestException({
          code: 'INVALID_CATALOG_TYPE',
          message: `Tipo de catálogo '${type}' inválido.`,
        });
    }
  }

  // Validate the total percentage sum for phase configurations
  private async validatePhasePercentages(targetId?: string, newValue?: string, isDeactivating = false) {
    const activePhases = await this.prisma.catalogItem.findMany({
      where: {
        type: CatalogType.PHASE,
        status: UserStatus.ACTIVE,
      },
    });

    let total = 0;
    for (const phase of activePhases) {
      if (phase.id === targetId) {
        if (isDeactivating) {
          // Exclude this phase from calculation as it is being deactivated
          continue;
        }
        total += parseFloat(newValue || '0');
      } else {
        total += parseFloat(phase.value || '0');
      }
    }

    // If it's a new item being added (targetId is undefined), add its value to total
    if (!targetId && newValue) {
      total += parseFloat(newValue);
    }

    // Allow a small precision margin for floating point math
    if (Math.abs(total - 100) > 0.001) {
      throw new BadRequestException({
        code: 'PHASES_SUM_INVALID',
        message: `A soma das porcentagens das fases ativas deve ser exatamente 100%. Atualmente somará ${total}%.`,
      });
    }
  }

  @Get(':type')
  async findAll(@Param('type') type: string) {
    const catalogType = this.mapType(type);
    return this.prisma.catalogItem.findMany({
      where: { type: catalogType },
      orderBy: [
        { order: 'asc' },
        { name: 'asc' },
      ],
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':type')
  async create(
    @Param('type') type: string,
    @Body() body: CreateCatalogItemDto,
  ) {
    const catalogType = this.mapType(type);

    const existing = await this.prisma.catalogItem.findUnique({
      where: {
        type_code: {
          type: catalogType,
          code: body.code,
        },
      },
    });

    if (existing) {
      throw new BadRequestException({
        code: 'CATALOG_CODE_EXISTS',
        message: `Já existe um item cadastrado com o código '${body.code}' neste catálogo.`,
      });
    }

    if (catalogType === CatalogType.PHASE && body.value) {
      await this.validatePhasePercentages(undefined, body.value);
    }

    return this.prisma.catalogItem.create({
      data: {
        type: catalogType,
        code: body.code,
        name: body.name,
        value: body.value,
        order: body.order,
        status: UserStatus.ACTIVE,
      },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':type/:id')
  async update(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: UpdateCatalogItemDto,
  ) {
    const catalogType = this.mapType(type);

    const item = await this.prisma.catalogItem.findUnique({
      where: { id },
    });

    if (!item || item.type !== catalogType) {
      throw new BadRequestException({
        code: 'CATALOG_ITEM_NOT_FOUND',
        message: 'Item de catálogo não encontrado.',
      });
    }

    if (catalogType === CatalogType.PHASE && body.value !== undefined) {
      await this.validatePhasePercentages(id, body.value);
    }

    return this.prisma.catalogItem.update({
      where: { id },
      data: {
        name: body.name,
        value: body.value,
        order: body.order,
      },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':type/:id/activate')
  async activate(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const catalogType = this.mapType(type);

    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item || item.type !== catalogType) {
      throw new BadRequestException({ code: 'CATALOG_ITEM_NOT_FOUND', message: 'Item de catálogo não encontrado.' });
    }

    if (catalogType === CatalogType.PHASE) {
      // Activating this phase changes the sum. We need to check if the new sum is 100%
      await this.validatePhasePercentages(id, item.value || '0', false);
    }

    return this.prisma.catalogItem.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':type/:id/deactivate')
  async deactivate(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const catalogType = this.mapType(type);

    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item || item.type !== catalogType) {
      throw new BadRequestException({ code: 'CATALOG_ITEM_NOT_FOUND', message: 'Item de catálogo não encontrado.' });
    }

    if (catalogType === CatalogType.PHASE) {
      // Deactivating this phase changes the sum. We need to check if the new sum is 100%
      await this.validatePhasePercentages(id, '0', true);
    }

    // Check if the catalog item is used in resources modality or role
    if (catalogType === CatalogType.RESOURCE_MODALITY || catalogType === CatalogType.ROLE) {
      const isModalityUsed = await this.prisma.resource.count({ where: { modalityId: id } });
      const isRoleUsed = await this.prisma.resource.count({ where: { roleId: id } });
      if (isModalityUsed > 0 || isRoleUsed > 0) {
        throw new BadRequestException({
          code: 'CATALOG_ITEM_IN_USE',
          message: 'Não é possível desativar este item de catálogo pois existem recursos associados a ele.',
        });
      }
    }

    return this.prisma.catalogItem.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
    });
  }
}
