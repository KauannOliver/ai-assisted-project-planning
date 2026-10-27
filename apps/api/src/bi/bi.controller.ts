import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { BiApiKeyGuard } from './bi-api-key.guard';
import { COMMITTEE_DECISION_LABELS, dateOnlyKey, EXECUTION_MODE_LABELS, SCHEDULE_STATUS_LABELS, UNAVAILABILITY_TYPE_LABELS, USER_STATUS_LABELS } from '../imports-exports/import-export.utils';
import { projectStatusLabel } from '../common/project-status';
import { EngineService } from '../engine/engine.service';

const SCHEMA_VERSION = '1.0';
const decimal = (value: unknown) => value == null ? null : Number(value);
const timestamp = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

@ApiTags('BI')
@ApiHeader({ name: 'X-API-Key', required: true, description: 'Chave exclusiva da integração de BI' })
@UseGuards(BiApiKeyGuard)
@Controller('bi/v1')
export class BiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  private response<T>(data: T[]) {
    return { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), total: data.length, data };
  }

  private projectRow(project: any) {
    const latestEvaluation = project.committeeEvaluations?.[0];
    return {
      projectId: project.id,
      sdNumber: project.sdNumber,
      title: project.title,
      requester: project.requester,
      statusCode: project.status,
      statusName: projectStatusLabel(project.status),
      openingDate: dateOnlyKey(project.openingDate),
      requestedDeadline: dateOnlyKey(project.requestedDeadline),
      simulatedStartDate: dateOnlyKey(project.currentSchedule?.startDate),
      simulatedEndDate: dateOnlyKey(project.currentSchedule?.endDate),
      realCompletionDate: project.status === 7 ? dateOnlyKey(project.realCompletionDate) : null,
      scheduleSituationCode: project.currentSchedule?.status ?? null,
      scheduleSituationName: project.currentSchedule?.status ? (SCHEDULE_STATUS_LABELS[project.currentSchedule.status] ?? project.currentSchedule.status) : null,
      inSchedule: Boolean(project.currentSchedule?.endDate),
      scheduleImpeded: Boolean(project.currentSchedule?.isImpeded),
      scheduleImpediment: project.currentSchedule?.impediments ?? null,
      departmentCodes: project.departments?.map((item: any) => item.department.code).join(',') ?? '',
      departmentNames: project.departments?.map((item: any) => item.department.name).join(', ') ?? '',
      systemCodes: project.systems?.map((item: any) => item.system.code).join(',') ?? '',
      systemNames: project.systems?.map((item: any) => item.system.name).join(', ') ?? '',
      classificationCode: project.classification?.code ?? null,
      classificationName: project.classification?.name ?? null,
      flowCode: project.flowType?.code ?? null,
      flowName: project.flowType?.name ?? null,
      businessPriorityCode: project.businessPriority?.code ?? null,
      businessPriorityName: project.businessPriority?.name ?? null,
      classCode: project.class?.code ?? null,
      className: project.class?.name ?? null,
      totalHours: decimal(project.totalHours),
      legalRequirement: Boolean(project.isLegalRequirement),
      problemDescription: project.problemDescription ?? null,
      objective: project.objective ?? null,
      currentProcess: project.currentProcess ?? null,
      desiredProcess: project.desiredProcess ?? null,
      projectManagerNotes: project.projectManagerNotes ?? null,
      committeeDecision: project.committeeDecision ?? null,
      committeeScore: decimal(project.committeeScore),
      committeeDecisionDate: dateOnlyKey(project.decisionDate),
      committeeNotes: project.boardNotes ?? null,
      estimatedMonthlyGain: decimal(project.estimatedMonthlyGain),
      estimatedMonthlyLossAvoided: decimal(project.estimatedMonthlyLossAvoided),
      roiMonthly: decimal(project.roiMonthly),
      latestCommitteeMeetingDate: dateOnlyKey(latestEvaluation?.meeting?.meetingDate),
      createdAt: timestamp(project.createdAt),
      updatedAt: timestamp(project.updatedAt),
    };
  }

  private projectInclude() {
    return {
      classification: true,
      flowType: true,
      businessPriority: true,
      class: true,
      departments: { include: { department: true } },
      systems: { include: { system: true } },
      currentSchedule: true,
      committeeEvaluations: {
        where: { meeting: { status: 'FINAL' } },
        include: { meeting: true },
        orderBy: { meeting: { meetingDate: 'desc' } },
        take: 1,
      },
    } as any;
  }

  @Get('manifest')
  @ApiOperation({ summary: 'Catálogo e versão das tabelas disponíveis para o BI' })
  async manifest() {
    const run = await this.prisma.scheduleRun.findFirst({ where: { type: 'OFFICIAL', status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } });
    const tables = [
      'portfolio','projects','departments','catalogs','project-departments','project-systems','project-phases','phase-allocations',
      'resources','unavailabilities','schedule-projects','schedule-daily-allocations','resource-utilization','schedule-warnings',
      'committee-meetings','committee-evaluations','planned-deliveries','deliveries','delivery-feedback','project-events','priority-queue',
    ].map(name => ({ name, url: `/bi/v1/${name}` }));
    return { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), currentScheduleRunId: run?.id ?? null, currentScheduleCompletedAt: timestamp(run?.completedAt), total: tables.length, data: tables };
  }

  @Get('portfolio')
  @ApiOperation({ summary: 'Visão consolidada do portfólio, com uma linha por projeto' })
  async portfolio() {
    const rows = await this.prisma.project.findMany({ include: this.projectInclude(), orderBy: { sdNumber: 'asc' } });
    return this.response(rows.map(row => this.projectRow(row)));
  }

  @Get('projects')
  @ApiOperation({ summary: 'Cadastro completo de projetos' })
  async projects() { return this.portfolio(); }

  @Get('departments')
  async departments() {
    const rows = await this.prisma.department.findMany({ orderBy: { code: 'asc' } });
    return this.response(rows.map(row => ({ departmentId: row.id, code: row.code, name: row.name, statusCode: row.status, statusName: USER_STATUS_LABELS[row.status], createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('catalogs')
  async catalogs() {
    const rows = await this.prisma.catalogItem.findMany({ orderBy: [{ type: 'asc' }, { order: 'asc' }, { code: 'asc' }] });
    return this.response(rows.map(row => ({ catalogId: row.id, typeCode: row.type, code: row.code, name: row.name, value: row.value, order: row.order, statusCode: row.status, statusName: USER_STATUS_LABELS[row.status], createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('project-departments')
  async projectDepartments() {
    const rows = await this.prisma.projectDepartment.findMany({ include: { project: { select: { sdNumber: true, title: true } }, department: true } });
    return this.response(rows.map(row => ({ projectDepartmentId: row.id, projectId: row.projectId, sdNumber: row.project.sdNumber, projectTitle: row.project.title, departmentId: row.departmentId, departmentCode: row.department.code, departmentName: row.department.name, createdAt: timestamp(row.createdAt) })));
  }

  @Get('project-systems')
  async projectSystems() {
    const rows = await this.prisma.projectSystem.findMany({ include: { project: { select: { sdNumber: true, title: true } }, system: true } });
    return this.response(rows.map(row => ({ projectSystemId: row.id, projectId: row.projectId, sdNumber: row.project.sdNumber, projectTitle: row.project.title, systemId: row.systemId, systemCode: row.system.code, systemName: row.system.name, createdAt: timestamp(row.createdAt) })));
  }

  @Get('project-phases')
  async projectPhases() {
    const rows = await this.prisma.projectPhase.findMany({ include: { project: { select: { sdNumber: true, title: true } }, phaseCatalog: true }, orderBy: [{ projectId: 'asc' }, { order: 'asc' }] });
    return this.response(rows.map(row => ({ projectPhaseId: row.id, projectId: row.projectId, sdNumber: row.project.sdNumber, projectTitle: row.project.title, phaseCatalogId: row.phaseId, phaseCode: row.phaseCatalog.code, phaseName: row.name, percentage: decimal(row.percentage), order: row.order, totalHours: Number((row.totalMinutes / 60).toFixed(2)), executionModeCode: row.executionMode, executionModeName: EXECUTION_MODE_LABELS[row.executionMode] ?? row.executionMode, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('phase-allocations')
  async phaseAllocations() {
    const rows = await this.prisma.projectPhaseAllocation.findMany({ include: { phase: { include: { project: { select: { sdNumber: true, title: true } } } }, resource: true }, orderBy: [{ projectPhaseId: 'asc' }, { order: 'asc' }] });
    return this.response(rows.map(row => ({ phaseAllocationId: row.id, projectPhaseId: row.projectPhaseId, projectId: row.phase.projectId, sdNumber: row.phase.project.sdNumber, projectTitle: row.phase.project.title, phaseName: row.phase.name, resourceId: row.resourceId, resourceName: row.resource.name, allocatedHours: Number((row.minutesAllocated / 60).toFixed(2)), order: row.order, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('resources')
  async resources() {
    const rows = await this.prisma.resource.findMany({ include: { modality: true, role: true }, orderBy: { name: 'asc' } });
    return this.response(rows.map(row => ({ resourceId: row.id, name: row.name, modalityCode: row.modality.code, modalityName: row.modality.name, roleCode: row.role.code, roleName: row.role.name, weeklyHours: decimal(row.weeklyHours), overheadPercentage: decimal(row.overheadPercentage), developmentPercentage: decimal(row.developmentPercentage), netWeeklyHours: Number((row.weeklyHours * (1 - row.overheadPercentage) * row.developmentPercentage).toFixed(2)), recommendedWipLimit: row.recommendedWipLimit, statusCode: row.status, statusName: USER_STATUS_LABELS[row.status], createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('unavailabilities')
  async unavailabilities() {
    const rows = await this.prisma.resourceUnavailability.findMany({ include: { resource: true }, orderBy: { startDate: 'asc' } });
    return this.response(rows.map(row => ({ unavailabilityId: row.id, resourceId: row.resourceId, resourceName: row.resource?.name ?? 'Global', typeCode: row.type, typeName: UNAVAILABILITY_TYPE_LABELS[row.type] ?? row.type, startDate: dateOnlyKey(row.startDate), endDate: dateOnlyKey(row.endDate), unavailableHoursPerDay: row.unavailableMinutesPerDay == null ? null : Number((row.unavailableMinutesPerDay / 60).toFixed(2)), global: row.global, annualRecurrence: row.annualRecurrence, notes: row.notes, statusCode: row.status, statusName: USER_STATUS_LABELS[row.status], createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('schedule-projects')
  async scheduleProjects() {
    const rows = await this.prisma.currentProjectSchedule.findMany({ include: { project: { select: { sdNumber: true, title: true, status: true, requestedDeadline: true } } } });
    return this.response(rows.map(row => ({ projectId: row.projectId, sdNumber: row.project.sdNumber, projectTitle: row.project.title, projectStatusCode: row.project.status, projectStatusName: projectStatusLabel(row.project.status), requestedDeadline: dateOnlyKey(row.project.requestedDeadline), simulatedStartDate: dateOnlyKey(row.startDate), simulatedEndDate: dateOnlyKey(row.endDate), situationCode: row.status, situationName: SCHEDULE_STATUS_LABELS[row.status] ?? row.status, impeded: row.isImpeded, impediment: row.impediments, scheduleRunId: row.scheduleRunId, updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('priority-queue')
  @ApiOperation({ summary: 'Ordem efetiva dos projetos na fila de prioridades' })
  async priorityQueue() {
    const queue = await this.engine.getEffectivePriorityQueue(this.prisma);
    const projects = queue.projects.length > 0
      ? await this.prisma.project.findMany({
          where: { id: { in: queue.projects.map(project => project.id) } },
          select: {
            id: true,
            sdNumber: true,
            title: true,
            requester: true,
            status: true,
            committeeDecision: true,
            committeeScore: true,
            isLegalRequirement: true,
            openingDate: true,
            requestedDeadline: true,
            businessPriority: { select: { code: true, name: true } },
            currentSchedule: {
              select: {
                startDate: true,
                endDate: true,
                status: true,
                isImpeded: true,
                impediments: true,
              },
            },
          },
        })
      : [];
    const projectsById = new Map(projects.map(project => [project.id, project]));
    const data = queue.projects.map((queuedProject, index) => {
      const project = projectsById.get(queuedProject.id);
      const decisionCode = project?.committeeDecision || 'NAO_AVALIADO';
      const scheduleSituationCode = project?.currentSchedule?.status ?? null;
      return {
        queuePosition: index + 1,
        projectId: queuedProject.id,
        sdNumber: project?.sdNumber ?? queuedProject.sdNumber,
        title: project?.title ?? queuedProject.title,
        requester: project?.requester ?? queuedProject.requester,
        statusCode: project?.status ?? queuedProject.status,
        statusName: projectStatusLabel(project?.status ?? queuedProject.status),
        committeeDecisionCode: decisionCode,
        committeeDecisionName: COMMITTEE_DECISION_LABELS[decisionCode] ?? 'Não avaliado',
        committeeScore: decimal(project?.committeeScore),
        legalRequirement: project?.isLegalRequirement ?? queuedProject.isLegalRequirement,
        businessPriorityCode: project?.businessPriority?.code ?? queuedProject.businessPriorityCode,
        businessPriorityName: project?.businessPriority?.name ?? queuedProject.businessPriorityCode,
        openingDate: dateOnlyKey(project?.openingDate ?? queuedProject.openingDate),
        requestedDeadline: dateOnlyKey(project?.requestedDeadline ?? queuedProject.requestedDeadline),
        simulatedStartDate: dateOnlyKey(project?.currentSchedule?.startDate),
        simulatedEndDate: dateOnlyKey(project?.currentSchedule?.endDate),
        scheduleSituationCode,
        scheduleSituationName: scheduleSituationCode ? (SCHEDULE_STATUS_LABELS[scheduleSituationCode] ?? scheduleSituationCode) : null,
        scheduleImpeded: Boolean(project?.currentSchedule?.isImpeded),
        scheduleImpediment: project?.currentSchedule?.impediments ?? null,
      };
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      total: data.length,
      queueModeCode: queue.mode,
      queueModeName: queue.mode === 'manual' ? 'Manual' : 'Automática',
      data,
    };
  }

  @Get('schedule-daily-allocations')
  async scheduleDailyAllocations() {
    const rows = await this.prisma.currentResourceAllocation.findMany({ orderBy: [{ date: 'asc' }, { resourceId: 'asc' }] });
    return this.response(rows.map(row => ({ dailyAllocationId: row.id, projectId: row.projectId, projectPhaseId: row.projectPhaseId, phaseAllocationId: row.allocationId, resourceId: row.resourceId, date: dateOnlyKey(row.date), allocatedHours: Number((row.minutesAllocated / 60).toFixed(2)) })));
  }

  @Get('resource-utilization')
  async resourceUtilization() {
    const rows = await this.prisma.currentResourceUtilization.findMany({ orderBy: [{ date: 'asc' }, { resourceId: 'asc' }] });
    return this.response(rows.map(row => ({ utilizationId: row.id, resourceId: row.resourceId, date: dateOnlyKey(row.date), busyHours: Number((row.minutesBusy / 60).toFixed(2)), availableHours: Number((row.minutesTotal / 60).toFixed(2)), utilizationPercentage: decimal(row.utilizationPercentage) })));
  }

  @Get('schedule-warnings')
  async scheduleWarnings() {
    const rows = await this.prisma.currentEngineWarning.findMany({ orderBy: { createdAt: 'desc' } });
    return this.response(rows.map(row => ({ warningId: row.id, typeCode: row.type, message: row.message, projectId: row.projectId, resourceId: row.resourceId, date: dateOnlyKey(row.date), createdAt: timestamp(row.createdAt) })));
  }

  @Get('committee-meetings')
  async committeeMeetings() {
    const rows = await this.prisma.committeeMeeting.findMany({ include: { createdBy: { select: { name: true } }, _count: { select: { evaluations: true } } }, orderBy: { meetingDate: 'desc' } });
    return this.response(rows.map(row => ({ committeeMeetingId: row.id, meetingDate: dateOnlyKey(row.meetingDate), notes: row.notes, createdByName: row.createdBy.name, version: row.version, status: row.status, supersedesMeetingId: row.supersedesMeetingId, evaluationCount: row._count.evaluations, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('committee-evaluations')
  async committeeEvaluations() {
    const rows = await this.prisma.committeeMeetingEvaluation.findMany({ include: { meeting: true, project: { select: { sdNumber: true, title: true } } }, orderBy: { createdAt: 'desc' } });
    return this.response(rows.map(row => ({ committeeEvaluationId: row.id, committeeMeetingId: row.meetingId, meetingDate: dateOnlyKey(row.meeting.meetingDate), meetingStatus: row.meeting.status, projectId: row.projectId, sdNumber: row.project.sdNumber, projectTitle: row.project.title, decision: row.decision, score: decimal(row.score), notes: row.notes, estimatedMonthlyGain: decimal(row.estimatedMonthlyGain), estimatedMonthlyLossAvoided: decimal(row.estimatedMonthlyLossAvoided), roiMonthly: decimal(row.roiMonthly), createdAt: timestamp(row.createdAt) })));
  }

  @Get('planned-deliveries')
  async plannedDeliveries() {
    const rows = await this.prisma.plannedDelivery.findMany({ include: { project: { select: { sdNumber: true, title: true } }, recipientDept: true }, orderBy: { plannedDate: 'asc' } });
    return this.response(rows.map(row => ({ plannedDeliveryId: row.id, projectId: row.projectId, sdNumber: row.project.sdNumber, projectTitle: row.project.title, title: row.title, recipientDepartmentId: row.recipientDeptId, recipientDepartmentCode: row.recipientDept.code, recipientDepartmentName: row.recipientDept.name, plannedDate: dateOnlyKey(row.plannedDate), notes: row.notes, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })));
  }

  @Get('deliveries')
  async deliveries() {
    const rows = await this.prisma.delivery.findMany({ include: { project: { select: { sdNumber: true, title: true } }, recipientDept: true, feedback: true, plannedDelivery: true }, orderBy: { deliveryDate: 'desc' } });
    return this.response(rows.map(row => ({ deliveryId: row.id, projectId: row.projectId, sdNumber: row.project.sdNumber, projectTitle: row.project.title, recipientDepartmentId: row.recipientDeptId, recipientDepartmentCode: row.recipientDept.code, recipientDepartmentName: row.recipientDept.name, plannedDeliveryId: row.plannedDeliveryId, plannedDate: dateOnlyKey(row.plannedDelivery?.plannedDate), deliveryDate: dateOnlyKey(row.deliveryDate), completed: Boolean(row.feedback), onTime: row.plannedDelivery ? row.deliveryDate.getTime() <= row.plannedDelivery.plannedDate.getTime() : null, notes: row.notes, createdAt: timestamp(row.createdAt) })));
  }

  @Get('delivery-feedback')
  async deliveryFeedback() {
    const rows = await this.prisma.deliveryFeedback.findMany({ include: { delivery: { include: { project: { select: { sdNumber: true, title: true } } } } }, orderBy: { feedbackDate: 'desc' } });
    return this.response(rows.map(row => ({ feedbackId: row.id, deliveryId: row.deliveryId, projectId: row.delivery.projectId, sdNumber: row.delivery.project.sdNumber, projectTitle: row.delivery.project.title, feedbackDate: dateOnlyKey(row.feedbackDate), notes: row.notes, createdAt: timestamp(row.createdAt) })));
  }

  @Get('project-events')
  async projectEvents() {
    const rows = await this.prisma.businessEvent.findMany({ where: { aggregateType: { in: ['PROJECT', 'PROJECT_PHASE', 'DELIVERY', 'PLANNED_DELIVERY', 'COMMITTEE_MEETING'] } }, orderBy: { createdAt: 'desc' } });
    return this.response(rows.map(row => ({ eventId: row.id, aggregateType: row.aggregateType, aggregateId: row.aggregateId, eventType: row.eventType, description: row.description, metadata: row.metadata, actorName: row.actorName, createdAt: timestamp(row.createdAt) })));
  }
}
