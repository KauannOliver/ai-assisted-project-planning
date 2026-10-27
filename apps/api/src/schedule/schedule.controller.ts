import { BadRequestException, Body, Controller, Get, Post, UseGuards, Req, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '@prisma/client';
import { EngineService } from '../engine/engine.service';
import { Roles } from '../auth/roles.decorator';
import { IsNotEmpty, IsString } from 'class-validator';

class RecalculateScheduleDto {
  @IsString()
  @IsNotEmpty()
  stateHash: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ScheduleController {
  constructor(private prisma: PrismaService, private engineService: EngineService) {}

  private async loadOfficialScenario(client: any) {
    const [projects, phases, allocations, resources] = await Promise.all([
      client.currentProjectSchedule.findMany(),
      client.currentPhaseSchedule.findMany({ include: { phase: { select: { name: true } } } }),
      client.currentResourceAllocation.findMany(),
      client.resource.findMany({ select: { id: true, name: true } }),
    ]);
    const portfolioEndDates = projects
      .map((project: any) => project.endDate ? new Date(project.endDate).getTime() : null)
      .filter((value: number | null): value is number => value !== null && Number.isFinite(value));

    return {
      simulation: {
        projects: projects.map((project: any) => ({ ...project, queuePosition: null })),
        phases: phases.map((phase: any) => ({
          ...phase,
          phaseName: phase.phase.name,
          isManagement: phase.phase.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'gestao de projetos',
        })),
        allocations,
        utilization: [],
        warnings: [],
        portfolioEndDate: portfolioEndDates.length ? new Date(Math.max(...portfolioEndDates)) : null,
      },
      resources,
    };
  }

  private isUnavailabilityOnDate(date: Date, item: { startDate: Date; endDate: Date; annualRecurrence: boolean }) {
    const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const startMonth = item.startDate.getUTCMonth();
    const startDay = item.startDate.getUTCDate();
    const endMonth = item.endDate.getUTCMonth();
    const endDay = item.endDate.getUTCDate();

    if (!item.annualRecurrence) {
      const start = Date.UTC(item.startDate.getUTCFullYear(), startMonth, startDay);
      const end = Date.UTC(item.endDate.getUTCFullYear(), endMonth, endDay);
      return current >= start && current <= end;
    }

    // Check both the current and previous recurrence year so ranges that cross
    // New Year's Eve remain correctly represented.
    return [date.getUTCFullYear(), date.getUTCFullYear() - 1].some(year => {
      const start = Date.UTC(year, startMonth, startDay);
      const crossesYear = endMonth < startMonth || (endMonth === startMonth && endDay < startDay);
      const end = Date.UTC(crossesYear ? year + 1 : year, endMonth, endDay);
      return current >= start && current <= end;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('schedule/recalculate/preview')
  async previewRecalculation() {
    const [result, officialScenario, metadata] = await Promise.all([
      this.engineService.runProposedSimulation(this.prisma, {}),
      this.loadOfficialScenario(this.prisma),
      this.prisma.project.findMany({ select: { id: true, title: true, sdNumber: true } }),
    ]);
    return {
      ...this.engineService.compareSchedules(
        result.simulation.projects,
        officialScenario.simulation.projects,
        metadata,
        { baseline: officialScenario.simulation as any, proposed: result.simulation, resources: officialScenario.resources },
      ),
      stateHash: result.stateHash,
      derivedDataOnly: true,
    };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('schedule/recalculate')
  async recalculateSchedule(@Req() req: any, @Body() body: RecalculateScheduleDto) {
    return this.prisma.$transaction(async tx => {
      const currentHash = await this.engineService.getDatabaseStateHash(tx);
      if (currentHash !== body.stateHash) {
        throw new BadRequestException({
          code: 'DATABASE_CHANGED',
          message: 'A base de dados mudou depois da prévia. Gere uma nova simulação antes de recalcular.',
        });
      }
      const [officialScenario, metadata] = await Promise.all([
        this.loadOfficialScenario(tx),
        tx.project.findMany({ select: { id: true, title: true, sdNumber: true } }),
      ]);
      const result = await this.engineService.runProposedSimulation(tx, {});
      const comparison = this.engineService.compareSchedules(
        result.simulation.projects,
        officialScenario.simulation.projects,
        metadata,
        { baseline: officialScenario.simulation as any, proposed: result.simulation, resources: officialScenario.resources },
      );
      const run = await this.engineService.persistSchedule(tx, result.simulation, {
        triggerType: 'MANUAL_ENGINE_RECALCULATION',
        triggeredById: req.user.id,
        inputHash: result.stateHash,
      });
      return { success: true, runId: run.id, comparison, derivedDataOnly: true };
    });
  }

  @Get('schedule/projects')
  async getProjectSchedules(@Req() req: any) {
    const user = req.user;
    const isRestricted = user.role === Role.MANAGER || user.role === Role.DIRECTOR;

    let filterClause: any = {};

    if (isRestricted) {
      // Find allowed departments
      const scopes = await this.prisma.userDepartmentScope.findMany({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      const allowedDepts = scopes.map(s => s.departmentId);

      filterClause = {
        departments: {
          some: {
            departmentId: { in: allowedDepts },
          },
        },
      };
    }

    const projects = await this.prisma.project.findMany({
      where: { AND: [filterClause, { status: { notIn: [7, 8, 9] } }] },
      include: {
        classification: true,
        businessPriority: true,
        class: true,
        currentSchedule: true,
        departments: { include: { department: true } },
      },
      orderBy: { sdNumber: 'asc' },
    });

    return projects.map(p => ({
      id: p.id,
      sdNumber: p.sdNumber,
      title: p.title,
      classification: p.classification.name,
      priority: p.businessPriority.name,
      className: p.class.name,
      status: p.status,
      startDate: p.currentSchedule?.startDate || null,
      endDate: p.currentSchedule?.endDate || null,
      scheduleStatus: p.currentSchedule?.status || 'ON_TIME',
      isImpeded: p.currentSchedule?.isImpeded || false,
      requestedDeadline: p.requestedDeadline,
      realCompletionDate: p.realCompletionDate,
      isWithoutRequestedDeadline: !p.requestedDeadline,
      impediments: p.currentSchedule?.impediments || null,
    }));
  }

  @Get('schedule/gantt')
  async getGanttData(@Req() req: any) {
    const user = req.user;
    const isRestricted = user.role === Role.MANAGER || user.role === Role.DIRECTOR;

    let filterClause: any = {};

    if (isRestricted) {
      const scopes = await this.prisma.userDepartmentScope.findMany({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      const allowedDepts = scopes.map(s => s.departmentId);

      filterClause = {
        departments: {
          some: {
            departmentId: { in: allowedDepts },
          },
        },
      };
    }

    const projects = await this.prisma.project.findMany({
      where: { AND: [filterClause, { status: { notIn: [7, 8, 9] } }] },
      include: {
        currentSchedule: true,
        phases: {
          orderBy: { order: 'asc' },
          include: {
            currentSchedule: true,
            allocations: {
              include: { resource: true },
            },
          },
        },
      },
      orderBy: { sdNumber: 'asc' },
    });

    return projects.map(p => ({
      id: p.id,
      sdNumber: p.sdNumber,
      title: p.title,
      startDate: p.currentSchedule?.startDate || null,
      endDate: p.currentSchedule?.endDate || null,
      isImpeded: p.currentSchedule?.isImpeded || false,
      phases: p.phases.map(ph => {
        const sched = ph.currentSchedule[0];
        return {
          id: ph.id,
          name: ph.name,
          startDate: sched?.startDate || null,
          endDate: sched?.endDate || null,
          resources: ph.allocations.map(al => al.resource.name),
        };
      }),
    }));
  }

  @Get('schedule/official')
  async getOfficialSchedule(@Req() req: any) {
    const user = req.user;
    const isRestricted = user.role === Role.MANAGER || user.role === Role.DIRECTOR;
    let filterClause: any = {};

    if (isRestricted) {
      const scopes = await this.prisma.userDepartmentScope.findMany({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      filterClause = {
        departments: {
          some: { departmentId: { in: scopes.map(scope => scope.departmentId) } },
        },
      };
    }

    const projects = await this.prisma.project.findMany({
      where: filterClause,
      include: {
        currentSchedule: true,
        departments: { include: { department: true } },
      },
      orderBy: { sdNumber: 'asc' },
    });

    return projects.map(project => {
      const hasSimulatedEnd = Boolean(
        project.currentSchedule?.endDate && !project.currentSchedule?.isImpeded,
      );
      return {
        id: project.id,
        sdNumber: project.sdNumber,
        title: project.title,
        departments: project.departments.map(item => item.department.code),
        status: project.status,
        openingDate: project.openingDate,
        simulatedEndDate: hasSimulatedEnd ? project.currentSchedule?.endDate : null,
        realCompletionDate: project.status === 7 ? project.realCompletionDate : null,
        inSchedule: hasSimulatedEnd,
      };
    });
  }

  @Get('capacity/heatmap')
  async getHeatmapData(@Query('days') daysParam?: string, @Query('start') startParam?: string) {
    const days = Math.min(84, Math.max(7, Number(daysParam || 28)));
    const start = startParam ? new Date(`${startParam}T00:00:00Z`) : new Date();
    start.setUTCHours(0, 0, 0, 0);
    if (!startParam) {
      // Default to Sunday so every weekly block is shown as Sun-Sat.
      start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days - 1);

    const input = await this.engineService.fetchEngineInput(this.prisma);
    const allocations = await this.prisma.currentResourceAllocation.findMany({
      where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' },
    });
    const projectIds = Array.from(new Set(allocations.map(a => a.projectId)));
    const projects = await this.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, sdNumber: true, title: true } });
    const phaseIds = Array.from(new Set(allocations.map(a => a.projectPhaseId)));
    const phases = await this.prisma.projectPhase.findMany({ where: { id: { in: phaseIds } }, select: { id: true, name: true } });

    const [resources, unavailabilities] = await Promise.all([
      this.prisma.resource.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
      this.prisma.resourceUnavailability.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          type: true,
          startDate: true,
          endDate: true,
          unavailableMinutesPerDay: true,
          resourceId: true,
          global: true,
          annualRecurrence: true,
          notes: true,
        },
      }),
    ]);

    // Group by resource
    const result = resources.map(r => {
      const engineResource = input.resources.find(er => er.id === r.id);
      const cells = [];
      for (let offset = 0; offset < days; offset++) {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + offset);
        const dateKey = date.toISOString().split('T')[0];
        const dayAllocations = allocations.filter(a => a.resourceId === r.id && a.date.toISOString().split('T')[0] === dateKey);
        const busyMinutes = dayAllocations.reduce((sum, a) => sum + a.minutesAllocated, 0);
        const managementMinutes = dayAllocations
          .filter(a => phases.find(phase => phase.id === a.projectPhaseId)?.name === 'Gestão de Projetos')
          .reduce((sum, a) => sum + a.minutesAllocated, 0);
        const effectiveHolidays = input.holidayBehavior === 'include' ? [] : input.holidays;
        const totalMinutes = engineResource
          ? this.engineService.getResourceCapacityOnDate(
              date,
              engineResource,
              effectiveHolidays,
              new Map(),
              { workingDays: input.workingDays, ignoreIndividualUnavailability: managementMinutes > 0 },
            )
          : 0;
        const dayUnavailabilities = unavailabilities
          .filter(item => (item.global || item.resourceId === r.id) && this.isUnavailabilityOnDate(date, item))
          .map(item => ({
            id: item.id,
            type: item.type,
            notes: item.notes,
            global: item.global,
            unavailableMinutesPerDay: item.unavailableMinutesPerDay,
          }));
        cells.push({
          date: dateKey,
          percentage: totalMinutes > 0 ? Number(((busyMinutes / totalMinutes) * 100).toFixed(2)) : busyMinutes > 0 ? 100 : 0,
          busyMinutes,
          totalMinutes,
          managementMinutes,
          isWorkingDay: input.workingDays.includes(date.getUTCDay()),
          unavailabilities: dayUnavailabilities,
          projects: dayAllocations.map(a => {
            const project = projects.find(p => p.id === a.projectId);
            const phase = phases.find(item => item.id === a.projectPhaseId);
            return { projectId: a.projectId, sdNumber: project?.sdNumber || '', title: project?.title || '', minutes: a.minutesAllocated, phaseId: a.projectPhaseId, phaseName: phase?.name || '' };
          }),
        });
      }
      return {
        resourceId: r.id,
        resourceName: r.name,
        days: cells,
      };
    });

    return result;
  }

  @Get('schedule/runs')
  async getScheduleRuns() {
    return this.prisma.scheduleRun.findMany({ where: { type: 'OFFICIAL', status: 'COMPLETED' }, orderBy: { startedAt: 'desc' }, take: 30 });
  }
}
