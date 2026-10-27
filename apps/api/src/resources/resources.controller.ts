import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Body, 
  Param, 
  UseGuards, 
  BadRequestException 
  ,Req
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserStatus } from '@tic/database';
import { EngineService } from '../engine/engine.service';
import { BusinessEventsService } from '../history-alerts/business-events.service';
import { IsNotEmpty, IsNumber, Min, Max, IsInt, IsOptional } from 'class-validator';

class CreateResourceDto {
  @IsNotEmpty({ message: 'Nome do recurso é obrigatório.' })
  name: string;

  @IsNotEmpty({ message: 'Modalidade é obrigatória.' })
  modalityId: string;

  @IsNotEmpty({ message: 'Cargo é obrigatório.' })
  roleId: string;

  @IsNumber({}, { message: 'Horas semanais devem ser um número.' })
  @Min(1, { message: 'Horas semanais devem ser pelo menos 1h.' })
  weeklyHours: number;

  @IsNumber({}, { message: 'Percentual de overhead deve ser um número.' })
  @Min(0)
  @Max(1, { message: 'Percentual de overhead deve ser entre 0 e 1 (0% a 100%).' })
  overheadPercentage: number;

  @IsNumber({}, { message: 'Percentual de desenvolvimento deve ser um número.' })
  @Min(0)
  @Max(1, { message: 'Percentual de desenvolvimento deve ser entre 0 e 1 (0% a 100%).' })
  developmentPercentage: number;

  @IsOptional()
  @IsInt({ message: 'O limite de WIP deve ser um número inteiro.' })
  @Min(1, { message: 'O limite de WIP deve ser pelo menos 1.' })
  recommendedWipLimit?: number;
}

class UpdateResourceDto {
  @IsOptional()
  @IsNotEmpty({ message: 'Nome do recurso não pode ser vazio.' })
  name?: string;

  @IsOptional()
  modalityId?: string;

  @IsOptional()
  roleId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  weeklyHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  overheadPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  developmentPercentage?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  recommendedWipLimit?: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('resources')
export class ResourcesController {
  constructor(private prisma: PrismaService, private engineService: EngineService, private events: BusinessEventsService) {}

  private async recalculate(tx: any, user: any, triggerType: string) {
    const result = await this.engineService.runProposedSimulation(tx, {});
    await this.engineService.persistSchedule(tx, result.simulation, { triggerType, triggeredById: user.id, inputHash: result.stateHash });
  }

  public static formatHours(hours: number): string {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  }

  public static calculateCapacity(res: any, workingDayCount = 5) {
    const weeklyHours = res.weeklyHours;
    const overhead = res.overheadPercentage;
    const dev = res.developmentPercentage;
    
    // Formula:
    // horasApósOverhead = horasSemanais * (1 - overheadPercentual)
    // capacidadeSemanalProjetos = horasApósOverhead * desenvolvimentoPercentual
    // capacidadeDiaria = capacidadeSemanalProjetos / 5
    const hoursAfterOverhead = weeklyHours * (1 - overhead);
    const weeklyProjCapacity = hoursAfterOverhead * dev;
    const dailyCapacity = EngineService.calculateBaseDailyCapacity(res, workingDayCount) / 60;

    return {
      hoursAfterOverhead,
      weeklyProjCapacity,
      dailyCapacity,
      weeklyFormatted: this.formatHours(weeklyProjCapacity),
      dailyFormatted: this.formatHours(dailyCapacity),
    };
  }

  private async workingDayCount(client: any = this.prisma) {
    const parameter = await client.globalParameter.findUnique({ where: { key: 'engine_working_days' } });
    try {
      const parsed = JSON.parse(parameter?.value || '[]');
      return Array.isArray(parsed) && parsed.length ? new Set(parsed).size : 5;
    } catch { return 5; }
  }

