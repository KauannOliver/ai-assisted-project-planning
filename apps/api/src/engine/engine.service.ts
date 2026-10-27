import { effortConsistencyError } from '../projects/project-effort';
import { Injectable, BadRequestException, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogType, UnavailabilityType, UserStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { formatCivilDatePtBr } from '../imports-exports/import-export.utils';

export interface EngineProject {
  id: string;
  sdNumber: string;
  title: string;
  requester: string;
  totalHours: number;
  status: number;
  isLegalRequirement: boolean;
  businessPriorityCode: string;
  committeeDecision: string | null;
  committeeScore: number;
  openingDate: Date;
  requestedDeadline: Date | null;
  phases: {
    id: string;
    phaseId: string;
    phaseCode?: string;
    name: string;
    percentage: number;
    order: number;
    totalMinutes: number;
    executionMode: 'SIMULTANEOUS' | 'SEQUENTIAL';
    status?: string;
    completedMinutes?: number;
    allocations: {
      id: string;
      resourceId: string;
      minutesAllocated: number;
      order: number;
    }[];
  }[];
}

export interface EngineResource {
  id: string;
  name: string;
  weeklyHours: number;
  overheadPercentage: number;
  developmentPercentage: number;
  recommendedWipLimit: number;
  unavailabilities: {
    type: UnavailabilityType;
    annualRecurrence?: boolean;
    startDate: Date;
    endDate: Date;
    unavailableMinutesPerDay: number | null;
  }[];
}

export interface EngineHoliday {
  unavailableMinutesPerDay?: number | null;
  startDate: Date;
  endDate: Date;
  annualRecurrence: boolean;
}

export interface EffectivePriorityQueue {
  mode: 'automatic' | 'manual';
  manualOrder: string[];
  projects: EngineProject[];
}

@Injectable()
export class EngineService implements OnApplicationBootstrap {
  static readonly ENGINE_VERSION = '2.2.0';

  constructor(private prisma: PrismaService) {}

  private currentCivilDateSaoPaulo() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)));
  }

  async onApplicationBootstrap() {
    const currentScheduleCount = await this.prisma.currentProjectSchedule.count();
    if (currentScheduleCount > 0) {
      console.log('Existing official schedule preserved during application startup.');
      return;
    }

    console.log('Bootstrapping official projects schedule calculation...');
    try {
      await this.prisma.$transaction(async (tx) => {
        const sim = await this.runProposedSimulation(tx, {});
        await this.persistSchedule(tx, sim.simulation);
      });
      console.log('Official projects schedule bootstrapped successfully.');
    } catch (err) {
      console.error('Failed to bootstrap official schedule:', err);
    }
  }

  // Generate a concurrency hash to verify the DB state didn't change since preview
  async getDatabaseStateHash(client: any = this.prisma): Promise<string> {
    const [projects, resources, unavailabilities, phases, allocations, parameters, queue, evaluations] = await Promise.all([
      client.project.findMany({ select: { id: true, updatedAt: true, status: true, committeeDecision: true, committeeScore: true } }),
      client.resource.findMany({ select: { id: true, updatedAt: true, status: true } }),
      client.resourceUnavailability.findMany({ select: { id: true, updatedAt: true, status: true } }),
      client.projectPhase.findMany({ select: { id: true, updatedAt: true, status: true, completedMinutes: true, totalMinutes: true, executionMode: true } }),
      client.projectPhaseAllocation.findMany({ select: { id: true, updatedAt: true, resourceId: true, minutesAllocated: true, order: true } }),
      client.globalParameter.findMany({ select: { key: true, value: true, updatedAt: true } }),
      client.priorityQueueState.findUnique({ where: { id: 'singleton' } }),
      client.committeeMeetingEvaluation.findMany({ select: { id: true, createdAt: true, decision: true, score: true } }),
    ]);
    for (const rows of [projects,resources,unavailabilities,phases,allocations,parameters,evaluations]) (rows as any[]).sort((a,b)=>String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)));
    const hashStr = JSON.stringify({ engineVersion:EngineService.ENGINE_VERSION,projects,resources,unavailabilities,phases,allocations,parameters,queue,evaluations });
    return crypto.createHash('md5').update(hashStr).digest('hex');
  }

  // Pure logic: Check if a date is a weekend (Saturday/Sunday)
  isWeekend(date: Date): boolean {
    const day = date.getUTCDay();
    return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
  }

  isWorkingDay(date: Date, workingDays: number[] = [1, 2, 3, 4, 5]): boolean {
    return workingDays.includes(date.getUTCDay());
  }

  // Pure logic: Check if a date is a global holiday
  isGlobalHoliday(date: Date, holidays: EngineHoliday[]): boolean {
    return this.isCalendarEventActive(date, holidays.filter(h => h.unavailableMinutesPerDay == null));
  }

  private isCalendarEventActive(date: Date, holidays: { startDate: Date; endDate: Date; annualRecurrence?: boolean }[]): boolean {
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();

    const currentUTC = Date.UTC(year, month, day);

    return holidays.some(h => {
      const start = new Date(h.startDate);
      const end = new Date(h.endDate);

      if (h.annualRecurrence) {
        const startMonth = start.getUTCMonth();
        const startDay = start.getUTCDate();
        const endMonth = end.getUTCMonth();
        const endDay = end.getUTCDate();

        if (startMonth === endMonth && startDay === endDay) {
          return month === startMonth && day === startDay;
        }

        const currentVal = month * 100 + day;
        const startVal = startMonth * 100 + startDay;
        const endVal = endMonth * 100 + endDay;
        return endVal >= startVal
          ? currentVal >= startVal && currentVal <= endVal
          : currentVal >= startVal || currentVal <= endVal;
      } else {
        const rangeStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        const rangeEnd = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
        return currentUTC >= rangeStart && currentUTC <= rangeEnd;
      }
    });
  }

  // Pure logic: Calculate base daily capacity in minutes
  calculateBaseDailyCapacity(
    res: { weeklyHours: number; overheadPercentage: number; developmentPercentage: number },
    workingDayCount = 5,
  ): number {
    return EngineService.calculateBaseDailyCapacity(res, workingDayCount);
  }

  static calculateBaseDailyCapacity(
    res: { weeklyHours: number; overheadPercentage: number; developmentPercentage: number },
    workingDayCount = 5,
  ) {
    const divisor = Math.max(1, workingDayCount);
    const baseHoursPerDay = (res.weeklyHours * (1 - res.overheadPercentage) * res.developmentPercentage) / divisor;
    return Math.max(0, Math.round(baseHoursPerDay * 60));
  }

  // Pure logic: Get remaining capacity in minutes for a resource on date D
  getResourceCapacityOnDate(
    date: Date,
    res: EngineResource,
    holidays: EngineHoliday[],
    capacityMap: Map<string, number>,
    options: { workingDays?: number[]; ignoreIndividualUnavailability?: boolean } = {},
  ): number {
    const workingDays = options.workingDays?.length ? options.workingDays : [1, 2, 3, 4, 5];
    const dateStr = date.toISOString().split('T')[0];
    const mapKey = `${res.id}_${dateStr}`;

    if (capacityMap.has(mapKey)) {
      return capacityMap.get(mapKey)!;
    }

    // Respect the configured productive weekdays and global holidays.
    if (!this.isWorkingDay(date, workingDays) || this.isGlobalHoliday(date, holidays)) {
      capacityMap.set(mapKey, 0);
      return 0;
    }

    let dailyCapacity = this.calculateBaseDailyCapacity(res, workingDays.length);
    for (const event of holidays) if (event.unavailableMinutesPerDay != null && this.isCalendarEventActive(date, [event])) dailyCapacity -= event.unavailableMinutesPerDay;
    dailyCapacity = Math.max(0, dailyCapacity);

    if (options.ignoreIndividualUnavailability) {
      capacityMap.set(mapKey, dailyCapacity);
      return dailyCapacity;
    }

    // Apply individual unavailabilities
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const currentUTC = Date.UTC(year, month, day);

    for (const un of res.unavailabilities) {
      const uStart = new Date(un.startDate);
      const uEnd = new Date(un.endDate);

      const rangeStart = Date.UTC(uStart.getUTCFullYear(), uStart.getUTCMonth(), uStart.getUTCDate());
      const rangeEnd = Date.UTC(uEnd.getUTCFullYear(), uEnd.getUTCMonth(), uEnd.getUTCDate());

      if (this.isCalendarEventActive(date, [un])) {
        if (un.unavailableMinutesPerDay === null) {
          // Full day off (vacation, etc)
          dailyCapacity = 0;
          break;
        } else {
          dailyCapacity -= un.unavailableMinutesPerDay;
        }
      }
    }

    dailyCapacity = Math.max(0, dailyCapacity);
    capacityMap.set(mapKey, dailyCapacity);
    return dailyCapacity;
  }

  // Fetch input parameters from database
  async fetchEngineInput(tx: any): Promise<{
    projects: EngineProject[];
    resources: EngineResource[];
    holidays: EngineHoliday[];
    eligibilityMode: string;
    wipDefaultLimit: number;
    startCalcDate: Date;
    wipMode: 'soft' | 'hard';
    maxScheduleDays: number;
    riskToleranceDays: number;
    workingDays: number[];
    holidayBehavior: 'skip' | 'include';
  }> {
    // 1. Get global parameters
    const paramEligibility = await tx.globalParameter.findUnique({ where: { key: 'eligibility_mode' } });
    const paramWip = await tx.globalParameter.findUnique({ where: { key: 'engine_wip_limit' } });
    const paramStartDate = await tx.globalParameter.findUnique({ where: { key: 'engine_start_date_mode' } });
    const paramWipMode = await tx.globalParameter.findUnique({ where: { key: 'engine_wip_mode' } });
    const paramMaxDays = await tx.globalParameter.findUnique({ where: { key: 'engine_max_schedule_days' } });
    const paramRiskDays = await tx.globalParameter.findUnique({ where: { key: 'engine_delay_risk_tolerance_days' } });
    const paramWorkingDays = await tx.globalParameter.findUnique({ where: { key: 'engine_working_days' } });
    const paramHolidayBehavior = await tx.globalParameter.findUnique({ where: { key: 'engine_holiday_behavior' } });

    const eligibilityMode = paramEligibility?.value || 'all_eligible';
    const wipDefaultLimit = parseInt(paramWip?.value || '3');
    const wipMode = paramWipMode?.value === 'hard' ? 'hard' : 'soft';
    const maxScheduleDays = Math.max(365, parseInt(paramMaxDays?.value || '3650'));
    const riskToleranceDays = Math.max(0, parseInt(paramRiskDays?.value || '3'));
    const weekdayCodes: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    let workingDays = [1, 2, 3, 4, 5];
    try {
      const parsed = JSON.parse(paramWorkingDays?.value || '[]');
      const configured = Array.isArray(parsed)
        ? parsed.map(code => weekdayCodes[String(code).toLowerCase()]).filter(day => day !== undefined)
        : [];
      if (configured.length > 0) workingDays = Array.from(new Set(configured));
    } catch {
      workingDays = [1, 2, 3, 4, 5];
    }

    let startCalcDate = this.currentCivilDateSaoPaulo();
    if (paramStartDate?.value && paramStartDate.value !== 'current_date') {
      startCalcDate = new Date(paramStartDate.value);
    }
    // Set to midnight UTC
    startCalcDate = new Date(Date.UTC(startCalcDate.getUTCFullYear(), startCalcDate.getUTCMonth(), startCalcDate.getUTCDate()));

    // 2. Fetch active resources and their unavailabilities
    const dbResources = await tx.resource.findMany({
      where: { status: UserStatus.ACTIVE },
      include: {
        unavailabilities: {
          where: { status: UserStatus.ACTIVE, global: false },
        },
      },
    });

    const resources: EngineResource[] = dbResources.map(r => ({
      id: r.id,
      name: r.name,
      weeklyHours: r.weeklyHours,
      overheadPercentage: r.overheadPercentage,
      developmentPercentage: r.developmentPercentage,
      recommendedWipLimit: r.recommendedWipLimit,
      unavailabilities: r.unavailabilities.map(un => ({
        type: un.type,
        annualRecurrence: un.annualRecurrence,
        startDate: un.startDate,
        endDate: un.endDate,
        unavailableMinutesPerDay: un.unavailableMinutesPerDay,
      })),
    }));

    // 3. Fetch global holidays
    // Always load global calendar events. Whether they reduce capacity is a
    // scenario parameter and may differ between baseline and impact preview.
    const dbHolidays = await tx.resourceUnavailability.findMany({
      where: { status: UserStatus.ACTIVE, global: true },
    });
    const holidays: EngineHoliday[] = dbHolidays.map(h => ({
      startDate: h.startDate,
      endDate: h.endDate,
      annualRecurrence: h.annualRecurrence,
      unavailableMinutesPerDay: h.unavailableMinutesPerDay,
    }));

    // 4. Fetch projects (excluding status 7, 8, 9)
    const dbProjects = await tx.project.findMany({
      where: {
        status: { notIn: [7, 8, 9] },
      },
      include: {
        businessPriority: true,
        phases: {
          orderBy: { order: 'asc' },
          include: {
            phaseCatalog: { select: { code: true } },
            allocations: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    const projects: EngineProject[] = dbProjects.map(p => ({
      id: p.id,
      sdNumber: p.sdNumber,
      title: p.title,
      requester: p.requester,
      totalHours: p.totalHours,
      status: p.status,
      isLegalRequirement: p.isLegalRequirement,
      businessPriorityCode: p.businessPriority.code,
      committeeDecision: p.committeeDecision,
      committeeScore: p.committeeScore || 0,
      openingDate: p.openingDate,
      requestedDeadline: p.requestedDeadline,
      phases: p.phases.map(ph => ({
        id: ph.id,
        phaseId: ph.phaseId,
        phaseCode: ph.phaseCatalog.code,
        name: ph.name,
        percentage: ph.percentage,
        order: ph.order,
        totalMinutes: ph.totalMinutes,
        executionMode: ph.executionMode as any,
        status: ph.status,
        completedMinutes: ph.completedMinutes,
        allocations: ph.allocations.map(al => ({
          id: al.id,
          resourceId: al.resourceId,
          minutesAllocated: al.minutesAllocated,
          order: al.order,
        })),
      })),
    }));

    return {
      projects,
      resources,
      holidays,
      eligibilityMode,
      wipDefaultLimit,
      startCalcDate,
      wipMode,
      maxScheduleDays,
      riskToleranceDays,
      workingDays,
      holidayBehavior: paramHolidayBehavior?.value === 'include' ? 'include' : 'skip',
    };
  }

  // Calculate project list order based on priority rules
  async sortFilaAutomatic(projects: EngineProject[]): Promise<EngineProject[]> {
    // Decision order value: PRIORIZADO (1), SEGUNDA_FASE (2), NAO_AVALIADO or null (3)
    const getDecisionOrder = (decision: string | null) => {
      if (decision === 'PRIORIZADO') return 1;
      if (decision === 'SEGUNDA_FASE') return 2;
      return 3;
    };

    // Status order value: Homologação 6 (1), Processo Software 5 (2), TAP 4 (3), Agendar Reunião 2 (4), Ideia Registrada 1 (5), Análise Diretoria 0 (6)
    const getStatusOrder = (st: number) => {
      if (st === 6) return 1;
      if (st === 5) return 2;
      if (st === 4) return 3;
      if (st === 2) return 4;
      if (st === 1) return 5;
      if (st === 0) return 6;
      return 7;
    };

    // Priority order value: Alta (1), Média (2), Baixa (3)
    const getPriorityOrder = (code: string) => {
      if (code === 'alta') return 1;
      if (code === 'media') return 2;
      return 3;
    };

    return [...projects].sort((a, b) => {
      // Rule 1: Legal Requirement (precedência absoluta)
      if (a.isLegalRequirement && !b.isLegalRequirement) return -1;
      if (!a.isLegalRequirement && b.isLegalRequirement) return 1;
      if (a.isLegalRequirement && b.isLegalRequirement) {
        // Tiebreaker for legal requirements: advanced status first, then older opening date
        const statusDiff = getStatusOrder(a.status) - getStatusOrder(b.status);
        if (statusDiff !== 0) return statusDiff;
        return a.openingDate.getTime() - b.openingDate.getTime();
      }

      // Rule 2: Committee Decision Group
      const decDiff = getDecisionOrder(a.committeeDecision) - getDecisionOrder(b.committeeDecision);
      if (decDiff !== 0) return decDiff;

      // Rule 3: Status
      const statusDiff = getStatusOrder(a.status) - getStatusOrder(b.status);
      if (statusDiff !== 0) return statusDiff;

      // Rule 4: Director Score (higher first, empty/null treated as 0)
      const scoreDiff = b.committeeScore - a.committeeScore;
      if (scoreDiff !== 0) return scoreDiff;

      // Rule 5: Business Priority
      const priorityDiff = getPriorityOrder(a.businessPriorityCode) - getPriorityOrder(b.businessPriorityCode);
      if (priorityDiff !== 0) return priorityDiff;

      // Rule 6: Opening Date (oldest first), then stable business/technical keys.
      const openingDiff = a.openingDate.getTime() - b.openingDate.getTime();
      if (openingDiff !== 0) return openingDiff;
      const sdDiff = a.sdNumber.localeCompare(b.sdNumber, 'pt-BR', { numeric: true });
      return sdDiff !== 0 ? sdDiff : a.id.localeCompare(b.id);
    });
  }

  normalizeManualOrder(order: string[], validIds?: Set<string>) {
    const seen = new Set<string>();
    return order.filter(id => {
      if (typeof id !== 'string' || seen.has(id) || (validIds && !validIds.has(id))) return false;
      seen.add(id);
      return true;
    });
  }

  composeManualQueue(projects: EngineProject[], manualOrder: string[], automaticOrder: EngineProject[]) {
    const byId = new Map(projects.map(project => [project.id, project]));
    const normalized = this.normalizeManualOrder(manualOrder, new Set(byId.keys()));
    const listed = new Set(normalized);
    return [
      ...normalized.map(id => byId.get(id)!),
      ...automaticOrder.filter(project => byId.has(project.id) && !listed.has(project.id)),
    ];
  }

  async getEffectivePriorityQueue(client: any = this.prisma): Promise<EffectivePriorityQueue> {
    const state = await client.priorityQueueState.findUnique({
      where: { id: 'singleton' },
    });
    const mode = (state?.mode === 'manual' ? 'manual' : 'automatic') as 'automatic' | 'manual';
    let manualOrder: string[] = [];
    try {
      const parsed = JSON.parse(state?.manualOrder || '[]');
      manualOrder = Array.isArray(parsed) ? this.normalizeManualOrder(parsed) : [];
    } catch {
      manualOrder = [];
    }

    const input = await this.fetchEngineInput(client);
    const sortedAuto = await this.sortFilaAutomatic(input.projects);
    if (mode === 'automatic') {
      return { mode, manualOrder, projects: sortedAuto };
    }

    return {
      mode,
      manualOrder,
      projects: this.composeManualQueue(input.projects, manualOrder, sortedAuto),
    };
  }

  // Core Simulation Math function: Takes parameters and builds the schedule day-by-day in memory
  simulateAllocationSchedule(
    projects: EngineProject[],
    resources: EngineResource[],
    holidays: EngineHoliday[],
    queueMode: 'automatic' | 'manual',
    manualOrderArray: string[],
    sortedAutoQueue: EngineProject[],
    eligibilityMode: string,
    startCalcDate: Date,
    wipMode: 'soft' | 'hard' = 'soft',
    maxScheduleDays = 3650,
    riskToleranceDays = 3,
    workingDays: number[] = [1, 2, 3, 4, 5],
  ) {
    // 1. Filter eligible projects based on decision eligibility
    const eligibleProjects = projects.filter(p => {
      if ([7, 8, 9].includes(p.status)) return false;
      if (eligibilityMode === 'only_prioritized') {
        return p.committeeDecision === 'PRIORIZADO';
      }
      if (eligibilityMode === 'prioritized_and_second_phase') {
        return p.committeeDecision === 'PRIORIZADO' || p.committeeDecision === 'SEGUNDA_FASE';
      }
      // all_eligible includes prior, second, and null/NAO_AVALIADO
      return true;
    });

    // 2. Build final queue
    const globalQueue = queueMode === 'manual'
      ? this.composeManualQueue(projects, manualOrderArray, sortedAutoQueue)
      : sortedAutoQueue;
    const eligibleIds = new Set(eligibleProjects.map(project => project.id));
    const finalQueue = globalQueue.filter(project => eligibleIds.has(project.id));
    const globalPositions = new Map(globalQueue.map((project, index) => [project.id, index + 1]));

    // 3. Track the physical minutes already consumed by each resource/day.
    // Project management has special availability rules, but still shares the
    // same real daily ceiling with every other phase.
    const usedCapacityMap = new Map<string, number>();

    // 4. Outputs
    const projectSchedules: {
      projectId: string;
      queuePosition: number;
      startDate: Date | null;
      endDate: Date | null;
      status: 'ON_TIME' | 'AT_RISK' | 'DELAYED';
      isImpeded: boolean;
      impediments: string | null;
    }[] = [];

    const phaseSchedules: {
      projectId: string;
      projectPhaseId: string;
      phaseName: string;
      isManagement: boolean;
      startDate: Date | null;
      endDate: Date | null;
    }[] = [];

    const allocations: {
      projectId: string;
      projectPhaseId: string;
      allocationId: string;
      resourceId: string;
      date: Date;
      minutesAllocated: number;
    }[] = [];

    const warnings: {
      type: string;
      message: string;
      projectId?: string;
      resourceId?: string;
      date?: Date;
    }[] = [];

    // Daily occupancy count to detect WIP violations
    // Map key: YYYY-MM-DD -> Map<resourceId, Set<projectId>>
    const dailyWipTracker = new Map<string, Map<string, Set<string>>>();
    const regularCapacityMap = new Map<string, number>();

    // Helper: Advance date by 1 day
    const addDays = (d: Date, days: number): Date => {
      const res = new Date(d);
      res.setUTCDate(res.getUTCDate() + days);
      return res;
    };
    const scheduleHorizonEnd = addDays(startCalcDate, maxScheduleDays);

    const normalizedPhaseName = (phase: EngineProject['phases'][number]) =>
      phase.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

    const normalizedPhaseCode = (phase: EngineProject['phases'][number]) =>
      phase.phaseCode?.trim().toLowerCase() || (() => {
        const fallback = normalizedPhaseName(phase).replace(/[^a-z0-9]+/g, '_');
        return fallback === 'gestao_de_projetos' ? 'gestao_projetos' : fallback;
      })();

    const isManagementPhase = (phase: EngineProject['phases'][number]) =>
      normalizedPhaseCode(phase) === 'gestao_projetos';

    const missingPhaseMappings = new Set<string>();

    // The overall project status is the single source of truth for remaining
    // work. Legacy phase progress columns are intentionally ignored.
    const getPhaseRemainingMinutes = (project: EngineProject, phase: EngineProject['phases'][number]) => {
      if (project.status === 0 || project.status === 1) return phase.totalMinutes;
      if (project.status === 2) return Math.round(phase.totalMinutes * (isManagementPhase(phase) ? 0.5 : 1));

      const thresholdCode = project.status === 4
        ? 'arquitetura'
        : project.status === 5
          ? 'design'
          : project.status === 6
            ? 'homologacao'
            : null;
      if (!thresholdCode) return 0;

      const threshold = project.phases.find(item => normalizedPhaseCode(item) === thresholdCode);
      if (threshold) return phase.order >= threshold.order ? phase.totalMinutes : 0;
      missingPhaseMappings.add(project.id);
      const phaseRank: Record<string, number> = {
        gestao_projetos: 0,
        levantamento: 1,
        arquitetura: 2,
        design: 3,
        desenvolvimento: 4,
        qualidade: 5,
        entrega_aplicacao: 6,
        homologacao: 7,
        golive: 8,
      };
      const normalized = normalizedPhaseCode(phase);
      // Without a stable threshold mapping, retain work conservatively.
      if (phaseRank[normalized] === undefined) return phase.totalMinutes;
      return phaseRank[normalized] >= phaseRank[thresholdCode] ? phase.totalMinutes : 0;
    };

    const distributePhaseWork = (phase: EngineProject['phases'][number], totalMinutes: number) => {
      const work = new Map<string, number>();
      const positiveWeights = phase.allocations.map(allocation => Math.max(0, allocation.minutesAllocated));
      const weightTotal = positiveWeights.reduce((sum, minutes) => sum + minutes, 0);
      let distributed = 0;
      phase.allocations.forEach((allocation, index) => {
        const minutes = weightTotal > 0
          ? Math.floor((positiveWeights[index] / weightTotal) * totalMinutes)
          : Math.floor(totalMinutes / Math.max(1, phase.allocations.length));
        work.set(allocation.id, minutes);
        distributed += minutes;
      });
      let residue = totalMinutes - distributed;
      for (const allocation of phase.allocations) {
        if (residue <= 0) break;
        work.set(allocation.id, (work.get(allocation.id) || 0) + 1);
        residue--;
      }
      return work;
    };

    const nextProductiveDay = (date: Date) => {
      let next = addDays(date, 1);
      while (!this.isWorkingDay(next, workingDays) || this.isGlobalHoliday(next, holidays)) {
        next = addDays(next, 1);
      }
      return next;
    };

    const getSchedulableCapacity = (date: Date, resource: EngineResource, projectId: string, managementPhase = false) => {
      const dateKey = date.toISOString().split('T')[0];
      const mapKey = `${resource.id}_${dateKey}`;
      const dailyCeiling = this.getResourceCapacityOnDate(
        date,
        resource,
        holidays,
        regularCapacityMap,
        {
        workingDays,
        ignoreIndividualUnavailability: false,
        },
      );
      const capacity = Math.max(0, dailyCeiling - (usedCapacityMap.get(mapKey) || 0));
      if (managementPhase) return capacity;
      if (wipMode !== 'hard') return capacity;
      const activeProjects = dailyWipTracker.get(dateKey)?.get(resource.id);
      if (activeProjects && !activeProjects.has(projectId) && activeProjects.size >= resource.recommendedWipLimit) return 0;
      return capacity;
    };

    const managementWorkItems: {
      project: EngineProject;
      phase: EngineProject['phases'][number];
      remainingMinutes: number;
      releaseDate: Date;
    }[] = [];

    // 5. Run day-by-day scheduler
    for (let projectIndex = 0; projectIndex < finalQueue.length; projectIndex++) {
      const proj = finalQueue[projectIndex];
      const integrityError = effortConsistencyError(proj);
      if (integrityError) {
        warnings.push({type: 'PROJECT_EFFORT_INCONSISTENT', message: integrityError, projectId: proj.id});
        projectSchedules.push({projectId:proj.id,queuePosition:globalPositions.get(proj.id) ?? projectIndex+1,startDate:null,endDate:null,status:'DELAYED',isImpeded:true,impediments:integrityError});
        for (const phase of proj.phases) phaseSchedules.push({projectId:proj.id,projectPhaseId:phase.id,phaseName:phase.name,isManagement:isManagementPhase(phase),startDate:null,endDate:null});
        continue;
      }
      let currentPhaseStartDate = new Date(Math.max(proj.openingDate.getTime(), startCalcDate.getTime()));
      // Normalize to midnight UTC
      currentPhaseStartDate = new Date(Date.UTC(currentPhaseStartDate.getUTCFullYear(), currentPhaseStartDate.getUTCMonth(), currentPhaseStartDate.getUTCDate()));

      let isProjectImpeded = false;
      const projectImpediments: string[] = [];
      let projectActualStartDate: Date | null = null;
      let projectActualEndDate: Date | null = null;

      // Sort phases by order
      const sortedPhases = [...proj.phases].sort((a, b) => a.order - b.order);

      for (const ph of sortedPhases) {
        const managementPhase = isManagementPhase(ph);
        const remainingMinutes = getPhaseRemainingMinutes(proj, ph);

        if (remainingMinutes === 0) {
          phaseSchedules.push({
            projectId: proj.id,
            projectPhaseId: ph.id,
            phaseName: ph.name,
            isManagement: managementPhase,
            startDate: null,
            endDate: null,
          });
          continue;
        }

        // Project management is scheduled after all delivery work. It consumes
        // only remaining physical capacity and therefore never moves delivery
        // dates or blocks the project forecast.
        if (managementPhase) {
          managementWorkItems.push({
            project: proj,
            phase: ph,
            remainingMinutes,
            releaseDate: new Date(Math.max(proj.openingDate.getTime(), startCalcDate.getTime())),
          });
          continue;
        }

        // Remaining phases require valid active resources.
        const missingResources = ph.allocations.filter(a => !resources.some(r => r.id === a.resourceId));
        if (ph.allocations.length === 0 || missingResources.length > 0) {
          isProjectImpeded = true;
          projectImpediments.push(
            ph.allocations.length === 0
              ? `Fase sem recurso: ${ph.name}`
              : `Fase com recurso inativo ou inexistente: ${ph.name}`,
          );
          warnings.push({
            type: 'PHASE_NO_RESOURCE',
            message: `A fase ${ph.name} do projeto ${proj.sdNumber} não possui recursos alocados. Previsão de entrega suspensa.`,
            projectId: proj.id,
          });

          phaseSchedules.push({
            projectId: proj.id,
            projectPhaseId: ph.id,
            phaseName: ph.name,
            isManagement: false,
            startDate: null,
            endDate: null,
          });
          continue;
        }

        if (isProjectImpeded) {
          // Project already blocked, subsequent phases cannot be calculated
          phaseSchedules.push({
            projectId: proj.id,
            projectPhaseId: ph.id,
            phaseName: ph.name,
            isManagement: false,
            startDate: null,
            endDate: null,
          });
          continue;
        }

        // Distribute only the unfinished portion across the phase allocations,
        // preserving their original proportion and the exact remaining total.
        const allocationWork = distributePhaseWork(ph, remainingMinutes);

        // We need to schedule the phase resources based on execution mode
        let phaseEndDate = new Date(currentPhaseStartDate);
        let phaseActualStartDate: Date | null = null;

        if (ph.executionMode === 'SIMULTANEOUS') {
          // All start on currentPhaseStartDate concurrently
          for (const alloc of ph.allocations) {
            const res = resources.find(r => r.id === alloc.resourceId);
            if (!res) continue;

            let remainingWork = allocationWork.get(alloc.id) || 0;
            let currentDay = new Date(currentPhaseStartDate);

            while (remainingWork > 0 && currentDay.getTime() <= scheduleHorizonEnd.getTime()) {
              const cap = getSchedulableCapacity(currentDay, res, proj.id, managementPhase);

              if (cap > 0) {
                const allocatedMins = Math.min(remainingWork, cap);
                remainingWork -= allocatedMins;

                // Consume the shared physical capacity for this resource/day.
                const dateStr = currentDay.toISOString().split('T')[0];
                const mapKey = `${res.id}_${dateStr}`;
                usedCapacityMap.set(mapKey, (usedCapacityMap.get(mapKey) || 0) + allocatedMins);

                // Record allocation
                allocations.push({
                  projectId: proj.id,
                  projectPhaseId: ph.id,
                  allocationId: alloc.id,
                  resourceId: res.id,
                  date: new Date(currentDay),
                  minutesAllocated: allocatedMins,
                });

                if (phaseActualStartDate === null || currentDay.getTime() < phaseActualStartDate.getTime()) {
                  phaseActualStartDate = new Date(currentDay);
                }

                // Management leadership does not participate in WIP limits.
                if (!managementPhase) {
                  if (!dailyWipTracker.has(dateStr)) dailyWipTracker.set(dateStr, new Map());
                  const dayTracker = dailyWipTracker.get(dateStr)!;
                  if (!dayTracker.has(res.id)) dayTracker.set(res.id, new Set());
                  dayTracker.get(res.id)!.add(proj.id);
                }
              }

              if (remainingWork > 0) {
                currentDay = addDays(currentDay, 1);
              }
            }

            if (remainingWork > 0) {
              isProjectImpeded = true;
              projectImpediments.push(`Capacidade indisponível para ${res.name} na fase ${ph.name}`);
              warnings.push({
                type: 'SCHEDULE_HORIZON_EXCEEDED',
                message: `Não foi possível alocar ${ph.name} de ${proj.sdNumber} dentro do horizonte de ${maxScheduleDays} dias.`,
                projectId: proj.id,
                resourceId: res.id,
              });
              break;
            }

            if (currentDay.getTime() > phaseEndDate.getTime()) {
              phaseEndDate = new Date(currentDay);
            }
          }
        } else {
          // SEQUENTIAL: Resources execute one after another in allocation order
          let sequentialStart = new Date(currentPhaseStartDate);

          for (const alloc of ph.allocations) {
            const res = resources.find(r => r.id === alloc.resourceId);
            if (!res) continue;

            let remainingWork = allocationWork.get(alloc.id) || 0;
            const allocationHadWork = remainingWork > 0;
            if (!allocationHadWork) continue;
            let currentDay = new Date(sequentialStart);

            while (remainingWork > 0 && currentDay.getTime() <= scheduleHorizonEnd.getTime()) {
              const cap = getSchedulableCapacity(currentDay, res, proj.id, managementPhase);

              if (cap > 0) {
                const allocatedMins = Math.min(remainingWork, cap);
                remainingWork -= allocatedMins;

                // Consume the shared physical capacity for this resource/day.
                const dateStr = currentDay.toISOString().split('T')[0];
                const mapKey = `${res.id}_${dateStr}`;
                usedCapacityMap.set(mapKey, (usedCapacityMap.get(mapKey) || 0) + allocatedMins);

                // Record allocation
                allocations.push({
                  projectId: proj.id,
                  projectPhaseId: ph.id,
                  allocationId: alloc.id,
                  resourceId: res.id,
                  date: new Date(currentDay),
                  minutesAllocated: allocatedMins,
                });

                if (phaseActualStartDate === null || currentDay.getTime() < phaseActualStartDate.getTime()) {
                  phaseActualStartDate = new Date(currentDay);
                }

                // Management leadership does not participate in WIP limits.
                if (!managementPhase) {
                  if (!dailyWipTracker.has(dateStr)) dailyWipTracker.set(dateStr, new Map());
                  const dayTracker = dailyWipTracker.get(dateStr)!;
                  if (!dayTracker.has(res.id)) dayTracker.set(res.id, new Set());
                  dayTracker.get(res.id)!.add(proj.id);
                }
              }

              if (remainingWork > 0) {
                currentDay = addDays(currentDay, 1);
              }
            }

            if (remainingWork > 0) {
              isProjectImpeded = true;
              projectImpediments.push(`Capacidade indisponível para ${res.name} na fase ${ph.name}`);
              warnings.push({
                type: 'SCHEDULE_HORIZON_EXCEEDED',
                message: `Não foi possível alocar ${ph.name} de ${proj.sdNumber} dentro do horizonte de ${maxScheduleDays} dias.`,
                projectId: proj.id,
                resourceId: res.id,
              });
              break;
            }

            // The engine has daily granularity, so a dependency completed on a
            // date releases the next resource only on the next productive day.
            if (allocationHadWork) sequentialStart = nextProductiveDay(currentDay);
            if (currentDay.getTime() > phaseEndDate.getTime()) {
              phaseEndDate = new Date(currentDay);
            }
          }
        }

        if (isProjectImpeded) {
          phaseSchedules.push({
            projectId: proj.id,
            projectPhaseId: ph.id,
            phaseName: ph.name,
            isManagement: false,
            startDate: phaseActualStartDate,
            endDate: null,
          });
          continue;
        }

        // Record completed phase schedules
        phaseSchedules.push({
          projectId: proj.id,
          projectPhaseId: ph.id,
          phaseName: ph.name,
          isManagement: false,
          startDate: phaseActualStartDate,
          endDate: new Date(phaseEndDate),
        });

        if (phaseActualStartDate && (projectActualStartDate === null || phaseActualStartDate.getTime() < projectActualStartDate.getTime())) {
          projectActualStartDate = new Date(phaseActualStartDate);
        }
        if (projectActualEndDate === null || phaseEndDate.getTime() > projectActualEndDate.getTime()) {
          projectActualEndDate = new Date(phaseEndDate);
        }

        currentPhaseStartDate = nextProductiveDay(phaseEndDate);
      }

      // 6. Define project overall dates and delay risk status
      if (isProjectImpeded) {
        projectSchedules.push({
          projectId: proj.id,
          queuePosition: globalPositions.get(proj.id) ?? projectIndex + 1,
          startDate: null,
          endDate: null,
          status: 'DELAYED',
          isImpeded: true,
          impediments: projectImpediments.join(', '),
        });
      } else {
        let statusRisk: 'ON_TIME' | 'AT_RISK' | 'DELAYED' = 'ON_TIME';

        if (proj.requestedDeadline && projectActualEndDate) {
          const deadline = new Date(proj.requestedDeadline);
          const end = new Date(projectActualEndDate);

          if (end.getTime() > deadline.getTime()) {
            statusRisk = 'DELAYED';
          } else {
            // Check risk tolerance margin (e.g. if deadline is within 10% remaining margin)
            // or if it's very close (e.g. end date is less than 3 days before deadline)
            const toleranceDiff = deadline.getTime() - end.getTime();
            const daysLeft = toleranceDiff / (1000 * 60 * 60 * 24);
            if (daysLeft >= 0 && daysLeft <= riskToleranceDays) {
              statusRisk = 'AT_RISK';
            }
          }
        }

        projectSchedules.push({
          projectId: proj.id,
          queuePosition: globalPositions.get(proj.id) ?? projectIndex + 1,
          startDate: projectActualStartDate,
          endDate: projectActualEndDate,
          status: statusRisk,
          isImpeded: false,
          impediments: null,
        });
      }
    }

    for (const projectId of missingPhaseMappings) {
      const project = projects.find(item => item.id === projectId);
      warnings.push({
        type: 'PHASE_CODE_MAPPING_MISSING',
        message: `O projeto ${project?.sdNumber || projectId} não possui a fase de referência esperada para o estágio atual. O esforço foi mantido de forma conservadora.`,
        projectId,
      });
    }

    // 7. Allocate project-management work after every delivery forecast has
    // been fixed. This fills genuine idle capacity without changing project or
    // portfolio completion dates.
    for (const item of managementWorkItems) {
      const { project: proj, phase: ph, remainingMinutes } = item;
      const missingResources = ph.allocations.filter(allocation => !resources.some(resource => resource.id === allocation.resourceId));
      if (ph.allocations.length === 0 || missingResources.length > 0) {
        phaseSchedules.push({
          projectId: proj.id,
          projectPhaseId: ph.id,
          phaseName: ph.name,
          isManagement: true,
          startDate: null,
          endDate: null,
        });
        warnings.push({
          type: 'MANAGEMENT_PHASE_NO_RESOURCE',
          message: `A fase ${ph.name} do projeto ${proj.sdNumber} não possui recurso ativo. A previsão de entrega não foi bloqueada.`,
          projectId: proj.id,
        });
        continue;
      }

      const allocationWork = distributePhaseWork(ph, remainingMinutes);

      const releaseDate = new Date(Date.UTC(
        item.releaseDate.getUTCFullYear(),
        item.releaseDate.getUTCMonth(),
        item.releaseDate.getUTCDate(),
      ));
      let phaseStart: Date | null = null;
      let phaseEnd: Date | null = null;
      let phaseIncomplete = false;
      let sequentialStart = new Date(releaseDate);

      for (const allocation of ph.allocations) {
        const resource = resources.find(candidate => candidate.id === allocation.resourceId)!;
        let remainingWork = allocationWork.get(allocation.id) || 0;
        const allocationHadWork = remainingWork > 0;
        let currentDay = ph.executionMode === 'SEQUENTIAL'
          ? new Date(sequentialStart)
          : new Date(releaseDate);
        while (remainingWork > 0 && currentDay.getTime() <= scheduleHorizonEnd.getTime()) {
          const capacity = getSchedulableCapacity(currentDay, resource, proj.id, true);
          if (capacity > 0) {
            const allocatedMinutes = Math.min(remainingWork, capacity);
            remainingWork -= allocatedMinutes;
            const dateKey = currentDay.toISOString().split('T')[0];
            const capacityKey = `${resource.id}_${dateKey}`;
            usedCapacityMap.set(capacityKey, (usedCapacityMap.get(capacityKey) || 0) + allocatedMinutes);
            allocations.push({
              projectId: proj.id,
              projectPhaseId: ph.id,
              allocationId: allocation.id,
              resourceId: resource.id,
              date: new Date(currentDay),
              minutesAllocated: allocatedMinutes,
            });
            if (!phaseStart || currentDay.getTime() < phaseStart.getTime()) phaseStart = new Date(currentDay);
            if (!phaseEnd || currentDay.getTime() > phaseEnd.getTime()) phaseEnd = new Date(currentDay);
          }
          if (remainingWork > 0) currentDay = addDays(currentDay, 1);
        }

        if (remainingWork > 0) {
          phaseIncomplete = true;
          warnings.push({
            type: 'MANAGEMENT_SCHEDULE_HORIZON_EXCEEDED',
            message: `Parte das horas de Gestão de Projetos de ${proj.sdNumber} ficou fora do horizonte de ${maxScheduleDays} dias, sem bloquear a entrega.`,
            projectId: proj.id,
            resourceId: resource.id,
          });
        }
        if (ph.executionMode === 'SEQUENTIAL' && allocationHadWork && phaseEnd) sequentialStart = nextProductiveDay(phaseEnd);
      }

      phaseSchedules.push({
        projectId: proj.id,
        projectPhaseId: ph.id,
        phaseName: ph.name,
        isManagement: true,
        startDate: phaseStart,
        endDate: phaseIncomplete ? null : phaseEnd,
      });
    }

    // 8. Post-process WIP overload warnings
    dailyWipTracker.forEach((resMap, dateStr) => {
      const date = new Date(dateStr + 'T00:00:00Z');
      resMap.forEach((projSet, resId) => {
        const res = resources.find(r => r.id === resId);
        if (!res) return;

        const activeCount = projSet.size;
        if (activeCount > res.recommendedWipLimit) {
          warnings.push({
            type: 'WIP_OVERLOAD',
            message: `Sobrecarga: O recurso ${res.name} está alocado em ${activeCount} projetos simultâneos no dia ${formatCivilDatePtBr(date)}, superando seu limite sugerido de WIP (${res.recommendedWipLimit}).`,
            resourceId: resId,
            date,
          });
        }
      });
    });

    // 9. Utilization calculations
    const resourceUtilizations: {
      resourceId: string;
      date: Date;
      minutesBusy: number;
      minutesTotal: number;
      utilizationPercentage: number;
    }[] = [];

    const busyByResourceDate = new Map<string, number>();
    allocations.forEach(allocation => {
      const dateStr = allocation.date.toISOString().split('T')[0];
      const key = `${allocation.resourceId}_${dateStr}`;
      busyByResourceDate.set(key, (busyByResourceDate.get(key) || 0) + allocation.minutesAllocated);
    });

    busyByResourceDate.forEach((busy, mapKey) => {
      const [resId, dateStr] = mapKey.split('_');
      const res = resources.find(r => r.id === resId);
      if (!res) return;

      const date = new Date(dateStr + 'T00:00:00Z');
      const regularCapacity = this.getResourceCapacityOnDate(date, res, holidays, regularCapacityMap, { workingDays });
      const totalCap = regularCapacity;

      if (totalCap > 0) {
        resourceUtilizations.push({
          resourceId: resId,
          date,
          minutesBusy: busy,
          minutesTotal: totalCap,
          utilizationPercentage: parseFloat(((busy / totalCap) * 100).toFixed(2)),
        });
      }
    });

    // 10. Portfolio overall end date (delivery phases only)
    const validEnds = projectSchedules
      .map(s => s.endDate)
      .filter((d): d is Date => d !== null);

    const portfolioEndDate = validEnds.length > 0 
      ? new Date(Math.max(...validEnds.map(d => d.getTime())))
      : null;

    return {
      projects: projectSchedules,
      phases: phaseSchedules,
      allocations,
      utilization: resourceUtilizations,
      warnings,
      portfolioEndDate,
      referenceDate: new Date(startCalcDate),
      engineVersion: EngineService.ENGINE_VERSION,
    };
  }

  // Persists the simulated schedule to database in a clean transaction
  async persistSchedule(
    tx: any,
    sim: ReturnType<typeof EngineService.prototype.simulateAllocationSchedule>,
    context: { triggerType?: string; triggeredById?: string; inputHash?: string; parameters?: any } = {},
  ) {
    const inputHash = context.inputHash || crypto.createHash('md5').update(JSON.stringify({
      projects: sim.projects,
      phases: sim.phases,
      allocations: sim.allocations,
    })).digest('hex');
    const run = await tx.scheduleRun.create({
      data: {
        type: 'OFFICIAL',
        status: 'RUNNING',
        triggerType: context.triggerType || 'SYSTEM_RECALCULATION',
        triggeredById: context.triggeredById || null,
        inputHash,
        parameters: context.parameters,
        engineVersion: sim.engineVersion,
        referenceDate: sim.referenceDate,
      },
    });

    // Clear official schedule
    await tx.currentProjectSchedule.deleteMany({});
    await tx.currentPhaseSchedule.deleteMany({});
    await tx.currentResourceAllocation.deleteMany({});
    await tx.currentResourceUtilization.deleteMany({});
    await tx.currentEngineWarning.deleteMany({});

    // Write new schedules
    for (const p of sim.projects) {
      await tx.currentProjectSchedule.create({
        data: {
          projectId: p.projectId,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status,
          isImpeded: p.isImpeded,
          impediments: p.impediments,
          scheduleRunId: run.id,
        },
      });
    }

    for (const ph of sim.phases) {
      await tx.currentPhaseSchedule.create({
        data: {
          projectId: ph.projectId,
          projectPhaseId: ph.projectPhaseId,
          startDate: ph.startDate,
          endDate: ph.endDate,
        },
      });
    }

    if (sim.allocations.length > 0) {
      await tx.currentResourceAllocation.createMany({
        data: sim.allocations.map(al => ({
          projectId: al.projectId,
          projectPhaseId: al.projectPhaseId,
          allocationId: al.allocationId,
          resourceId: al.resourceId,
          date: al.date,
          minutesAllocated: al.minutesAllocated,
        })),
      });
    }

    if (sim.utilization.length > 0) {
      await tx.currentResourceUtilization.createMany({
        data: sim.utilization.map(ut => ({
          resourceId: ut.resourceId,
          date: ut.date,
          minutesBusy: ut.minutesBusy,
          minutesTotal: ut.minutesTotal,
          utilizationPercentage: ut.utilizationPercentage,
        })),
      });
    }

    if (sim.warnings.length > 0) {
      await tx.currentEngineWarning.createMany({
        data: sim.warnings.map(w => ({
          type: w.type,
          message: w.message,
          projectId: w.projectId ?? null,
          resourceId: w.resourceId ?? null,
          date: w.date ?? null,
        })),
      });
    }

    if (sim.projects.length > 0) {
      await tx.scheduleRunProject.createMany({
        data: sim.projects.map(p => ({
          runId: run.id,
          projectId: p.projectId,
          queuePosition: p.queuePosition,
          startDate: p.startDate,
          endDate: p.endDate,
          riskStatus: p.status,
          isImpeded: p.isImpeded,
          impediments: p.impediments,
        })),
      });
    }
    if (sim.phases.length > 0) {
      await tx.scheduleRunPhase.createMany({
        data: sim.phases.map(p => ({
          runId: run.id,
          projectId: p.projectId,
          projectPhaseId: p.projectPhaseId,
          startDate: p.startDate,
          endDate: p.endDate,
        })),
      });
    }
    if (sim.allocations.length > 0) {
      await tx.scheduleRunAllocation.createMany({
        data: sim.allocations.map(a => ({
          runId: run.id,
          projectId: a.projectId,
          projectPhaseId: a.projectPhaseId,
          allocationId: a.allocationId,
          resourceId: a.resourceId,
          date: a.date,
          minutesAllocated: a.minutesAllocated,
        })),
      });
    }

    await tx.scheduleRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        portfolioEndDate: sim.portfolioEndDate,
        warningCount: sim.warnings.length,
        completedAt: new Date(),
      },
    });
    return run;
  }

  // Compare two schedules (proposed vs official) and build impact metrics
  compareSchedules(
    proposedProjects: ReturnType<typeof EngineService.prototype.simulateAllocationSchedule>['projects'],
    officialProjects: { projectId: string; startDate?: Date | null; endDate: Date | null; status: string; isImpeded?: boolean; queuePosition?: number | null }[],
    projectMetadata: { id: string; title: string; sdNumber: string }[],
    scenarioContext?: {
      baseline: ReturnType<typeof EngineService.prototype.simulateAllocationSchedule>;
      proposed: ReturnType<typeof EngineService.prototype.simulateAllocationSchedule>;
      resources: { id: string; name: string }[];
    },
  ) {
    const civilDay = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    const differenceInCivilDays = (after: number, before: number) =>
      Math.round((civilDay(new Date(after)) - civilDay(new Date(before))) / (1000 * 60 * 60 * 24));
    const details: any[] = [];
    let affectedCount = 0;
    let antecipadosCount = 0;
    let postergadosCount = 0;
    let novosAtrasos = 0;
    let atrasosResolvidos = 0;

    const officialEndTimes = officialProjects
      .map(project => project.endDate ? new Date(project.endDate).getTime() : null)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const proposedEndTimes = proposedProjects
      .map(project => project.endDate ? project.endDate.getTime() : null)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const portfolioEndBeforeTime = officialEndTimes.length > 0 ? Math.max(...officialEndTimes) : null;
    const portfolioEndAfterTime = proposedEndTimes.length > 0 ? Math.max(...proposedEndTimes) : null;
    const portfolioDifferenceDays = portfolioEndBeforeTime !== null && portfolioEndAfterTime !== null
      ? differenceInCivilDays(portfolioEndAfterTime, portfolioEndBeforeTime)
      : 0;

    const antecipadosList: any[] = [];
    const postergadosList: any[] = [];

    const proposedById = new Map(proposedProjects.map(project => [project.projectId, project]));
    const officialById = new Map(officialProjects.map(project => [project.projectId, project]));
    const comparedProjectIds = new Set([...proposedById.keys(), ...officialById.keys()]);
    const affectedProjectIds = new Set<string>();

    for (const projectId of comparedProjectIds) {
      const prop = proposedById.get(projectId);
      const off = officialById.get(projectId);
      const meta = projectMetadata.find(m => m.id === projectId);
      if (!meta) continue;

      const propTime = prop?.endDate ? prop.endDate.getTime() : null;
      const offTime = off && off.endDate ? new Date(off.endDate).getTime() : null;
      const propStartTime = prop?.startDate ? prop.startDate.getTime() : null;
      const offStartTime = off?.startDate ? new Date(off.startDate).getTime() : null;
      const positionChanged = prop?.queuePosition != null && off?.queuePosition != null && prop.queuePosition !== off.queuePosition;
      const proposedStatus = prop?.status || 'OUT_OF_SCHEDULE';
      const officialStatus = off?.status || 'OUT_OF_SCHEDULE';

      if (!prop || !off || propTime !== offTime || propStartTime !== offStartTime || positionChanged || officialStatus !== proposedStatus || Boolean(off?.isImpeded) !== Boolean(prop?.isImpeded)) {
        affectedCount++;
        affectedProjectIds.add(projectId);
        let diffDays: number | null = null;

        if (propTime !== null && offTime !== null) {
          diffDays = differenceInCivilDays(propTime, offTime);
        }

        const isAntecipado = diffDays !== null && diffDays < 0;
        const isPostergado = diffDays !== null && diffDays > 0;

        if (isAntecipado) {
          antecipadosCount++;
          antecipadosList.push({
            projectName: `${meta.sdNumber} - ${meta.title}`,
            daysShifted: Math.abs(diffDays!),
            direction: 'ANTICIPATED',
            diffDays,
          });
        } else if (isPostergado) {
          postergadosCount++;
          postergadosList.push({
            projectName: `${meta.sdNumber} - ${meta.title}`,
            daysShifted: diffDays!,
            direction: 'POSTPONED',
            diffDays,
          });
        }

        // Atrasos check
        const wasDelayed = off?.status === 'DELAYED';
        const isDelayed = prop?.status === 'DELAYED';

        if (!wasDelayed && isDelayed) novosAtrasos++;
        if (wasDelayed && !isDelayed) atrasosResolvidos++;

        details.push({
          projectId,
          sdNumber: meta.sdNumber,
          title: meta.title,
          oldDate: offTime ? new Date(offTime).toISOString().split('T')[0] : 'Sem data',
          newDate: propTime ? new Date(propTime).toISOString().split('T')[0] : 'Sem data',
          oldStartDate: offStartTime ? new Date(offStartTime).toISOString().split('T')[0] : 'Sem data',
          newStartDate: propStartTime ? new Date(propStartTime).toISOString().split('T')[0] : 'Sem data',
          oldPosition: off?.queuePosition ?? null,
          newPosition: prop?.queuePosition ?? null,
          positionChanged,
          startDateChanged: propStartTime !== offStartTime,
          endDateChanged: propTime !== offTime,
          riskChanged: officialStatus !== proposedStatus,
          diffDays,
          oldStatus: officialStatus,
          newStatus: proposedStatus,
          changeType: !off
            ? 'NEW_FORECAST'
            : !prop
              ? 'REMOVED_FROM_SCHEDULE'
              : propTime !== offTime
                ? 'DATE_CHANGED'
                : propStartTime !== offStartTime
                  ? 'START_DATE_CHANGED'
                  : positionChanged
                    ? 'POSITION_CHANGED'
                    : 'STATUS_CHANGED',
        });
      }
    }

    // Rule of Eight highlighted projects (4 anticipated and 4 postponed when possible, or 8 largest)
    const sortedAnte = [...antecipadosList].sort((a, b) => b.daysShifted - a.daysShifted);
    const sortedPost = [...postergadosList].sort((a, b) => b.daysShifted - a.daysShifted);

    let highlighted: any[] = [];
    if (sortedAnte.length > 0 && sortedPost.length > 0) {
      highlighted = [...sortedPost.slice(0, 4), ...sortedAnte.slice(0, 4)];
    } else if (sortedPost.length > 0) {
      highlighted = sortedPost.slice(0, 8);
    } else {
      highlighted = sortedAnte.slice(0, 8);
    }

    const findCriticalPath = (simulation?: ReturnType<typeof EngineService.prototype.simulateAllocationSchedule>) => {
      if (!simulation) return null;
      const project = simulation.projects
        .filter(item => item.endDate !== null)
        .sort((a, b) => b.endDate!.getTime() - a.endDate!.getTime())[0];
      if (!project?.endDate) return null;
      const metadata = projectMetadata.find(item => item.id === project.projectId);
      const phase = simulation.phases
        .filter(item => item.projectId === project.projectId && !item.isManagement && item.endDate !== null)
        .sort((a, b) => b.endDate!.getTime() - a.endDate!.getTime())[0];
      const phaseAllocations = phase
        ? simulation.allocations.filter(item => item.projectPhaseId === phase.projectPhaseId)
        : [];
      const lastAllocationTime = phaseAllocations.length
        ? Math.max(...phaseAllocations.map(item => item.date.getTime()))
        : null;
      const resourceIds = new Set(
        phaseAllocations
          .filter(item => lastAllocationTime === null || item.date.getTime() === lastAllocationTime)
          .map(item => item.resourceId),
      );
      return {
        projectId: project.projectId,
        sdNumber: metadata?.sdNumber || '',
        title: metadata?.title || '',
        endDate: project.endDate.toISOString(),
        phaseId: phase?.projectPhaseId || null,
        phaseName: phase?.phaseName || null,
        resources: scenarioContext?.resources
          .filter(resource => resourceIds.has(resource.id))
          .map(resource => ({ id: resource.id, name: resource.name })) || [],
      };
    };

    const criticalPathBefore = findCriticalPath(scenarioContext?.baseline);
    const criticalPathAfter = findCriticalPath(scenarioContext?.proposed);
    const resourceImpact = new Map<string, {
      resourceId: string;
      name: string;
      projectIds: Set<string>;
      beforeMinutes: number;
      afterMinutes: number;
    }>();
    if (scenarioContext) {
      for (const resource of scenarioContext.resources) {
        resourceImpact.set(resource.id, {
          resourceId: resource.id,
          name: resource.name,
          projectIds: new Set(),
          beforeMinutes: 0,
          afterMinutes: 0,
        });
      }
      for (const allocation of scenarioContext.baseline.allocations) {
        if (!affectedProjectIds.has(allocation.projectId)) continue;
        const impact = resourceImpact.get(allocation.resourceId);
        if (impact) {
          impact.beforeMinutes += allocation.minutesAllocated;
          impact.projectIds.add(allocation.projectId);
        }
      }
      for (const allocation of scenarioContext.proposed.allocations) {
        if (!affectedProjectIds.has(allocation.projectId)) continue;
        const impact = resourceImpact.get(allocation.resourceId);
        if (impact) {
          impact.afterMinutes += allocation.minutesAllocated;
          impact.projectIds.add(allocation.projectId);
        }
      }
    }
    const topAffectedResources = [...resourceImpact.values()]
      .filter(item => item.projectIds.size > 0)
      .sort((a, b) => b.projectIds.size - a.projectIds.size || Math.abs(b.afterMinutes - b.beforeMinutes) - Math.abs(a.afterMinutes - a.beforeMinutes))
      .slice(0, 8)
      .map(item => ({
        resourceId: item.resourceId,
        name: item.name,
        affectedProjects: item.projectIds.size,
        beforeMinutes: item.beforeMinutes,
        afterMinutes: item.afterMinutes,
        differenceMinutes: item.afterMinutes - item.beforeMinutes,
      }));

    let portfolioEndUnchangedReason: string | null = null;
    if (portfolioDifferenceDays === 0 && affectedCount > 0 && portfolioEndAfterTime !== null) {
      if (criticalPathBefore?.projectId && criticalPathBefore.projectId === criticalPathAfter?.projectId) {
        portfolioEndUnchangedReason = `A data final permanece em ${formatCivilDatePtBr(new Date(portfolioEndAfterTime))} porque o projeto ${criticalPathAfter.sdNumber} - ${criticalPathAfter.title} continua determinando o encerramento da carteira, embora ${affectedCount} projeto${affectedCount === 1 ? '' : 's'} tenha${affectedCount === 1 ? '' : 'm'} mudado.`;
      } else {
        portfolioEndUnchangedReason = `A composição do caminho crítico mudou, mas a última conclusão da carteira permanece em ${formatCivilDatePtBr(new Date(portfolioEndAfterTime))}.`;
      }
    }

    // Default messages
    let message = 'A alteração proposta não altera a carteira oficial.';
    if (postergadosCount > 0 && antecipadosCount > 0) {
      message = `A proposta posterga ${postergadosCount} projetos e antecipa ${antecipadosCount} projetos.`;
    } else if (postergadosCount > 0) {
      message = `A proposta posterga ${postergadosCount} projetos na fila de capacidade.`;
    } else if (antecipadosCount > 0) {
      message = `A proposta antecipa ${antecipadosCount} entregas de projetos.`;
    } else if (affectedCount > 0) {
      message = portfolioEndUnchangedReason || `A proposta altera a composição ou a situação de ${affectedCount} projeto${affectedCount === 1 ? '' : 's'} no cronograma.`;
    }

    return {
      impactDetected: affectedCount > 0,
      portfolioEndDateBefore: portfolioEndBeforeTime !== null ? new Date(portfolioEndBeforeTime).toISOString() : null,
      portfolioEndDateAfter: portfolioEndAfterTime !== null ? new Date(portfolioEndAfterTime).toISOString() : null,
      portfolioDifferenceDays,
      portfolioDirection: portfolioEndBeforeTime === null && portfolioEndAfterTime !== null
        ? 'NEW_FORECAST'
        : portfolioEndBeforeTime !== null && portfolioEndAfterTime === null
          ? 'NO_FORECAST'
          : portfolioDifferenceDays > 0
            ? 'POSTPONED'
            : portfolioDifferenceDays < 0
              ? 'ANTICIPATED'
              : 'UNCHANGED',
      affectedProjectsCount: affectedCount,
      antecipadosCount,
      postergadosCount,
      novosAtrasos,
      atrasosResolvidos,
      details: highlighted,
      fullDetails: details,
      criticalPathBefore,
      criticalPathAfter,
      topAffectedResources,
      portfolioEndUnchangedReason,
      message,
    };
  }

  // Complete helper: Runs input fetching, simulation execution, and comparison
  async runProposedSimulation(tx: any, proposedChanges: {
    projectsModifier?: (list: EngineProject[]) => void;
    resourcesModifier?: (list: EngineResource[]) => void;
    holidaysModifier?: (list: EngineHoliday[]) => void;
    queueModeOverride?: 'automatic' | 'manual';
    manualOrderOverride?: string[];
    eligibilityModeOverride?: string;
    wipModeOverride?: 'soft' | 'hard';
    maxScheduleDaysOverride?: number;
    riskToleranceDaysOverride?: number;
    workingDaysOverride?: number[];
    holidayBehaviorOverride?: 'skip' | 'include';
    startCalcDateOverride?: Date;
  }) {
    const input = await this.fetchEngineInput(tx);
    const queueState = await tx.priorityQueueState.findUnique({ where: { id: 'singleton' } });
    const baselineQueueMode = (queueState?.mode || 'automatic') as 'automatic' | 'manual';
    const baselineManualOrder = JSON.parse(queueState?.manualOrder || '[]') as string[];

    const cloneProjects = (projects: EngineProject[]): EngineProject[] => projects.map(project => ({
      ...project,
      openingDate: new Date(project.openingDate),
      requestedDeadline: project.requestedDeadline ? new Date(project.requestedDeadline) : null,
      phases: project.phases.map(phase => ({
        ...phase,
        allocations: phase.allocations.map(allocation => ({ ...allocation })),
      })),
    }));
    const cloneResources = (resources: EngineResource[]): EngineResource[] => resources.map(resource => ({
      ...resource,
      unavailabilities: resource.unavailabilities.map(item => ({
        ...item,
        startDate: new Date(item.startDate),
        endDate: new Date(item.endDate),
      })),
    }));
    const cloneHolidays = (holidays: EngineHoliday[]): EngineHoliday[] => holidays.map(item => ({
      ...item,
      startDate: new Date(item.startDate),
      endDate: new Date(item.endDate),
    }));

    const baselineProjects = cloneProjects(input.projects);
    const baselineResources = cloneResources(input.resources);
    const baselineHolidays = cloneHolidays(input.holidays);
    const proposedProjects = cloneProjects(input.projects);
    const proposedResources = cloneResources(input.resources);
    const proposedHolidays = cloneHolidays(input.holidays);

    proposedChanges.projectsModifier?.(proposedProjects);
    proposedChanges.resourcesModifier?.(proposedResources);
    proposedChanges.holidaysModifier?.(proposedHolidays);

    const baselineSorted = await this.sortFilaAutomatic(baselineProjects);
    const proposedSorted = await this.sortFilaAutomatic(proposedProjects);
    const baselineEffectiveHolidays = input.holidayBehavior === 'include' ? [] : baselineHolidays;
    const proposedHolidayBehavior = proposedChanges.holidayBehaviorOverride || input.holidayBehavior;
    const proposedEffectiveHolidays = proposedHolidayBehavior === 'include' ? [] : proposedHolidays;

    const baselineSimulation = this.simulateAllocationSchedule(
      baselineProjects,
      baselineResources,
      baselineEffectiveHolidays,
      baselineQueueMode,
      baselineManualOrder,
      baselineSorted,
      input.eligibilityMode,
      input.startCalcDate,
      input.wipMode,
      input.maxScheduleDays,
      input.riskToleranceDays,
      input.workingDays,
    );

    const simResult = this.simulateAllocationSchedule(
      proposedProjects,
      proposedResources,
      proposedEffectiveHolidays,
      proposedChanges.queueModeOverride || baselineQueueMode,
      proposedChanges.manualOrderOverride || baselineManualOrder,
      proposedSorted,
      proposedChanges.eligibilityModeOverride || input.eligibilityMode,
      proposedChanges.startCalcDateOverride || input.startCalcDate,
      proposedChanges.wipModeOverride || input.wipMode,
      proposedChanges.maxScheduleDaysOverride || input.maxScheduleDays,
      proposedChanges.riskToleranceDaysOverride ?? input.riskToleranceDays,
      proposedChanges.workingDaysOverride?.length ? proposedChanges.workingDaysOverride : input.workingDays,
    );

    const projectMetadata = [...baselineProjects, ...proposedProjects]
      .filter((project, index, list) => list.findIndex(candidate => candidate.id === project.id) === index)
      .map(project => ({ id: project.id, title: project.title, sdNumber: project.sdNumber }));

    const comparison = this.compareSchedules(
      simResult.projects,
      baselineSimulation.projects,
      projectMetadata,
      { baseline: baselineSimulation, proposed: simResult, resources: proposedResources },
    );

    return {
      simulation: simResult,
      baselineSimulation,
      comparison,
      stateHash: await this.getDatabaseStateHash(tx),
    };
  }
}
