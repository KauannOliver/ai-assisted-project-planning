import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete,
  Body, 
  Param, 
  UseGuards, 
  BadRequestException,
  Req
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UnavailabilityType, UserStatus } from '@tic/database';
import { IsNotEmpty, IsEnum, IsBoolean, IsOptional, IsInt, Min } from 'class-validator';
import { EngineService } from '../engine/engine.service';
import { BusinessEventsService } from '../history-alerts/business-events.service';

class UnavailabilityActionDto {
  @IsEnum(UnavailabilityType, { message: 'Tipo de indisponibilidade inválido.' })
  @IsNotEmpty({ message: 'Tipo é obrigatório.' })
  type: UnavailabilityType;

  @IsNotEmpty({ message: 'Data inicial é obrigatória.' })
  startDate: string;

  @IsNotEmpty({ message: 'Data final é obrigatória.' })
  endDate: string;

  @IsOptional()
  @IsInt({ message: 'Minutos indisponíveis devem ser um número inteiro.' })
  @Min(1, { message: 'Minutos indisponíveis devem ser no mínimo 1.' })
  unavailableMinutesPerDay?: number;

  @IsOptional()
  resourceId?: string;

  @IsBoolean({ message: 'O campo global deve ser booleano.' })
  global: boolean;

  @IsBoolean({ message: 'O campo recorrência anual deve ser booleano.' })
  annualRecurrence: boolean;

  @IsOptional()
  notes?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('unavailabilities')
export class UnavailabilitiesController {
  constructor(private prisma: PrismaService, private engineService: EngineService, private events: BusinessEventsService) {}

