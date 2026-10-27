import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete,
  Put, 
  Body, 
  Param, 
  UseGuards, 
  BadRequestException, 
  ForbiddenException, 
  GoneException,
  Req,
  HttpStatus
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';
import { BusinessEventsService } from '../history-alerts/business-events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CatalogType, Role, UserStatus } from '@tic/database';
import { 
  IsNotEmpty, 
  IsOptional, 
  IsArray,
  ArrayUnique,
  IsIn,
  IsBoolean, 
  IsInt, 
  IsNumber, 
  IsString, 
  IsDateString,
  IsEnum,
  Min 
} from 'class-validator';
import { ProjectPhaseStatus } from '@prisma/client';
import { PROJECT_STATUS_CODES, PROJECT_STATUS_LABELS } from '../common/project-status';
import { calculatePhaseMinutes, calculateResourceSplit, normalizeProjectEffort, reconcileProjectEffort } from './project-effort';
import { parseCivilDate } from '../imports-exports/import-export.utils';

const SCHEDULE_TRANSACTION_TIMEOUT_MS = 120_000;

class CreateProjectDto {
  @IsNotEmpty({ message: 'Número da SD é obrigatório.' })
  sdNumber: string;

  @IsNotEmpty({ message: 'Título é obrigatório.' })
  title: string;

  @IsNotEmpty({ message: 'Solicitante é obrigatório.' })
  requester: string;

  @IsDateString({}, { message: 'Data de abertura inválida.' })
  @IsNotEmpty({ message: 'Data de abertura é obrigatória.' })
  openingDate: string;

  @IsOptional()
  @IsDateString({}, { message: 'Prazo solicitado inválido.' })
  requestedDeadline?: string;

  @IsOptional()
  problemDescription?: string;

  @IsOptional()
  objective?: string;

  @IsOptional()
  currentProcess?: string;

  @IsOptional()
  desiredProcess?: string;

  @IsOptional()
  @IsString()
  projectManagerNotes?: string;

  @IsNotEmpty({ message: 'Classificação é obrigatória.' })
  classificationId: string;

  @IsNotEmpty({ message: 'Tipo de fluxo é obrigatório.' })
  flowTypeId: string;

  @IsNotEmpty({ message: 'Prioridade de negócio é obrigatória.' })
  businessPriorityId: string;

  @IsNotEmpty({ message: 'Classe é obrigatória.' })
  classId: string;

  @IsBoolean({ message: 'O requisito legal deve ser um booleano.' })
  @IsOptional()
  isLegalRequirement?: boolean;

  @IsInt({ message: 'Status deve ser um número inteiro.' })
  @IsOptional()
  status?: number;

  @IsArray({ message: 'departmentIds deve ser uma lista de IDs.' })
  departmentIds: string[];

  @IsArray({ message: 'systemIds deve ser uma lista de IDs.' })
  systemIds: string[];

  @IsOptional()
  @IsNumber({}, { message: 'Ganho mensal estimado deve ser um número.' })
  estimatedMonthlyGain?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Prejuízo mensal evitado estimado deve ser um número.' })
  estimatedMonthlyLossAvoided?: number;
}

class UpdateProjectDto {
  @IsOptional()
  @IsNotEmpty({ message: 'Título não pode ser vazio.' })
  title?: string;

  @IsOptional()
  @IsNotEmpty({ message: 'Solicitante não pode ser vazio.' })
  requester?: string;

  @IsOptional()
  @IsDateString()
  openingDate?: string;

  @IsOptional()
  @IsDateString()
  requestedDeadline?: string;

  @IsOptional()
  @IsDateString()
  realCompletionDate?: string;

  @IsOptional()
  classificationId?: string;

  @IsOptional()
  flowTypeId?: string;

  @IsOptional()
  businessPriorityId?: string;

  @IsOptional()
  classId?: string;

  @IsOptional()
  @IsBoolean()
  isLegalRequirement?: boolean;

  @IsOptional()
  @IsInt()
  status?: number;

  @IsOptional()
  @IsArray()
  departmentIds?: string[];

  @IsOptional()
  @IsArray()
  systemIds?: string[];

  @IsOptional()
  @IsNumber()
  estimatedMonthlyGain?: number;

  @IsOptional()
  @IsNumber()
  estimatedMonthlyLossAvoided?: number;

  @IsOptional()
  problemDescription?: string;

  @IsOptional()
  objective?: string;

  @IsOptional()
  currentProcess?: string;

  @IsOptional()
  desiredProcess?: string;

