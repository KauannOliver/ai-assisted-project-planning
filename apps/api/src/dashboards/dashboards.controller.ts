import { 
  Controller, 
  Get, 
  Query, 
  UseGuards, 
  BadRequestException, 
  Req 
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '@prisma/client';
import { buildBottleneckRanking } from './bottleneck-analysis';
import { EngineService } from '../engine/engine.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DashboardsController {
  constructor(private prisma: PrismaService) {}

  private async getDepartmentAllowedIds(user: any): Promise<string[] | null> {
    if (user.role === Role.MANAGER || user.role === Role.DIRECTOR) {
      const scopes = await this.prisma.userDepartmentScope.findMany({
        where: { userId: user.id },
        select: { departmentId: true },
      });
      return scopes.map(s => s.departmentId);
    }
    return null;
  }

  @Get('dashboards/overview')
  async getOverview(@Req() req: any) {
    const user = req.user;
    const allowedDepts = await this.getDepartmentAllowedIds(user);
    
    // The executive dashboard represents the complete portfolio, including
    // concluded, returned and cancelled projects. Department-scoped users
    // continue to see only projects from their allowed departments.
    const filterClause: any = {};
    if (allowedDepts) {
      filterClause.departments = {
        some: { departmentId: { in: allowedDepts } },
      };
    }

    const projects = await this.prisma.project.findMany({
      where: filterClause,
      include: {
        classification: true,
        businessPriority: true,
        class: true,
        currentSchedule: true,
        departments: { include: { department: true } },
        systems: { include: { system: true } },
      },
    });

    const totalProjects = projects.length;

    // Counts
    const statusCounts: Record<number, number> = {
      0: 0,
      1: 0,
      2: 0,
      4: 0,
      5: 0,
      6: 0,
      7: 0,
      8: 0,
      9: 0,
    };
    const decisionCounts = { PRIORIZADO: 0, SEGUNDA_FASE: 0, NAO_AVALIADO: 0 };
    const classificationCounts: Record<string, number> = {};
    const systemCounts: Record<string, number> = {};

    let inRiskCount = 0;
    let delayedCount = 0;
    let startedWithoutCommittee = 0;

    for (const p of projects) {
      // status
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;

      // decision
      const dec = (p.committeeDecision || 'NAO_AVALIADO') as keyof typeof decisionCounts;
      if (decisionCounts[dec] !== undefined) {
        decisionCounts[dec]++;
      } else {
        decisionCounts.NAO_AVALIADO++;
      }

      // classification
      const cName = p.classification.name;
      classificationCounts[cName] = (classificationCounts[cName] || 0) + 1;

      // systems
      for (const sys of p.systems) {
        const sName = sys.system.name;
        systemCounts[sName] = (systemCounts[sName] || 0) + 1;
      }

      // Schedule risk
      if (p.currentSchedule) {
        if (p.currentSchedule.status === 'AT_RISK') inRiskCount++;
        if (p.currentSchedule.status === 'DELAYED') delayedCount++;
      }

      // Started without committee approval (status 5 without PRIORIZADO decision)
      if (p.status === 5 && p.committeeDecision !== 'PRIORIZADO') {
        startedWithoutCommittee++;
      }
    }

    // Warnings
    const warningFilter: any = {};
    if (allowedDepts) {
      warningFilter.projectId = {
        in: projects.map(p => p.id),
      };
    }
    const dbWarnings = await this.prisma.currentEngineWarning.findMany({
      where: warningFilter,
    });

    const phasesWithoutResource = dbWarnings.filter(w => w.type === 'PHASE_NO_RESOURCE').length;
    const overloadedResources = new Set(dbWarnings.filter(w => w.type === 'WIP_OVERLOAD').map(w => w.resourceId)).size;

    // Deliveries pending
    const deliveryFilter: any = { feedback: null };
    if (allowedDepts) {
      deliveryFilter.recipientDeptId = { in: allowedDepts };
    }
    const pendingDeliveries = await this.prisma.delivery.count({
      where: deliveryFilter,
    });

    // Schedule portfolio end date
    const schedules = await this.prisma.currentProjectSchedule.findMany({
      where: allowedDepts ? { projectId: { in: projects.map(p => p.id) } } : {},
    });
    const validEnds = schedules.map(s => s.endDate).filter((d): d is Date => d !== null);
    const portfolioEndDate = validEnds.length > 0 
      ? new Date(Math.max(...validEnds.map(d => d.getTime())))
      : null;

    // Capacity metrics
    const [resources, workingDaysParameter] = await Promise.all([
      this.prisma.resource.findMany({
        where: { status: 'ACTIVE' },
        include: { role: true },
      }),
      this.prisma.globalParameter.findUnique({ where: { key: 'engine_working_days' } }),
    ]);
    let workingDayCount = 5;
    try {
      const configuredDays = JSON.parse(workingDaysParameter?.value || '[]');
      if (Array.isArray(configuredDays) && configuredDays.length > 0) {
        workingDayCount = new Set(configuredDays).size;
      }
    } catch {
      workingDayCount = 5;
    }
    let totalWeeklyCapacityMinutes = 0;
    for (const r of resources) {
      const dailyCapacityMinutes = EngineService.calculateBaseDailyCapacity(r, workingDayCount);
      totalWeeklyCapacityMinutes += dailyCapacityMinutes * workingDayCount;
    }

    // Utilization
    const dbUtils = await this.prisma.currentResourceUtilization.findMany({});
    const totalBusyMinutes = dbUtils.reduce((acc, curr) => acc + curr.minutesBusy, 0);
    const totalCapMinutes = dbUtils.reduce((acc, curr) => acc + curr.minutesTotal, 0);
    const capacityCommitmentPercentage = totalCapMinutes > 0
      ? parseFloat(((totalBusyMinutes / totalCapMinutes) * 100).toFixed(1))
      : 0;

    // A bottleneck is not just an alert: it combines simultaneous projects,
    // assigned effort and the highest daily load found in the current scenario.
    const activeProjectIds = projects.filter(p => ![7, 8, 9].includes(p.status)).map(p => p.id);
    const [phaseAllocations, scheduledAllocations] = await Promise.all([
      this.prisma.projectPhaseAllocation.findMany({
        where: { phase: { projectId: { in: activeProjectIds } } },
        select: {
          resourceId: true,
          minutesAllocated: true,
          phase: { select: { projectId: true } },
        },
      }),
      this.prisma.currentResourceAllocation.findMany({
        where: { projectId: { in: activeProjectIds } },
        select: { resourceId: true, minutesAllocated: true, date: true },
      }),
    ]);

    const bottleneckInputs = resources.map(resource => {
      const assigned = phaseAllocations.filter(allocation => allocation.resourceId === resource.id);
      const scheduled = scheduledAllocations.filter(allocation => allocation.resourceId === resource.id);
      const dailyCapacityMinutes = Math.max(
        1,
        EngineService.calculateBaseDailyCapacity(resource, workingDayCount),
      );
      const minutesByDate = new Map<string, number>();
      for (const allocation of scheduled) {
        const key = allocation.date.toISOString().slice(0, 10);
        minutesByDate.set(key, (minutesByDate.get(key) || 0) + allocation.minutesAllocated);
      }
      const maxDailyMinutes = Math.max(0, ...minutesByDate.values());

      return {
        id: resource.id,
        name: resource.name,
        role: resource.role.name,
        recommendedWipLimit: resource.recommendedWipLimit,
        activeProjectIds: assigned.map(allocation => allocation.phase.projectId),
        allocatedMinutes: assigned.reduce((sum, allocation) => sum + allocation.minutesAllocated, 0),
        scheduledMinutes: scheduled.reduce((sum, allocation) => sum + allocation.minutesAllocated, 0),
        maxDailyUtilization: (maxDailyMinutes / dailyCapacityMinutes) * 100,
      };
    });
    const resourceBottlenecks = buildBottleneckRanking(bottleneckInputs).slice(0, 10);

    // Recent change logs
    const recentLogs = await this.prisma.engineChangeLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    return {
      totalProjects,
      statusCounts,
      decisionCounts,
      classificationCounts,
      systemCounts,
      inRiskCount,
      delayedCount,
      startedWithoutCommittee,
      phasesWithoutResource,
      overloadedResources,
      pendingDeliveries,
      portfolioEndDate,
      totalWeeklyCapacityHours: parseFloat((totalWeeklyCapacityMinutes / 60).toFixed(1)),
      capacityCommitmentPercentage,
      resourceBottlenecks,
      recentLogs: recentLogs.map(l => ({
        id: l.id,
        changeType: l.changeType,
        timestamp: l.timestamp,
        differenceDays: l.differenceDays,
        mainCause: l.mainCause,
        details: l.details,
      })),
    };
  }

  @Get('dashboards/manager')
  async getManagerDashboard(@Req() req: any) {
    // Re-uses overview metrics with department constraints, but returns additional info
    const overview = await this.getOverview(req);
    
    // Scoped projects
    const allowedDepts = await this.getDepartmentAllowedIds(req.user);
    if (!allowedDepts) {
      throw new BadRequestException('Usuário não possui escopo departamental vinculado.');
    }

    const projects = await this.prisma.project.findMany({
      where: {
        status: { notIn: [7, 8, 9] },
        departments: { some: { departmentId: { in: allowedDepts } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    return {
      ...overview,
      recentProjectsUpdated: projects.map(p => ({
        id: p.id,
        sdNumber: p.sdNumber,
        title: p.title,
        status: p.status,
        updatedAt: p.updatedAt,
      })),
    };
  }

  @Get('dashboards/director')
  async getDirectorDashboard(@Req() req: any) {
    const overview = await this.getOverview(req);
    
    // Director dashboard adds financial metrics
    const allowedDepts = await this.getDepartmentAllowedIds(req.user);
    let filterClause: any = { status: { notIn: [7, 8, 9] } };
    if (allowedDepts) {
      filterClause.departments = {
        some: { departmentId: { in: allowedDepts } },
      };
    }

    const projects = await this.prisma.project.findMany({
      where: filterClause,
    });

    let totalGain = 0;
    let totalLossAvoided = 0;
    let totalLegalRequirements = 0;
    let totalPrioritized = 0;

    for (const p of projects) {
      totalGain += p.estimatedMonthlyGain || 0;
      totalLossAvoided += p.estimatedMonthlyLossAvoided || 0;
      if (p.isLegalRequirement) totalLegalRequirements++;
      if (p.committeeDecision === 'PRIORIZADO') totalPrioritized++;
    }

    const totalRoi = totalGain + totalLossAvoided;

    return {
      ...overview,
      financials: {
        estimatedMonthlyGain: totalGain,
        estimatedMonthlyLossAvoided: totalLossAvoided,
        roiMonthly: totalRoi,
      },
      totalLegalRequirements,
      totalPrioritized,
    };
  }

  @Get('views/kanban')
  async getKanbanData(@Req() req: any, @Query('by') by: string = 'status') {
    const allowedDepts = await this.getDepartmentAllowedIds(req.user);
    
    let filterClause: any = by === 'status'
      ? {}
      : by === 'decision'
        ? { status: { notIn: [7, 8] } }
        : { status: { notIn: [7, 8, 9] } };
    if (allowedDepts) {
      filterClause.departments = {
        some: { departmentId: { in: allowedDepts } },
      };
    }

    const projects = await this.prisma.project.findMany({
      where: filterClause,
      include: {
        businessPriority: true,
        classification: true,
        currentSchedule: true,
        phases: { select: { _count: { select: { allocations: true } } } },
      },
    });

    const formatProject = (p: any) => ({
      id: p.id,
      sdNumber: p.sdNumber,
      title: p.title,
      priority: p.businessPriority.name,
      classification: p.classification.name,
      endDate: p.currentSchedule?.endDate || null,
      isImpeded: p.currentSchedule?.isImpeded || false,
      status: p.status,
      realCompletionDate: p.realCompletionDate || null,
      hasAllocatedResources: p.phases.some((phase: any) => phase._count.allocations > 0),
    });

    if (by === 'decision') {
      const columns = {
        PRIORIZADO: [] as any[],
        SEGUNDA_FASE: [] as any[],
        CANCELADO: [] as any[],
        NAO_AVALIADO: [] as any[],
      };

      for (const p of projects) {
        const dec = (p.committeeDecision || 'NAO_AVALIADO') as keyof typeof columns;
        if (columns[dec] !== undefined) {
          columns[dec].push(formatProject(p));
        } else {
          columns.NAO_AVALIADO.push(formatProject(p));
        }
      }

      return columns;
    }

    if (by === 'phase') {
      // 9 phases columns
      const phases = await this.prisma.projectPhase.findMany({
        where: { projectId: { in: projects.map(p => p.id) } },
        orderBy: { order: 'asc' },
      });

      const columns: Record<string, any[]> = {
        'Gestão de Projetos': [],
        'Levantamento': [],
        'Arquitetura': [],
        'Design': [],
        'Desenvolvimento': [],
        'Qualidade': [],
        'Entrega/Aplicação': [],
        'Homologação': [],
        'Golive': [],
      };

      // A project is in the column of its first active phase (where current schedule phase has remaining mins)
      const projectPhases = await this.prisma.currentPhaseSchedule.findMany({
        where: { projectId: { in: projects.map(p => p.id) } },
        include: { phase: true },
      });

      for (const p of projects) {
        // Find the active phase with dates
        const pScheds = projectPhases.filter(ps => ps.projectId === p.id);
        // Find first phase that has start/end date and is not completed
        // For simplicity, we can look at the active phase based on status
        let activeName = 'Gestão de Projetos';
        if (p.status === 2) activeName = 'Gestão de Projetos';
        else if (p.status === 4) activeName = 'Arquitetura';
        else if (p.status === 5) activeName = 'Design';
        else if (p.status === 6) activeName = 'Homologação';
        
        if (columns[activeName] !== undefined) {
          columns[activeName].push(formatProject(p));
        }
      }

      return columns;
    }

    // Default: by status
    const columns = {
      0: [] as any[], // Análise Diretoria
      1: [] as any[], // Ideia Registrada
      2: [] as any[], // Agendar Reunião
      4: [] as any[], // Análise TAP
      5: [] as any[], // Processo de Software
      6: [] as any[], // Homologação
      7: [] as any[], // Concluído
      8: [] as any[], // Devolvido para o solicitante
      9: [] as any[], // Cancelado
    };

    for (const p of projects) {
      const st = p.status as keyof typeof columns;
      if (columns[st] !== undefined) {
        columns[st].push(formatProject(p));
      }
    }

    return columns;
  }
}