  @Get()
  async findAll() {
    const workingDayCount = await this.workingDayCount();
    const resources = await this.prisma.resource.findMany({
      include: {
        modality: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    return resources.map((r) => ({
      ...r,
      capacity: ResourcesController.calculateCapacity(r, workingDayCount),
    }));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const workingDayCount = await this.workingDayCount();
    const res = await this.prisma.resource.findUnique({
      where: { id },
      include: {
        modality: true,
        role: true,
      },
    });

    if (!res) {
      throw new BadRequestException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Recurso não encontrado.',
      });
    }

    return {
      ...res,
      capacity: ResourcesController.calculateCapacity(res, workingDayCount),
    };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':id/preview')
  async updatePreview(@Param('id') id: string, @Body() body: UpdateResourceDto) {
    const existing = await this.prisma.resource.findUnique({ where: { id } });
    if (!existing) {
      throw new BadRequestException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso não encontrado.' });
    }
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      resourcesModifier: resources => {
        const resource = resources.find(item => item.id === id);
        if (!resource) return;
        resource.name = body.name ?? resource.name;
        resource.weeklyHours = body.weeklyHours ?? resource.weeklyHours;
        resource.overheadPercentage = body.overheadPercentage ?? resource.overheadPercentage;
        resource.developmentPercentage = body.developmentPercentage ?? resource.developmentPercentage;
        resource.recommendedWipLimit = body.recommendedWipLimit ?? resource.recommendedWipLimit;
      },
    });
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post()
  async create(@Req() req: any, @Body() body: CreateResourceDto) {
    const modality = await this.prisma.catalogItem.findUnique({ where: { id: body.modalityId } });
    const role = await this.prisma.catalogItem.findUnique({ where: { id: body.roleId } });

    if (!modality || !role) {
      throw new BadRequestException({
        code: 'INVALID_RELATIONS',
        message: 'Modalidade ou Cargo de recurso não encontrado nos catálogos.',
      });
    }

    return this.prisma.$transaction(async tx => {
      const configuredWip = await tx.globalParameter.findUnique({ where: { key: 'engine_wip_limit' } });
      const defaultWip = Math.max(1, Number.parseInt(configuredWip?.value || '3', 10) || 3);
      const created = await tx.resource.create({ data: {
        name: body.name,
        modalityId: body.modalityId,
        roleId: body.roleId,
        weeklyHours: body.weeklyHours,
        overheadPercentage: body.overheadPercentage,
        developmentPercentage: body.developmentPercentage,
        recommendedWipLimit: body.recommendedWipLimit ?? defaultWip,
        status: UserStatus.ACTIVE,
      } });
      await this.events.record(tx, { aggregateType: 'RESOURCE', aggregateId: created.id, eventType: 'RESOURCE_CREATED', description: `Recurso ${created.name} criado.`, userId: req.user.id, actorName: req.user.name, metadata: { after: created } });
      await this.recalculate(tx, req.user, 'RESOURCE_CREATED');
      return created;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: UpdateResourceDto,
  ) {
    const res = await this.prisma.resource.findUnique({ where: { id } });
    if (!res) {
      throw new BadRequestException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso não encontrado.' });
    }

    if (body.modalityId) {
      const modality = await this.prisma.catalogItem.findUnique({ where: { id: body.modalityId } });
      if (!modality) throw new BadRequestException({ code: 'INVALID_MODALITY', message: 'Modalidade inválida.' });
    }

    if (body.roleId) {
      const role = await this.prisma.catalogItem.findUnique({ where: { id: body.roleId } });
      if (!role) throw new BadRequestException({ code: 'INVALID_ROLE', message: 'Cargo inválido.' });
    }

    return this.prisma.$transaction(async tx => {
      const updated = await tx.resource.update({ where: { id }, data: {
        name: body.name,
        modalityId: body.modalityId,
        roleId: body.roleId,
        weeklyHours: body.weeklyHours,
        overheadPercentage: body.overheadPercentage,
        developmentPercentage: body.developmentPercentage,
        recommendedWipLimit: body.recommendedWipLimit,
      } });
      await this.events.record(tx, { aggregateType: 'RESOURCE', aggregateId: id, eventType: 'RESOURCE_UPDATED', description: `Recurso ${updated.name} atualizado.`, userId: req.user.id, actorName: req.user.name, metadata: { before: res, after: updated } });
      await this.recalculate(tx, req.user, 'RESOURCE_UPDATED');
      return updated;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/activate')
  async activate(@Param('id') id: string, @Req() req: any) {
    return this.prisma.$transaction(async tx => {
      const updated = await tx.resource.update({ where: { id }, data: { status: UserStatus.ACTIVE } });
      await this.events.record(tx, { aggregateType: 'RESOURCE', aggregateId: id, eventType: 'RESOURCE_STATUS_CHANGED', description: `Recurso ${updated.name} ativado.`, userId: req.user.id, actorName: req.user.name, metadata: { status: 'ACTIVE' } });
      await this.recalculate(tx, req.user, 'RESOURCE_ACTIVATED');
      return updated;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    return this.prisma.$transaction(async tx => {
      const updated = await tx.resource.update({ where: { id }, data: { status: UserStatus.INACTIVE } });
      await this.events.record(tx, { aggregateType: 'RESOURCE', aggregateId: id, eventType: 'RESOURCE_STATUS_CHANGED', description: `Recurso ${updated.name} desativado.`, userId: req.user.id, actorName: req.user.name, metadata: { status: 'INACTIVE' } });
      await this.recalculate(tx, req.user, 'RESOURCE_DEACTIVATED');
      return updated;
    });
  }
}
