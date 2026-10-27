import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BusinessEventsService } from '../history-alerts/business-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';

class UpdateModeDto {
  @IsString() @IsNotEmpty() mode: 'automatic' | 'manual';
}
class ConfirmModeDto extends UpdateModeDto {
  @IsString() @IsNotEmpty() stateHash: string;
  @IsString() @IsNotEmpty() previewToken: string;
}
class UpdateOrderDto {
  @IsArray() manualOrder: string[];
}
class ConfirmOrderDto extends UpdateOrderDto {
  @IsString() @IsNotEmpty() stateHash: string;
  @IsString() @IsNotEmpty() previewToken: string;
}
class ConfirmRestoreDto {
  @IsString() @IsNotEmpty() stateHash: string;
  @IsString() @IsNotEmpty() previewToken: string;
}

type PreviewOperation = 'QUEUE_MODE' | 'QUEUE_REORDER' | 'QUEUE_RESTORE_AUTO';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('priority-queue')
export class PriorityQueueController {
  constructor(
    private prisma: PrismaService,
    private engineService: EngineService,
    private events: BusinessEventsService,
    private config: ConfigService = new ConfigService(),
  ) {}

  private digest(value: unknown) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private signPreview(userId: string, operation: PreviewOperation, proposal: unknown, stateHash: string) {
    const payload = Buffer.from(JSON.stringify({
      userId, operation, proposalDigest: this.digest(proposal), stateHash,
      engineVersion: EngineService.ENGINE_VERSION, exp: Date.now() + 10 * 60 * 1000,
    })).toString('base64url');
    const secret = this.config.get<string>('JWT_SECRET')!;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  private verifyPreview(token: string, userId: string, operation: PreviewOperation, proposal: unknown, stateHash: string) {
    try {
      const [payload, signature] = token.split('.');
      const expected = crypto.createHmac('sha256', this.config.get<string>('JWT_SECRET')!).update(payload).digest('base64url');
      if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error();
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (parsed.userId !== userId || parsed.operation !== operation || parsed.stateHash !== stateHash ||
          parsed.proposalDigest !== this.digest(proposal) || parsed.engineVersion !== EngineService.ENGINE_VERSION || parsed.exp < Date.now()) throw new Error();
    } catch {
      throw new BadRequestException({
        code: 'PREVIEW_EXPIRED_OR_INVALID',
        message: 'A prévia expirou ou não corresponde à alteração. Gere uma nova simulação antes de confirmar.',
      });
    }
  }

  private async validateManualOrder(order: string[], client: any = this.prisma) {
    if (order.some(id => typeof id !== 'string') || new Set(order).size !== order.length) {
      throw new BadRequestException({ code: 'INVALID_MANUAL_ORDER', message: 'A ordem manual contém projetos repetidos ou identificadores inválidos.' });
    }
    const ids = order.length ? await client.project.findMany({
      where: { id: { in: order }, status: { notIn: [7, 8, 9] } },
      select: { id: true },
    }) : [];
    if (ids.length !== order.length) {
      throw new BadRequestException({ code: 'INVALID_MANUAL_ORDER', message: 'A ordem manual contém projetos inexistentes ou que já saíram da fila.' });
    }
  }

  private async officialComparison(client: any, simulation: ReturnType<EngineService['simulateAllocationSchedule']>) {
    const [projects, phases, allocations, resources, metadata, officialRun] = await Promise.all([
      client.currentProjectSchedule.findMany(),
      client.currentPhaseSchedule.findMany({ include: { phase: { select: { name: true } } } }),
      client.currentResourceAllocation.findMany(),
      client.resource.findMany({ select: { id: true, name: true } }),
      client.project.findMany({ select: { id: true, title: true, sdNumber: true } }),
      client.scheduleRun.findFirst({
        where: { type: 'OFFICIAL', status: 'COMPLETED' }, orderBy: { startedAt: 'desc' },
        include: { projects: { select: { projectId: true, queuePosition: true } } },
      }),
    ]);
    const positions = new Map((officialRun?.projects || []).map((item: any) => [item.projectId, item.queuePosition]));
    const officialProjects = projects.map((project: any) => ({ ...project, queuePosition: positions.get(project.projectId) ?? null }));
    const endTimes = projects.map((project: any) => project.endDate ? new Date(project.endDate).getTime() : null)
      .filter((value: number | null): value is number => value !== null && Number.isFinite(value));
    const baseline = {
      projects: officialProjects,
      phases: phases.map((phase: any) => ({
        ...phase, phaseName: phase.phase.name,
        isManagement: phase.phase.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'gestao de projetos',
      })),
      allocations,
      utilization: [], warnings: [],
      portfolioEndDate: endTimes.length ? new Date(Math.max(...endTimes)) : null,
    } as any;
    return this.engineService.compareSchedules(
      simulation.projects, officialProjects, metadata,
      { baseline, proposed: simulation, resources },
    );
  }

  private async previewResponse(req: any, operation: PreviewOperation, proposal: unknown, overrides: any) {
    const result = await this.engineService.runProposedSimulation(this.prisma, overrides);
    const [comparison, officialRun] = await Promise.all([
      this.officialComparison(this.prisma, result.simulation),
      this.prisma.scheduleRun.findFirst({ where: { type: 'OFFICIAL', status: 'COMPLETED' }, orderBy: { startedAt: 'desc' }, select: { id: true } }),
    ]);
    return {
      ...comparison,
      currentCalculationDrift: result.comparison,
      stateHash: result.stateHash,
      referenceDate: result.simulation.referenceDate.toISOString(),
      engineVersion: result.simulation.engineVersion,
      officialRunId: officialRun?.id ?? null,
      previewToken: this.signPreview(req.user.id, operation, proposal, result.stateHash),
    };
  }

  private async assertCurrentState(client: any, stateHash: string) {
    if (await this.engineService.getDatabaseStateHash(client) !== stateHash) {
      throw new BadRequestException({
        code: 'DATABASE_CHANGED',
        message: 'A base de dados mudou depois da prévia. Gere uma nova simulação antes de confirmar.',
      });
    }
  }

  @Get()
  async getQueue() {
    const queue = await this.engineService.getEffectivePriorityQueue(this.prisma);
    const projectIds = queue.projects.map(project => project.id);
    const [allocationRows, eligibility] = await Promise.all([
      projectIds.length ? this.prisma.projectPhaseAllocation.findMany({
        where: { phase: { projectId: { in: projectIds } } },
        select: { phase: { select: { projectId: true } }, resource: { select: { name: true } } },
      }) : [],
      this.prisma.globalParameter?.findUnique
        ? this.prisma.globalParameter.findUnique({ where: { key: 'eligibility_mode' } })
        : Promise.resolve(null),
    ]);
    const allocatedResourcesByProject = new Map<string, Set<string>>();
    for (const allocation of allocationRows) {
      const names = allocatedResourcesByProject.get(allocation.phase.projectId) ?? new Set<string>();
      if (allocation.resource.name.trim()) names.add(allocation.resource.name.trim());
      allocatedResourcesByProject.set(allocation.phase.projectId, names);
    }
    const eligibilityMode = eligibility?.value || 'all_eligible';
    const isEligible = (project: any) => eligibilityMode === 'all_eligible' || project.committeeDecision === 'PRIORIZADO' ||
      (eligibilityMode === 'prioritized_and_second_phase' && project.committeeDecision === 'SEGUNDA_FASE');
    return {
      mode: queue.mode,
      manualOrder: queue.manualOrder,
      eligibilityMode,
      automaticCriteria: ['Requisito Legal', 'Decisão do Comitê', 'Estágio', 'Nota', 'Prioridade de Negócio', 'Abertura', 'SD'],
      projects: queue.projects.map((project, index) => ({
        ...project, position: index + 1, simulationEligible: isEligible(project),
        allocatedResourceNames: Array.from(allocatedResourcesByProject.get(project.id) ?? []).sort((a, b) => a.localeCompare(b, 'pt-BR')),
      })),
      stateHash: await this.engineService.getDatabaseStateHash(),
    };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('mode/preview')
  previewMode(@Req() req: any, @Body() body: UpdateModeDto) {
    return this.previewResponse(req, 'QUEUE_MODE', { mode: body.mode }, { queueModeOverride: body.mode });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('mode/confirm')
  async confirmMode(@Req() req: any, @Body() body: ConfirmModeDto) {
    const proposal = { mode: body.mode };
    this.verifyPreview(body.previewToken, req.user.id, 'QUEUE_MODE', proposal, body.stateHash);
    return this.prisma.$transaction(async tx => {
      await this.assertCurrentState(tx, body.stateHash);
      const result = await this.engineService.runProposedSimulation(tx, { queueModeOverride: body.mode });
      const comparison = await this.officialComparison(tx, result.simulation);
      await tx.priorityQueueState.update({ where: { id: 'singleton' }, data: { mode: body.mode, updatedById: req.user.id } });
      await this.engineService.persistSchedule(tx, result.simulation, { triggerType: 'QUEUE_MODE_CHANGE', triggeredById: req.user.id, inputHash: result.stateHash });
      await this.events.record(tx, {
        aggregateType: 'PRIORITY_QUEUE', aggregateId: 'singleton', eventType: 'QUEUE_MODE_CHANGE',
        description: `Modo da fila alterado para ${body.mode}.`, userId: req.user.id, actorName: req.user.name,
        metadata: { mode: body.mode, affectedProjects: comparison.affectedProjectsCount },
      });
      await tx.engineChangeLog.create({ data: {
        changeType: 'QUEUE_MODE_CHANGE', userId: req.user.id,
        portfolioEndDateBefore: comparison.portfolioEndDateBefore ? new Date(comparison.portfolioEndDateBefore) : null,
        portfolioEndDateAfter: result.simulation.portfolioEndDate,
        differenceDays: comparison.portfolioDifferenceDays, mainCause: `Modo da fila: ${body.mode}`,
        details: `Modo alterado para ${body.mode}. Projetos afetados: ${comparison.affectedProjectsCount}.`,
      } });
      return { success: true, comparison };
    }, { isolationLevel: 'Serializable' });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('manual-order/preview')
  async previewOrder(@Req() req: any, @Body() body: UpdateOrderDto) {
    await this.validateManualOrder(body.manualOrder);
    return this.previewResponse(req, 'QUEUE_REORDER', { manualOrder: body.manualOrder }, {
      queueModeOverride: 'manual', manualOrderOverride: body.manualOrder,
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('manual-order/confirm')
  async confirmOrder(@Req() req: any, @Body() body: ConfirmOrderDto) {
    const proposal = { manualOrder: body.manualOrder };
    this.verifyPreview(body.previewToken, req.user.id, 'QUEUE_REORDER', proposal, body.stateHash);
    return this.prisma.$transaction(async tx => {
      await this.assertCurrentState(tx, body.stateHash);
      await this.validateManualOrder(body.manualOrder, tx);
      const result = await this.engineService.runProposedSimulation(tx, { queueModeOverride: 'manual', manualOrderOverride: body.manualOrder });
      const comparison = await this.officialComparison(tx, result.simulation);
      const before = comparison.portfolioEndDateBefore ? new Date(comparison.portfolioEndDateBefore) : null;
      await tx.priorityQueueState.update({
        where: { id: 'singleton' },
        data: { mode: 'manual', manualOrder: JSON.stringify(body.manualOrder), updatedById: req.user.id },
      });
      await this.engineService.persistSchedule(tx, result.simulation, { triggerType: 'QUEUE_MANUAL_REORDER', triggeredById: req.user.id, inputHash: result.stateHash });
      await this.events.record(tx, {
        aggregateType: 'PRIORITY_QUEUE', aggregateId: 'singleton', eventType: 'QUEUE_MANUAL_REORDER',
        description: 'Fila de prioridades reordenada manualmente.', userId: req.user.id, actorName: req.user.name,
        metadata: { manualOrder: body.manualOrder, affectedProjects: comparison.affectedProjectsCount },
      });
      await tx.engineChangeLog.create({ data: {
        changeType: 'QUEUE_MANUAL_REORDER', userId: req.user.id,
        portfolioEndDateBefore: before, portfolioEndDateAfter: result.simulation.portfolioEndDate,
        differenceDays: comparison.portfolioDifferenceDays, mainCause: 'Reordenação manual da fila',
        details: `Reordenada fila manualmente. Projetos afetados: ${comparison.affectedProjectsCount}.`,
      } });
      return { success: true, comparison };
    }, { isolationLevel: 'Serializable' });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('restore-auto/preview')
  previewRestore(@Req() req: any) {
    return this.previewResponse(req, 'QUEUE_RESTORE_AUTO', {}, { queueModeOverride: 'automatic' });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('restore-auto/confirm')
  async confirmRestore(@Req() req: any, @Body() body: ConfirmRestoreDto) {
    this.verifyPreview(body.previewToken, req.user.id, 'QUEUE_RESTORE_AUTO', {}, body.stateHash);
    return this.prisma.$transaction(async tx => {
      await this.assertCurrentState(tx, body.stateHash);
      const result = await this.engineService.runProposedSimulation(tx, { queueModeOverride: 'automatic' });
      const comparison = await this.officialComparison(tx, result.simulation);
      await tx.priorityQueueState.update({ where: { id: 'singleton' }, data: { mode: 'automatic', updatedById: req.user.id } });
      await this.engineService.persistSchedule(tx, result.simulation, { triggerType: 'QUEUE_RESTORE_AUTO', triggeredById: req.user.id, inputHash: result.stateHash });
      await this.events.record(tx, {
        aggregateType: 'PRIORITY_QUEUE', aggregateId: 'singleton', eventType: 'QUEUE_RESTORE_AUTO',
        description: 'Fila restaurada para a ordenação automática.', userId: req.user.id, actorName: req.user.name,
        metadata: { affectedProjects: comparison.affectedProjectsCount },
      });
      await tx.engineChangeLog.create({ data: {
        changeType: 'QUEUE_RESTORE_AUTO', userId: req.user.id,
        portfolioEndDateBefore: comparison.portfolioEndDateBefore ? new Date(comparison.portfolioEndDateBefore) : null,
        portfolioEndDateAfter: result.simulation.portfolioEndDate,
        differenceDays: comparison.portfolioDifferenceDays, mainCause: 'Restauração da ordenação automática',
        details: `Fila restaurada para o modo automático. Projetos afetados: ${comparison.affectedProjectsCount}.`,
      } });
      return { success: true, comparison };
    }, { isolationLevel: 'Serializable' });
  }
}