  @IsOptional()
  @IsString()
  projectManagerNotes?: string;
}

class CompleteProjectDto {
  @IsNotEmpty({ message: 'Data real de conclusão é obrigatória.' })
  realCompletionDate: string;
}

class PhaseProgressDto {
  @IsEnum(ProjectPhaseStatus)
  status: ProjectPhaseStatus;

  @IsInt()
  @Min(0)
  completedMinutes: number;

  @IsOptional()
  @IsDateString()
  actualStartDate?: string;

  @IsOptional()
  @IsDateString()
  actualEndDate?: string;
}

class AllocateResourcesDto {
  @IsArray({ message: 'resourceIds deve ser uma lista de IDs.' })
  @ArrayUnique()
  @IsString({ each: true })
  resourceIds: string[];
}

class ExecutionModeDto {
  @IsNotEmpty({ message: 'Modo de execução é obrigatório.' })
  @IsIn(['SIMULTANEOUS', 'SEQUENTIAL'])
  executionMode: 'SIMULTANEOUS' | 'SEQUENTIAL';

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  resourceOrder?: string[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private prisma: PrismaService,
    private engineService: EngineService,
    private events: BusinessEventsService,
  ) {}

  // Helper: Enforce RBAC department restrictions for MANAGER and DIRECTOR
  private async checkScope(user: any, departmentIds: string[]) {
    if (user.role === Role.ADMIN || user.role === Role.PROJECT_MANAGER) {
      return; // Global access
    }

    const scopes = await this.prisma.userDepartmentScope.findMany({
      where: { userId: user.id },
      select: { departmentId: true },
    });
    const allowedDepts = scopes.map(s => s.departmentId);

    // Verify if there is at least one intersection
    const hasIntersection = departmentIds.some(id => allowedDepts.includes(id));
    if (!hasIntersection) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'Você não tem permissão para acessar projetos vinculados a estes departamentos.',
      });
    }
  }

  private validateStatus(status: number) {
    const validStatuses = PROJECT_STATUS_CODES;
    if (!validStatuses.includes(status)) {
      throw new BadRequestException({
        code: 'INVALID_PROJECT_STATUS',
        message: `Status do projeto inválido (${status}). Os status permitidos são: 1, 2, 4, 5, 6, 7, 8, 9 (Não existe status 3).`,
      });
    }
  }

  // Calculate ROI
  private calculateRoi(gain?: number, lossAvoided?: number): number {
    return (gain ?? 0) + (lossAvoided ?? 0);
  }

  private async recalculateOfficialSchedule(tx: any, user: any, triggerType: string) {
    const result = await this.engineService.runProposedSimulation(tx, {});
    await this.engineService.persistSchedule(tx, result.simulation, {
      triggerType,
      triggeredById: user?.id,
      inputHash: result.stateHash,
    });
    return result;
  }

  private projectAuditSnapshot(project: any) {
    if (!project) return null;
    return {
      title: project.title,
      requester: project.requester,
      openingDate: project.openingDate,
      requestedDeadline: project.requestedDeadline,
      realCompletionDate: project.realCompletionDate,
      classificationId: project.classificationId,
      flowTypeId: project.flowTypeId,
      businessPriorityId: project.businessPriorityId,
      classId: project.classId,
      totalHours: project.totalHours,
      isLegalRequirement: project.isLegalRequirement,
      status: project.status,
      estimatedMonthlyGain: project.estimatedMonthlyGain,
      estimatedMonthlyLossAvoided: project.estimatedMonthlyLossAvoided,
      projectManagerNotes: project.projectManagerNotes,
    };
  }

  // Core business logic: Split hours into phases, applying residue to Desenvolvimento
  static calculatePhaseMinutes(totalHours: number, activePhases: { id: string; name: string; code?: string; value: string | null; order: number | null }[]) {
    return calculatePhaseMinutes(totalHours, activePhases);
  }

  static calculateResourceSplit(totalMinutes: number, resourceIds: string[], executionMode: 'SIMULTANEOUS' | 'SEQUENTIAL', resourceOrder?: string[]) {
    return calculateResourceSplit(totalMinutes, resourceIds, executionMode, resourceOrder);
  }

  // Helper: Generate ProjectPhase records copying from active global phase configurations
  private async createProjectPhases(tx: any, projectId: string, totalHours: number) {
    const activePhases = await tx.catalogItem.findMany({
      where: { type: CatalogType.PHASE, status: UserStatus.ACTIVE },
      orderBy: { order: 'asc' },
    });

    const calculatedPhases = ProjectsController.calculatePhaseMinutes(totalHours, activePhases);

    // Persist phases
    for (const p of calculatedPhases) {
      await tx.projectPhase.create({
        data: {
          projectId,
          phaseId: p.phaseId,
          name: p.name,
          percentage: p.percentage,
          order: p.order,
          totalMinutes: p.totalMinutes,
          executionMode: 'SIMULTANEOUS',
        },
      });
    }
  }

  // Helper: Recalculate phases and allocations when project Class changes
  private async recalculateProjectPhases(tx: any, projectId: string, totalHours: number) {
    return reconcileProjectEffort(tx, projectId, totalHours);
  }

  // Helper: Re-allocate resources to a phase and split totalMinutes equally
  private async splitPhaseAllocations(
    tx: any, 
    projectPhaseId: string, 
    totalMinutes: number, 
    resourceIds: string[], 
    executionMode: 'SIMULTANEOUS' | 'SEQUENTIAL',
    resourceOrder?: string[]
  ) {
    // Delete existing allocations
    await tx.projectPhaseAllocation.deleteMany({
      where: { projectPhaseId },
    });

    if (resourceIds.length === 0) return;

    const splits = ProjectsController.calculateResourceSplit(totalMinutes, resourceIds, executionMode, resourceOrder);

    // Create new allocations
    for (const split of splits) {
      await tx.projectPhaseAllocation.create({
        data: {
          projectPhaseId,
          resourceId: split.resourceId,
          minutesAllocated: split.minutesAllocated,
          order: split.order,
        },
      });
    }
  }

  @Get()
  async findAll(@Req() req: any) {
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

      // Force filter clause to intersect user scopes
      filterClause = {
        departments: {
          some: {
            departmentId: { in: allowedDepts },
          },
        },
      };
    }

    const projects = await this.prisma.project.findMany({
      where: filterClause,
      include: {
        classification: true,
        flowType: true,
        businessPriority: true,
        class: true,
        departments: { include: { department: true } },
        systems: { include: { system: true } },
        phases: { select: { _count: { select: { allocations: true } } } },
      },
      orderBy: { sdNumber: 'asc' },
    });

    // Sanitize financial output for Gerentes (MANAGER role sees NO financials)
    const displayProjects = projects.map(p => {
      const roi = this.calculateRoi(p.estimatedMonthlyGain || 0, p.estimatedMonthlyLossAvoided || 0);
      const isDirector = user.role === Role.DIRECTOR || user.role === Role.ADMIN || user.role === Role.PROJECT_MANAGER;
      
      return {
        ...p,
        hasAllocatedResources: p.phases.some(phase => phase._count.allocations > 0),
        phases: undefined,
        roiMonthly: roi,
        estimatedMonthlyGain: isDirector ? p.estimatedMonthlyGain : null,
        estimatedMonthlyLossAvoided: isDirector ? p.estimatedMonthlyLossAvoided : null,
        roiMonthlyValue: isDirector ? roi : null,
      };
    });

    return displayProjects;
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('preview')
  async createPreview(@Body() body: CreateProjectDto) {
    const [classItem, priorityItem, phaseCatalog] = await Promise.all([
      this.prisma.catalogItem.findUnique({ where: { id: body.classId } }),
      this.prisma.catalogItem.findUnique({ where: { id: body.businessPriorityId } }),
      this.prisma.catalogItem.findMany({ where: { type: CatalogType.PHASE, status: UserStatus.ACTIVE }, orderBy: { order: 'asc' } }),
    ]);
    if (!classItem || !priorityItem) throw new BadRequestException({ code: 'INVALID_PROJECT_RELATIONS', message: 'Classe ou prioridade inválida.' });
    const hours = parseFloat(classItem.value || '0');
    const calculated = ProjectsController.calculatePhaseMinutes(hours, phaseCatalog);
    const simulatedId = `preview-${body.sdNumber}`;
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: projects => projects.push({
        id: simulatedId,
        sdNumber: body.sdNumber,
        title: body.title,
        requester: body.requester,
        totalHours: hours,
        status: body.status ?? 1,
        isLegalRequirement: body.isLegalRequirement ?? false,
        businessPriorityCode: priorityItem.code,
        committeeDecision: null,
        committeeScore: 0,
        openingDate: new Date(body.openingDate),
        requestedDeadline: body.requestedDeadline ? new Date(body.requestedDeadline) : null,
        phases: calculated.map(p => ({
          id: `preview-${p.phaseId}`,
          phaseId: p.phaseId,
          name: p.name,
          percentage: p.percentage,
          order: p.order,
          totalMinutes: p.totalMinutes,
          executionMode: 'SIMULTANEOUS',
          status: ProjectPhaseStatus.PENDING,
          completedMinutes: 0,
          allocations: [],
        })),
      }),
    });
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('confirm')
  async createConfirm(@Req() req: any, @Body() body: CreateProjectDto) {
    const existing = await this.prisma.project.findUnique({
      where: { sdNumber: body.sdNumber },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'SD_NUMBER_EXISTS',
        message: `Já existe um projeto com a SD número ${body.sdNumber}.`,
      });
    }

    if (body.status !== undefined) {
      this.validateStatus(body.status);
    }

    // Fetch hours from Class item
    const classItem = await this.prisma.catalogItem.findUnique({
      where: { id: body.classId },
    });
    if (!classItem || classItem.type !== CatalogType.CLASS) {
      throw new BadRequestException({ code: 'INVALID_CLASS', message: 'Classe de projeto inválida.' });
    }
    const hours = parseFloat(classItem.value || '0');

    // Run in database transaction
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          sdNumber: body.sdNumber,
          title: body.title,
          requester: body.requester,
          openingDate: new Date(body.openingDate),
          requestedDeadline: body.requestedDeadline ? new Date(body.requestedDeadline) : null,
          problemDescription: body.problemDescription,
          objective: body.objective,
          currentProcess: body.currentProcess,
          desiredProcess: body.desiredProcess,
          projectManagerNotes: body.projectManagerNotes?.trim() || null,
          classificationId: body.classificationId,
          flowTypeId: body.flowTypeId,
          businessPriorityId: body.businessPriorityId,
          classId: body.classId,
          totalHours: hours,
          isLegalRequirement: body.isLegalRequirement ?? false,
          status: body.status ?? 1,
          estimatedMonthlyGain: body.estimatedMonthlyGain ?? 0,
          estimatedMonthlyLossAvoided: body.estimatedMonthlyLossAvoided ?? 0,
        },
      });

      // Insert departments scopes
      if (body.departmentIds && body.departmentIds.length > 0) {
        await tx.projectDepartment.createMany({
          data: body.departmentIds.map(dId => ({ projectId: p.id, departmentId: dId })),
        });
      }

      // Insert systems relations
      if (body.systemIds && body.systemIds.length > 0) {
        await tx.projectSystem.createMany({
          data: body.systemIds.map(sId => ({ projectId: p.id, systemId: sId })),
        });
      }

      // Automatically generate project phases
      await this.createProjectPhases(tx, p.id, hours);

      await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: p.id, eventType: 'PROJECT_CREATED',
        description: `Projeto ${p.sdNumber} criado.`, userId: req.user.id, actorName: req.user.name,
        metadata: { after: this.projectAuditSnapshot(p) },
      });
      await this.recalculateOfficialSchedule(tx, req.user, 'PROJECT_CREATED');
      return p;
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const user = req.user;

    const p = await this.prisma.project.findUnique({
      where: { id },
      include: {
        classification: true,
        flowType: true,
        businessPriority: true,
        class: true,
        departments: { include: { department: true } },
        systems: { include: { system: true } },
        phases: {
          orderBy: { order: 'asc' },
          include: {
            allocations: {
              orderBy: { order: 'asc' },
              include: { resource: true }
            }
          }
        }
      },
    });

    if (!p) {
      throw new BadRequestException({ code: 'PROJECT_NOT_FOUND', message: 'Projeto não encontrado.' });
    }

    // Verify user scope
    const projectDeptIds = p.departments.map(d => d.departmentId);
    await this.checkScope(user, projectDeptIds);

    const roi = this.calculateRoi(p.estimatedMonthlyGain || 0, p.estimatedMonthlyLossAvoided || 0);
    const isDirector = user.role === Role.DIRECTOR || user.role === Role.ADMIN || user.role === Role.PROJECT_MANAGER;

    return {
      ...p,
      roiMonthly: roi,
      estimatedMonthlyGain: isDirector ? p.estimatedMonthlyGain : null,
      estimatedMonthlyLossAvoided: isDirector ? p.estimatedMonthlyLossAvoided : null,
      roiMonthlyValue: isDirector ? roi : null,
    };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Delete(':id')
  async permanentlyDelete(@Param('id') id: string, @Req() req: any) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        departments: { include: { department: true } }, systems: { include: { system: true } },
        phases: { include: { allocations: true } }, deliveries: { include: { feedback: true } },
        plannedDeliveries: true, committeeEvaluations: true, currentSchedule: true,
      },
    });
    if (!project) throw new BadRequestException({ code: 'PROJECT_NOT_FOUND', message: 'Projeto não encontrado.' });

    return this.prisma.$transaction(async tx => {
      const priorityState = await tx.priorityQueueState.findUnique({ where: { id: 'singleton' } });
      if (priorityState) {
        let manualOrder: string[] = [];
        try { manualOrder = JSON.parse(priorityState.manualOrder || '[]'); } catch { manualOrder = []; }
        if (manualOrder.includes(id)) await tx.priorityQueueState.update({
          where: { id: 'singleton' }, data: { manualOrder: JSON.stringify(manualOrder.filter(projectId => projectId !== id)), updatedById: req.user.id },
        });
      }

      await tx.scheduleRunAllocation.deleteMany({ where: { projectId: id } });
      await tx.scheduleRunPhase.deleteMany({ where: { projectId: id } });
      await tx.scheduleRunProject.deleteMany({ where: { projectId: id } });
      await tx.currentResourceAllocation.deleteMany({ where: { projectId: id } });
      await tx.currentEngineWarning.deleteMany({ where: { projectId: id } });
      await tx.project.delete({ where: { id } });

      await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: id, eventType: 'PROJECT_PERMANENTLY_DELETED',
        description: `Projeto ${project.sdNumber} excluído permanentemente.`, userId: req.user.id, actorName: req.user.name,
        metadata: {
          deleted: true,
          before: {
            ...this.projectAuditSnapshot(project), id: project.id, sdNumber: project.sdNumber,
            departments: project.departments.map(item => item.department.code),
            systems: project.systems.map(item => item.system.code),
            phasesCount: project.phases.length, allocationsCount: project.phases.reduce((sum, phase) => sum + phase.allocations.length, 0),
            deliveriesCount: project.deliveries.length, plannedDeliveriesCount: project.plannedDeliveries.length,
            committeeEvaluationsCount: project.committeeEvaluations.length,
          },
        },
      });
      const result = await this.recalculateOfficialSchedule(tx, req.user, 'PROJECT_PERMANENTLY_DELETED');
      return {
        success: true, deletedProject: { id: project.id, sdNumber: project.sdNumber, title: project.title },
        comparison: result.comparison,
      };
    }, { timeout: 120000 });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':id/preview')
  async updatePreview(@Param('id') id: string, @Body() body: UpdateProjectDto) {
    const existing = await this.prisma.project.findUnique({
      where: { id },
      include: { businessPriority: true, class: true, phases: { include: { allocations: true } } },
    });
    if (!existing) throw new BadRequestException({ code: 'PROJECT_NOT_FOUND', message: 'Projeto não encontrado.' });
    const [priority, classItem] = await Promise.all([
      body.businessPriorityId ? this.prisma.catalogItem.findUnique({ where: { id: body.businessPriorityId } }) : Promise.resolve(existing.businessPriority),
      body.classId ? this.prisma.catalogItem.findUnique({ where: { id: body.classId } }) : Promise.resolve(existing.class),
    ]);
    const newHours = parseFloat(classItem?.value || String(existing.totalHours));
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: projects => {
        let project = projects.find(p => p.id === id);
        const nextStatus = body.status ?? existing.status;
        if (!project && ![7, 8, 9].includes(nextStatus)) {
          project = {
            id: existing.id, sdNumber: existing.sdNumber, title: existing.title, requester: existing.requester,
            totalHours: existing.totalHours, status: existing.status, isLegalRequirement: existing.isLegalRequirement,
            businessPriorityCode: existing.businessPriority.code, committeeDecision: existing.committeeDecision,
            committeeScore: existing.committeeScore || 0, openingDate: existing.openingDate,
            requestedDeadline: existing.requestedDeadline,
            phases: existing.phases.map(ph => ({ ...ph, executionMode: ph.executionMode as any })),
          };
          projects.push(project);
        }
        if (!project) return;
        project.title = body.title ?? project.title;
        project.requester = body.requester ?? project.requester;
        project.status = nextStatus;
        project.isLegalRequirement = body.isLegalRequirement ?? project.isLegalRequirement;
        project.businessPriorityCode = priority?.code || project.businessPriorityCode;
        project.openingDate = body.openingDate ? new Date(body.openingDate) : project.openingDate;
        project.requestedDeadline = body.requestedDeadline !== undefined ? (body.requestedDeadline ? new Date(body.requestedDeadline) : null) : project.requestedDeadline;
        project.totalHours = newHours;
        normalizeProjectEffort(project);
        if ([7, 8, 9].includes(project.status)) projects.splice(projects.indexOf(project), 1);
      },
    });
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch(':id/confirm')
  async updateConfirm(@Param('id') id: string, @Req() req: any, @Body() body: UpdateProjectDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { departments: true },
    });
    if (!project) {
      throw new BadRequestException({ code: 'PROJECT_NOT_FOUND', message: 'Projeto não encontrado.' });
    }

    if (body.status !== undefined) {
      this.validateStatus(body.status);
    }

    const nextStatus = body.status ?? project.status;
    const realCompletionDate = nextStatus === 7
      ? (body.realCompletionDate !== undefined
          ? (body.realCompletionDate ? parseCivilDate(body.realCompletionDate) : null)
          : project.realCompletionDate)
      : (body.status !== undefined && project.status === 7
          ? null
          : body.realCompletionDate !== undefined
            ? (body.realCompletionDate ? parseCivilDate(body.realCompletionDate) : null)
            : undefined);

    if (nextStatus === 7 && !realCompletionDate) {
      throw new BadRequestException({
        code: 'REAL_COMPLETION_DATE_REQUIRED',
        message: 'Informe a data real de conclusão para concluir o projeto.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      let totalHours = project.totalHours;
      if (body.classId && body.classId !== project.classId) {
        const classItem = await tx.catalogItem.findUnique({ where: { id: body.classId } });
        if (!classItem) throw new BadRequestException({ code: 'INVALID_CLASS', message: 'Classe inválida.' });
        totalHours = parseFloat(classItem.value || '0');
      }

      const updated = await tx.project.update({
        where: { id },
        data: {
          title: body.title,
          requester: body.requester,
          openingDate: body.openingDate ? new Date(body.openingDate) : undefined,
          requestedDeadline: body.requestedDeadline !== undefined ? (body.requestedDeadline ? new Date(body.requestedDeadline) : null) : undefined,
          realCompletionDate,
          classificationId: body.classificationId,
          flowTypeId: body.flowTypeId,
          businessPriorityId: body.businessPriorityId,
          classId: body.classId,
          totalHours: totalHours,
          isLegalRequirement: body.isLegalRequirement,
          status: body.status,
          estimatedMonthlyGain: body.estimatedMonthlyGain,
          estimatedMonthlyLossAvoided: body.estimatedMonthlyLossAvoided,
          roiMonthly: body.estimatedMonthlyGain !== undefined || body.estimatedMonthlyLossAvoided !== undefined
            ? (body.estimatedMonthlyGain ?? project.estimatedMonthlyGain ?? 0) + (body.estimatedMonthlyLossAvoided ?? project.estimatedMonthlyLossAvoided ?? 0)
            : undefined,
          problemDescription: body.problemDescription,
          objective: body.objective,
          currentProcess: body.currentProcess,
          desiredProcess: body.desiredProcess,
          projectManagerNotes: body.projectManagerNotes !== undefined ? (body.projectManagerNotes.trim() || null) : undefined,
        },
      });

      // Update departments if supplied
      if (body.departmentIds) {
        await tx.projectDepartment.deleteMany({ where: { projectId: id } });
        if (body.departmentIds.length > 0) {
          await tx.projectDepartment.createMany({
            data: body.departmentIds.map(dId => ({ projectId: id, departmentId: dId })),
          });
        }
      }

      // Update systems if supplied
      if (body.systemIds) {
        await tx.projectSystem.deleteMany({ where: { projectId: id } });
        if (body.systemIds.length > 0) {
          await tx.projectSystem.createMany({
            data: body.systemIds.map(sId => ({ projectId: id, systemId: sId })),
          });
        }
      }

      // Recalculate phase minutes if Class (totalHours) changed
      const effortReconciliation = await this.recalculateProjectPhases(tx, id, totalHours);
      if (effortReconciliation.changed) await this.events.record(tx, {aggregateType:'PROJECT',aggregateId:id,eventType:'PROJECT_EFFORT_RECONCILED',description:'Horas das fases e dos recursos reconciliadas com a estimativa do projeto.',userId:req.user.id,actorName:req.user.name,metadata:effortReconciliation});

      const before = this.projectAuditSnapshot(project);
      const after = this.projectAuditSnapshot(updated);
      const wasTerminal = [7, 8, 9].includes(project.status);
      const isActiveAgain = ![7, 8, 9].includes(updated.status);
      await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: id,
        eventType: wasTerminal && isActiveAgain ? 'PROJECT_REOPENED' : project.status !== updated.status ? 'PROJECT_STATUS_CHANGED' : 'PROJECT_UPDATED',
        description: wasTerminal && isActiveAgain
          ? `Projeto ${project.sdNumber} reaberto e reinserido no motor.`
          : project.status !== updated.status
            ? `O projeto ${project.sdNumber} saiu de ${PROJECT_STATUS_LABELS[project.status]} e foi para ${PROJECT_STATUS_LABELS[updated.status]}.`
            : `Projeto ${project.sdNumber} atualizado.`,
        userId: req.user.id, actorName: req.user.name, metadata: { before, after },
      });
      await this.recalculateOfficialSchedule(tx, req.user, 'PROJECT_UPDATED');
      return updated;
    }, { timeout: SCHEDULE_TRANSACTION_TIMEOUT_MS });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/complete/preview')
  async completePreview(@Param('id') id: string, @Body() body: CompleteProjectDto) {
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: projects => {
        const index = projects.findIndex(p => p.id === id);
        if (index >= 0) projects.splice(index, 1);
      },
    });
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/complete/confirm')
  async completeConfirm(@Param('id') id: string, @Req() req: any, @Body() body: CompleteProjectDto) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new BadRequestException({ code: 'PROJECT_NOT_FOUND', message: 'Projeto não encontrado.' });

    return this.prisma.$transaction(async tx => {
      const updated = await tx.project.update({ where: { id }, data: { status: 7, realCompletionDate: parseCivilDate(body.realCompletionDate) } });
      await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: id, eventType: 'PROJECT_COMPLETED',
        description: `Projeto ${project.sdNumber} concluído em ${body.realCompletionDate}.`, userId: req.user.id, actorName: req.user.name,
        metadata: { before: this.projectAuditSnapshot(project), after: this.projectAuditSnapshot(updated) },
      });
      await this.recalculateOfficialSchedule(tx, req.user, 'PROJECT_COMPLETED');
      return updated;
    }, { timeout: SCHEDULE_TRANSACTION_TIMEOUT_MS });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/cancel/preview')
  async cancelPreview(@Param('id') id: string) {
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: projects => {
        const index = projects.findIndex(p => p.id === id);
        if (index >= 0) projects.splice(index, 1);
      },
    });
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post(':id/cancel/confirm')
  async cancelConfirm(@Param('id') id: string, @Req() req: any) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new BadRequestException({ code: 'PROJECT_NOT_FOUND', message: 'Projeto não encontrado.' });

    return this.prisma.$transaction(async tx => {
      const updated = await tx.project.update({ where: { id }, data: { status: 9 } });
      await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: id, eventType: 'PROJECT_CANCELLED',
        description: `Projeto ${project.sdNumber} cancelado.`, userId: req.user.id, actorName: req.user.name,
        metadata: { before: this.projectAuditSnapshot(project), after: this.projectAuditSnapshot(updated) },
      });
      await this.recalculateOfficialSchedule(tx, req.user, 'PROJECT_CANCELLED');
      return updated;
    });
  }

  @Get(':id/phases')
  async findPhases(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { departments: true },
    });
    if (!project) throw new BadRequestException({ code: 'PROJECT_NOT_FOUND', message: 'Projeto não encontrado.' });

    await this.checkScope(user, project.departments.map(d => d.departmentId));

    return this.prisma.projectPhase.findMany({
      where: { projectId: id },
      orderBy: { order: 'asc' },
      include: {
        allocations: {
          orderBy: { order: 'asc' },
          include: { resource: true },
        },
      },
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Put(':id/phases/:phaseId/resources/preview')
  async allocateResourcesPreview(
    @Param('id') id: string,
    @Param('phaseId') phaseId: string,
    @Body() body: AllocateResourcesDto,
  ) {
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: projects => {
        const phase = projects.find(p => p.id === id)?.phases.find(p => p.id === phaseId);
        if (!phase) return;
        phase.allocations = ProjectsController.calculateResourceSplit(phase.totalMinutes, body.resourceIds, phase.executionMode)
          .map((a, index) => ({ id: `preview-${phaseId}-${index}`, ...a }));
      },
    });
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Put(':id/phases/:phaseId/resources/confirm')
  async allocateResourcesConfirm(
    @Param('id') id: string,
    @Param('phaseId') phaseId: string,
    @Req() req: any,
    @Body() body: AllocateResourcesDto,
  ) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
    });
    if (!phase || phase.projectId !== id) {
      throw new BadRequestException({ code: 'PHASE_NOT_FOUND', message: 'Fase de projeto não encontrada.' });
    }

    // Verify all resources are active
    const resources = await this.prisma.resource.findMany({
      where: { id: { in: body.resourceIds }, status: UserStatus.ACTIVE },
    });
    if (resources.length !== body.resourceIds.length) {
      throw new BadRequestException({
        code: 'INACTIVE_RESOURCES_NOT_ALLOWED',
        message: 'Alguns recursos selecionados estão inativos ou não existem.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.projectPhase.findUnique({ where: { id: phaseId }, include: { allocations: { include: { resource: true } } } });
      await this.splitPhaseAllocations(tx, phaseId, phase.totalMinutes, body.resourceIds, phase.executionMode as any);
      const updated = await tx.projectPhase.findUnique({
        where: { id: phaseId },
        include: {
          allocations: { include: { resource: true } },
        },
      });
      await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: id, eventType: 'PHASE_RESOURCES_CHANGED',
        description: `Recursos da fase ${phase.name} alterados.`, userId: req.user.id, actorName: req.user.name,
        metadata: { phaseId, before: before?.allocations, after: updated?.allocations },
      });
      await this.recalculateOfficialSchedule(tx, req.user, 'PHASE_RESOURCES_CHANGED');
      return updated;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Put(':id/phases/:phaseId/execution-mode/preview')
  async updateExecutionModePreview(
    @Param('id') id: string,
    @Param('phaseId') phaseId: string,
    @Body() body: ExecutionModeDto,
  ) {
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: projects => {
        const phase = projects.find(p => p.id === id)?.phases.find(p => p.id === phaseId);
        if (!phase) return;
        phase.executionMode = body.executionMode;
        phase.allocations = ProjectsController.calculateResourceSplit(
          phase.totalMinutes,
          phase.allocations.map(a => a.resourceId),
          body.executionMode,
          body.resourceOrder,
        ).map((a, index) => ({ id: phase.allocations[index]?.id || `preview-${index}`, ...a }));
      },
    });
    return { ...result.comparison, stateHash: result.stateHash };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Put(':id/phases/:phaseId/execution-mode/confirm')
  async updateExecutionModeConfirm(
    @Param('id') id: string,
    @Param('phaseId') phaseId: string,
    @Req() req: any,
    @Body() body: ExecutionModeDto,
  ) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      include: { allocations: true },
    });
    if (!phase || phase.projectId !== id) {
      throw new BadRequestException({ code: 'PHASE_NOT_FOUND', message: 'Fase de projeto não encontrada.' });
    }

    return this.prisma.$transaction(async (tx) => {
      // Update execution mode
      await tx.projectPhase.update({
        where: { id: phaseId },
        data: { executionMode: body.executionMode },
      });

      // Re-split resources to reflect order or changes
      const resourceIds = phase.allocations.map(a => a.resourceId);
      await this.splitPhaseAllocations(
        tx, 
        phaseId, 
        phase.totalMinutes, 
        resourceIds, 
        body.executionMode, 
        body.resourceOrder
      );

      const updated = await tx.projectPhase.findUnique({
        where: { id: phaseId },
        include: {
          allocations: { include: { resource: true } },
        },
      });
      await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: id, eventType: 'PHASE_EXECUTION_MODE_CHANGED',
        description: `Fase ${phase.name} alterada de ${phase.executionMode} para ${body.executionMode}.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: { phaseId, before: phase.executionMode, after: body.executionMode, resourceOrder: body.resourceOrder },
      });
      await this.recalculateOfficialSchedule(tx, req.user, 'PHASE_EXECUTION_MODE_CHANGED');
      return updated;
    });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Put(':id/phases/:phaseId/progress')
  async updatePhaseProgress(
    @Param('id') id: string,
    @Param('phaseId') phaseId: string,
    @Req() req: any,
    @Body() body: PhaseProgressDto,
  ) {
    void id; void phaseId; void req; void body;
    throw new GoneException({
      code: 'PHASE_PROGRESS_REMOVED',
      message: 'Situação e horas concluídas por fase não fazem mais parte do sistema. O trabalho remanescente é definido pelo status geral do projeto.',
    });
  }
}
