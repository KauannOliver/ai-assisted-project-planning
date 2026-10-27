import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  UseGuards, 
  BadRequestException 
  ,Req
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EngineService } from '../engine/engine.service';
import { BusinessEventsService } from '../history-alerts/business-events.service';

class ParameterActionDto {
  @IsNotEmpty({ message: 'A chave do parâmetro é obrigatória.' })
  key: string;

  @IsNotEmpty({ message: 'O valor do parâmetro é obrigatório.' })
  value: string;

  @IsOptional()
  @IsString()
  stateHash?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('parameters')
export class ParametersController {
  constructor(private prisma: PrismaService, private engineService: EngineService, private events: BusinessEventsService) {}

  private assertManagedParameter(key: string) {
    if (key === 'queue_mode' || key === 'queue_rules_order') {
      throw new BadRequestException({
        code: 'QUEUE_PARAMETER_READ_ONLY',
        message: key === 'queue_mode'
          ? 'Altere o modo pela tela Fila de Prioridades, que aplica a prévia e a confirmação seguras.'
          : 'Os critérios da fila automática são informativos e versionados pelo motor.',
      });
    }
  }

  private simulationOverrides(key: string, value: string) {
    if (key === 'eligibility_mode') return { eligibilityModeOverride: value };
    if (key === 'engine_wip_mode') return { wipModeOverride: value === 'hard' ? 'hard' as const : 'soft' as const };
    if (key === 'engine_max_schedule_days') return { maxScheduleDaysOverride: Number(value) };
    if (key === 'engine_delay_risk_tolerance_days') return { riskToleranceDaysOverride: Number(value) };
    if (key === 'queue_mode') return { queueModeOverride: value === 'manual' ? 'manual' as const : 'automatic' as const };
    if (key === 'engine_holiday_behavior') return { holidayBehaviorOverride: value === 'include' ? 'include' as const : 'skip' as const };
    if (key === 'engine_working_days') {
      const weekdayCodes: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      try {
        const parsed = JSON.parse(value);
        const workingDaysOverride = Array.isArray(parsed)
          ? Array.from(new Set(parsed.map(item => weekdayCodes[String(item).toLowerCase()]).filter(day => day !== undefined)))
          : [];
        return workingDaysOverride.length ? { workingDaysOverride } : {};
      } catch {
        return {};
      }
    }
    if (key === 'engine_start_date_mode') {
      const rawDate = value === 'current_date' ? new Date().toISOString().slice(0, 10) : value.slice(0, 10);
      const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        return { startCalcDateOverride: new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) };
      }
    }
    return {};
  }

  @Get()
  async findAll() {
    return this.prisma.globalParameter.findMany({
      orderBy: { key: 'asc' },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('preview')
  async preview(@Body() body: ParameterActionDto) {
    this.assertManagedParameter(body.key);
    const parameter = await this.prisma.globalParameter.findUnique({
      where: { key: body.key },
    });

    if (!parameter) {
      throw new BadRequestException({
        code: 'PARAMETER_NOT_FOUND',
        message: 'Parâmetro global não encontrado.',
      });
    }

    const result = await this.engineService.runProposedSimulation(this.prisma, this.simulationOverrides(body.key, body.value));
    return {
      key: body.key,
      proposedValue: body.value,
      currentValue: parameter.value,
      category: parameter.category,
      ...result.comparison,
      stateHash: result.stateHash,
    };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('confirm')
  async confirm(@Req() req: any, @Body() body: ParameterActionDto) {
    this.assertManagedParameter(body.key);
    const parameter = await this.prisma.globalParameter.findUnique({
      where: { key: body.key },
    });

    if (!parameter) {
      throw new BadRequestException({
        code: 'PARAMETER_NOT_FOUND',
        message: 'Parâmetro global não encontrado.',
      });
    }

    if (!body.stateHash) {
      throw new BadRequestException({ code: 'PREVIEW_REQUIRED', message: 'Gere a prévia antes de confirmar a alteração.' });
    }
    return this.prisma.$transaction(async tx => {
      const currentHash = await this.engineService.getDatabaseStateHash(tx);
      if (currentHash !== body.stateHash) {
        throw new BadRequestException({ code: 'DATABASE_CHANGED', message: 'A base mudou depois da prévia. Gere uma nova simulação.' });
      }
      const result = await this.engineService.runProposedSimulation(tx, this.simulationOverrides(body.key, body.value));
      const updated = await tx.globalParameter.update({ where: { key: body.key }, data: { value: body.value } });
      if (body.key === 'queue_mode') await tx.priorityQueueState.update({ where: { id: 'singleton' }, data: { mode: body.value } });
      await this.engineService.persistSchedule(tx, result.simulation, { triggerType: 'PARAMETER_CHANGED', triggeredById: req.user.id, inputHash: result.stateHash });
      await this.events.record(tx, { aggregateType: 'PARAMETER', aggregateId: body.key, eventType: 'PARAMETER_CHANGED', description: `Parâmetro ${body.key} alterado.`, userId: req.user.id, actorName: req.user.name, metadata: { before: parameter.value, after: body.value } });
      return updated;
    }, { isolationLevel: 'Serializable' });
  }
}