  private parseCivilDate(value: string): Date {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return new Date(Number.NaN);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3])
      ? date
      : new Date(Number.NaN);
  }

  private proposedModifier(body: UnavailabilityActionDto, remove?: any) {
    return {
      resourcesModifier: (resources: any[]) => {
        if (remove?.resourceId) {
          const resource = resources.find(r => r.id === remove.resourceId);
          if (resource) resource.unavailabilities = resource.unavailabilities.filter((u: any) => !(u.startDate.getTime() === remove.startDate.getTime() && u.endDate.getTime() === remove.endDate.getTime()));
        }
        if (!body.global && body.resourceId) {
          const resource = resources.find(r => r.id === body.resourceId);
          if (resource) resource.unavailabilities.push({ type: body.type, startDate: this.parseCivilDate(body.startDate), endDate: this.parseCivilDate(body.endDate), unavailableMinutesPerDay: body.unavailableMinutesPerDay ?? null, annualRecurrence: body.annualRecurrence });
        }
      },
      holidaysModifier: (holidays: any[]) => {
        if (remove?.global) holidays.splice(0, holidays.length, ...holidays.filter((h: any) => !(h.startDate.getTime() === remove.startDate.getTime() && h.endDate.getTime() === remove.endDate.getTime())));
        if (body.global) holidays.push({ startDate: this.parseCivilDate(body.startDate), endDate: this.parseCivilDate(body.endDate), annualRecurrence: body.annualRecurrence, unavailableMinutesPerDay: body.unavailableMinutesPerDay ?? null });
      },
    };
  }

  private async recalculate(tx: any, user: any, triggerType: string) {
    const result = await this.engineService.runProposedSimulation(tx, {});
    await this.engineService.persistSchedule(tx, result.simulation, { triggerType, triggeredById: user.id, inputHash: result.stateHash });
  }

  private validateDto(dto: UnavailabilityActionDto) {
    const start = this.parseCivilDate(dto.startDate);
    const end = this.parseCivilDate(dto.endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException({ code: 'INVALID_DATES', message: 'Formatos de data inválidos.' });
    }

    if (start > end) {
      throw new BadRequestException({ code: 'DATE_ORDER_INVALID', message: 'A data inicial não pode ser posterior à data final.' });
    }

    if (dto.type === UnavailabilityType.FERIADO && !dto.global) {
      throw new BadRequestException({ code: 'HOLIDAY_MUST_BE_GLOBAL', message: 'Feriados devem ser configurados como globais.' });
    }

    if (dto.global && dto.resourceId) {
      throw new BadRequestException({ code: 'GLOBAL_CANNOT_HAVE_RESOURCE', message: 'Indisponibilidades globais não podem ser vinculadas a recursos específicos.' });
    }

    if (!dto.global && !dto.resourceId) {
      throw new BadRequestException({ code: 'RESOURCE_REQUIRED', message: 'Indisponibilidades individuais necessitam de um recurso selecionado.' });
    }
  }

  @Get()
  async findAll() {
    return this.prisma.resourceUnavailability.findMany({
      where: { status: UserStatus.ACTIVE },
      include: {
        resource: {
          select: {
            id: true,
            name: true,
          }
        }
      },
      orderBy: { startDate: 'asc' },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('preview')
  async createPreview(@Body() body: UnavailabilityActionDto) {
    this.validateDto(body);
    const result = await this.engineService.runProposedSimulation(this.prisma, this.proposedModifier(body));
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('confirm')
  async createConfirm(@Req() req: any, @Body() body: UnavailabilityActionDto) {
    this.validateDto(body);

    if (body.resourceId) {
      const resExists = await this.prisma.resource.findUnique({ where: { id: body.resourceId } });
      if (!resExists) throw new BadRequestException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso não encontrado.' });
    }

    return this.prisma.$transaction(async tx => {
      const created = await tx.resourceUnavailability.create({ data: {
        type: body.type,
        startDate: this.parseCivilDate(body.startDate),
        endDate: this.parseCivilDate(body.endDate),
        unavailableMinutesPerDay: body.unavailableMinutesPerDay,
        resourceId: body.resourceId,
        global: body.global,
        annualRecurrence: body.annualRecurrence,
        notes: body.notes,
        status: UserStatus.ACTIVE,
      } });
      await this.events.record(tx, { aggregateType: 'UNAVAILABILITY', aggregateId: created.id, eventType: 'UNAVAILABILITY_CREATED', description: `Indisponibilidade ${created.type} criada.`, userId: req.user.id, actorName: req.user.name, metadata: { after: created } });
      await this.recalculate(tx, req.user, 'UNAVAILABILITY_CREATED');
      return created;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':id/preview')
  async updatePreview(
    @Param('id') id: string,
    @Body() body: UnavailabilityActionDto,
  ) {
    const unavail = await this.prisma.resourceUnavailability.findUnique({ where: { id } });
    if (!unavail) throw new BadRequestException({ code: 'UNAVAILABILITY_NOT_FOUND', message: 'Indisponibilidade não encontrada.' });
    
    this.validateDto(body);
    const result = await this.engineService.runProposedSimulation(this.prisma, this.proposedModifier(body, unavail));
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':id/confirm')
  async updateConfirm(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: UnavailabilityActionDto,
  ) {
    const unavail = await this.prisma.resourceUnavailability.findUnique({ where: { id } });
    if (!unavail) throw new BadRequestException({ code: 'UNAVAILABILITY_NOT_FOUND', message: 'Indisponibilidade não encontrada.' });
    
    this.validateDto(body);

    return this.prisma.$transaction(async tx => {
      const updated = await tx.resourceUnavailability.update({ where: { id }, data: {
        type: body.type,
        startDate: this.parseCivilDate(body.startDate),
        endDate: this.parseCivilDate(body.endDate),
        unavailableMinutesPerDay: body.unavailableMinutesPerDay,
        resourceId: body.resourceId,
        global: body.global,
        annualRecurrence: body.annualRecurrence,
        notes: body.notes,
      } });
      await this.events.record(tx, { aggregateType: 'UNAVAILABILITY', aggregateId: id, eventType: 'UNAVAILABILITY_UPDATED', description: `Indisponibilidade ${updated.type} atualizada.`, userId: req.user.id, actorName: req.user.name, metadata: { before: unavail, after: updated } });
      await this.recalculate(tx, req.user, 'UNAVAILABILITY_UPDATED');
      return updated;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Delete(':id/preview')
  async deletePreview(@Param('id') id: string) {
    const unavail = await this.prisma.resourceUnavailability.findUnique({ where: { id } });
    if (!unavail) throw new BadRequestException({ code: 'UNAVAILABILITY_NOT_FOUND', message: 'Indisponibilidade não encontrada.' });

    const emptyBody: UnavailabilityActionDto = { type: unavail.type, startDate: unavail.startDate.toISOString(), endDate: unavail.endDate.toISOString(), unavailableMinutesPerDay: unavail.unavailableMinutesPerDay ?? undefined, resourceId: unavail.resourceId ?? undefined, global: false, annualRecurrence: false };
    const modifier = this.proposedModifier(emptyBody, unavail);
    modifier.resourcesModifier = (resources: any[]) => {
      if (unavail.resourceId) {
        const resource = resources.find(r => r.id === unavail.resourceId);
        if (resource) resource.unavailabilities = resource.unavailabilities.filter((u: any) => !(u.startDate.getTime() === unavail.startDate.getTime() && u.endDate.getTime() === unavail.endDate.getTime()));
      }
    };
    modifier.holidaysModifier = (holidays: any[]) => {
      if (unavail.global) holidays.splice(0, holidays.length, ...holidays.filter((h: any) => !(h.startDate.getTime() === unavail.startDate.getTime() && h.endDate.getTime() === unavail.endDate.getTime())));
    };
    const result = await this.engineService.runProposedSimulation(this.prisma, modifier);
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Delete(':id/confirm')
  async deleteConfirm(@Param('id') id: string, @Req() req: any) {
    const unavail = await this.prisma.resourceUnavailability.findUnique({ where: { id } });
    if (!unavail) throw new BadRequestException({ code: 'UNAVAILABILITY_NOT_FOUND', message: 'Indisponibilidade não encontrada.' });

    return this.prisma.$transaction(async tx => {
      const updated = await tx.resourceUnavailability.update({ where: { id }, data: { status: UserStatus.INACTIVE } });
      await this.events.record(tx, { aggregateType: 'UNAVAILABILITY', aggregateId: id, eventType: 'UNAVAILABILITY_STATUS_CHANGED', description: `Indisponibilidade ${unavail.type} desativada.`, userId: req.user.id, actorName: req.user.name, metadata: { status: 'INACTIVE' } });
      await this.recalculate(tx, req.user, 'UNAVAILABILITY_DEACTIVATED');
      return updated;
    });
  }
}
