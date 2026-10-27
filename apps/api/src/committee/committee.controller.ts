import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete,
  Body, 
  Param, 
  Query,
  UseGuards, 
  BadRequestException, 
  Req 
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService, EngineProject } from '../engine/engine.service';
import { BusinessEventsService } from '../history-alerts/business-events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, UserStatus } from '@prisma/client';
import { IsNotEmpty, IsArray, IsString, IsOptional, IsDateString, IsNumber } from 'class-validator';
import { buildPriorityScoreDistribution } from './priority-score-distribution';
import { formatCivilDatePtBr, parseCivilDate } from '../imports-exports/import-export.utils';
import { dedupeLogicalMeetings } from './committee-import.utils';

class EvaluationDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsString()
  @IsNotEmpty()
  decision: 'NAO_AVALIADO' | 'PRIORIZADO' | 'SEGUNDA_FASE' | 'CANCELADO';

  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  estimatedMonthlyGain?: number;

  @IsOptional()
  @IsNumber()
  estimatedMonthlyLossAvoided?: number;
}

class CreateMeetingDto {
  @IsDateString()
  meetingDate: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  evaluations: EvaluationDto[];
}

class ConfirmCreateMeetingDto extends CreateMeetingDto {
  @IsString()
  @IsNotEmpty()
  stateHash: string;
}

class UpdateMeetingDto extends CreateMeetingDto {}

class ConfirmUpdateMeetingDto extends CreateMeetingDto {
  @IsString()
  @IsNotEmpty()
  stateHash: string;
}

type CommitteeProjectState = {
  status: number;
  committeeDecision: string | null;
  committeeScore: number | null;
  decisionDate: string | null;
  boardNotes: string | null;
  estimatedMonthlyGain: number | null;
  estimatedMonthlyLossAvoided: number | null;
  roiMonthly: number | null;
};

export function statusAfterCommitteeRevision(input: {
  currentStatus: number;
  nextDecision: string | null;
  previousDecision?: string | null;
  historicalBeforeStatus?: number | null;
}) {
  if (input.nextDecision === 'CANCELADO') return 9;
  if (input.currentStatus === 9 && input.previousDecision === 'CANCELADO') {
    return Number(input.historicalBeforeStatus ?? 1);
  }
  return input.currentStatus;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('committee')
export class CommitteeController {
  constructor(
    private prisma: PrismaService,
    private engineService: EngineService,
    private events: BusinessEventsService,
  ) {}

  private committeeProjectState(project: any): CommitteeProjectState {
    return {
      status: Number(project.status ?? 1),
      committeeDecision: project.committeeDecision ?? null,
      committeeScore: project.committeeScore ?? null,
      decisionDate: project.decisionDate ? new Date(project.decisionDate).toISOString() : null,
      boardNotes: project.boardNotes ?? null,
      estimatedMonthlyGain: project.estimatedMonthlyGain ?? null,
      estimatedMonthlyLossAvoided: project.estimatedMonthlyLossAvoided ?? null,
      roiMonthly: project.roiMonthly ?? null,
    };
  }

  private stateFromEvaluation(evaluation: any): CommitteeProjectState {
    const snapshot = evaluation?.snapshot && typeof evaluation.snapshot === 'object' ? evaluation.snapshot : {};
    const state = snapshot.afterState || snapshot.after || {};
    return {
      status: Number(state.status ?? snapshot.status ?? 1),
      committeeDecision: state.committeeDecision ?? state.decision ?? evaluation.decision ?? null,
      committeeScore: state.committeeScore ?? state.score ?? evaluation.score ?? null,
      decisionDate: state.decisionDate ?? evaluation.meeting?.meetingDate?.toISOString?.() ?? null,
      boardNotes: state.boardNotes ?? evaluation.notes ?? null,
      estimatedMonthlyGain: state.estimatedMonthlyGain ?? evaluation.estimatedMonthlyGain ?? null,
      estimatedMonthlyLossAvoided: state.estimatedMonthlyLossAvoided ?? evaluation.estimatedMonthlyLossAvoided ?? null,
      roiMonthly: state.roiMonthly ?? state.roi ?? evaluation.roiMonthly ?? null,
    };
  }

  private beforeStateFromEvaluation(evaluation: any): CommitteeProjectState | null {
    const snapshot = evaluation?.snapshot && typeof evaluation.snapshot === 'object' ? evaluation.snapshot : {};
    const state = snapshot.beforeState || snapshot.before;
    if (!state || typeof state !== 'object') return null;
    return {
      status: Number(state.status ?? 1),
      committeeDecision: state.committeeDecision ?? null,
      committeeScore: state.committeeScore ?? null,
      decisionDate: state.decisionDate ?? null,
      boardNotes: state.boardNotes ?? null,
      estimatedMonthlyGain: state.estimatedMonthlyGain ?? null,
      estimatedMonthlyLossAvoided: state.estimatedMonthlyLossAvoided ?? null,
      roiMonthly: state.roiMonthly ?? null,
    };
  }

  private stateUpdateData(state: CommitteeProjectState) {
    return {
      status: state.status,
      committeeDecision: state.committeeDecision,
      committeeScore: state.committeeScore,
      decisionDate: state.decisionDate ? new Date(state.decisionDate) : null,
      boardNotes: state.boardNotes,
      estimatedMonthlyGain: state.estimatedMonthlyGain,
      estimatedMonthlyLossAvoided: state.estimatedMonthlyLossAvoided,
      roiMonthly: state.roiMonthly,
    };
  }

  private sameCommitteeState(left: CommitteeProjectState, right: CommitteeProjectState) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private legacyBaseline(project: any, evaluation: any, events: any[]) {
    const fields = ['status', 'estimatedMonthlyGain', 'estimatedMonthlyLossAvoided'] as const;
    const recovered: Record<string, any> = {};
    for (const event of events) {
      const after = event?.metadata?.after;
      if (!after || typeof after !== 'object') continue;
      for (const field of fields) {
        if (recovered[field] === undefined && after[field] !== undefined) recovered[field] = after[field];
      }
    }
    const snapshot = evaluation?.snapshot && typeof evaluation.snapshot === 'object' ? evaluation.snapshot : {};
    const fallbackStatus = evaluation?.decision === 'CANCELADO' ? 1 : Number(snapshot.status ?? project.status ?? 1);
    const gain = recovered.estimatedMonthlyGain ?? evaluation?.estimatedMonthlyGain ?? project.estimatedMonthlyGain ?? null;
    const loss = recovered.estimatedMonthlyLossAvoided ?? evaluation?.estimatedMonthlyLossAvoided ?? project.estimatedMonthlyLossAvoided ?? null;
    return {
      state: {
        status: Number(recovered.status ?? fallbackStatus),
        committeeDecision: null,
        committeeScore: null,
        decisionDate: null,
        boardNotes: null,
        estimatedMonthlyGain: gain,
        estimatedMonthlyLossAvoided: loss,
        roiMonthly: (gain ?? 0) + (loss ?? 0),
      } as CommitteeProjectState,
      estimatedFields: [
        ...(recovered.status === undefined ? ['status'] : []),
        'committeeDecision', 'committeeScore', 'decisionDate', 'boardNotes',
        ...(recovered.estimatedMonthlyGain === undefined ? ['estimatedMonthlyGain'] : []),
        ...(recovered.estimatedMonthlyLossAvoided === undefined ? ['estimatedMonthlyLossAvoided'] : []),
        'roiMonthly',
      ],
    };
  }

  private async capturePortfolioSnapshot(tx: any) {
    const projects = await tx.project.findMany({
      include: { departments: { include: { department: true } }, currentSchedule: true },
      orderBy: { sdNumber: 'asc' },
    });
    return projects.map((p: any) => ({
      projectId: p.id,
      sdNumber: p.sdNumber,
      title: p.title,
      departments: p.departments.map((d: any) => d.department.code),
      status: p.status,
      decision: p.committeeDecision || 'NAO_AVALIADO',
      score: p.committeeScore,
      isLegalRequirement: p.isLegalRequirement,
      endDate: p.currentSchedule?.endDate?.toISOString() || null,
      requestedDeadline: p.requestedDeadline?.toISOString() || null,
      realCompletionDate: p.realCompletionDate?.toISOString() || null,
      roi: p.roiMonthly || 0,
    }));
  }

  @Get('eligible-projects')
  async getEligibleProjects(@Query('meetingId') meetingId?: string) {
    return this.prisma.project.findMany({
      where: meetingId
        ? {
            OR: [
              { status: { notIn: [7, 8, 9] } },
              { committeeEvaluations: { some: { meetingId } } },
            ],
          }
        : { status: { notIn: [7, 8, 9] } },
      select: {
        id: true,
        sdNumber: true,
        title: true,
        requester: true,
        status: true,
        class: true,
        committeeDecision: true,
        committeeScore: true,
        estimatedMonthlyGain: true,
        estimatedMonthlyLossAvoided: true,
      },
      orderBy: { sdNumber: 'asc' },
    });
  }

  @Get('meetings')
  async listMeetings() {
    const meetings = await this.prisma.committeeMeeting.findMany({
      where: { status: 'FINAL' },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        _count: { select: { evaluations: true } },
      },
      orderBy: { meetingDate: 'desc' },
    });
    return dedupeLogicalMeetings(meetings);
  }

  @Get('meetings/:id')
  async getMeeting(@Param('id') id: string) {
    const meeting = await this.prisma.committeeMeeting.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        evaluations: {
          include: {
            project: { select: { id: true, sdNumber: true, title: true, status: true, committeeDecision: true, committeeScore: true } },
          },
        },
      },
    });

    if (!meeting) {
      throw new BadRequestException({ code: 'MEETING_NOT_FOUND', message: 'Reunião do comitê não encontrada.' });
    }

    return {
      ...meeting,
      evaluations: meeting.evaluations.map(evaluation => ({
        ...evaluation,
        situationAtMeeting: evaluation.snapshot,
        situationToday: {
          status: evaluation.project.status,
          decision: evaluation.project.committeeDecision,
          score: evaluation.project.committeeScore,
        },
      })),
    };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('meetings/preview')
  async createPreview(@Body() body: CreateMeetingDto) {
    const res = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: (projects) => {
        for (const evalItem of body.evaluations) {
          const proj = projects.find(p => p.id === evalItem.projectId);
          if (proj) {
            proj.committeeDecision = evalItem.decision;
            proj.committeeScore = evalItem.score ?? 0;
            if (evalItem.decision === 'CANCELADO') {
              proj.status = 9; // status Cancelado
            }
          }
        }
      },
    });

    return res.comparison;
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('meetings/confirm')
  async createConfirm(@Req() req: any, @Body() body: ConfirmCreateMeetingDto) {
    const currentHash = await this.engineService.getDatabaseStateHash();
    if (currentHash !== body.stateHash) {
      throw new BadRequestException({
        code: 'DATABASE_CHANGED',
        message: 'A base de dados foi alterada por outro usuário. Por favor, visualize uma nova prévia de impacto antes de confirmar.',
      });
    }

    // Run in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Fetch current schedule end date for log comparison
      const officialSchedules = await tx.currentProjectSchedule.findMany({});
      const validEnds = officialSchedules.map(s => s.endDate).filter((d): d is Date => d !== null);
      const portfolioEndDateBefore = validEnds.length > 0 ? new Date(Math.max(...validEnds.map(d => d.getTime()))) : null;

      // 2. Create the meeting record
      const meeting = await tx.committeeMeeting.create({
        data: {
          meetingDate: parseCivilDate(body.meetingDate),
          notes: body.notes,
          createdById: req.user.id,
        },
      });

      // 3. Update each project and generate evaluations list
      const evaluationsToCreate: any[] = [];
      const projectEvents: Array<{ projectId: string; sdNumber: string; before: CommitteeProjectState; after: CommitteeProjectState }> = [];
      const meetingDate = parseCivilDate(body.meetingDate);

      for (const evalItem of body.evaluations) {
        const project = await tx.project.findUnique({
          where: { id: evalItem.projectId },
          include: { departments: { include: { department: true } } },
        });

        if (!project) continue;

        const beforeState = this.committeeProjectState(project);
        const isCancel = evalItem.decision === 'CANCELADO';
        const newStatus = isCancel ? 9 : project.status;

        const updatedProj = await tx.project.update({
          where: { id: project.id },
          data: {
            committeeDecision: evalItem.decision,
            committeeScore: evalItem.score ?? null,
            decisionDate: meetingDate,
            boardNotes: evalItem.notes?.trim() || null,
            status: newStatus,
            estimatedMonthlyGain: evalItem.estimatedMonthlyGain !== undefined ? evalItem.estimatedMonthlyGain : project.estimatedMonthlyGain,
            estimatedMonthlyLossAvoided: evalItem.estimatedMonthlyLossAvoided !== undefined ? evalItem.estimatedMonthlyLossAvoided : project.estimatedMonthlyLossAvoided,
            roiMonthly: (evalItem.estimatedMonthlyGain ?? project.estimatedMonthlyGain ?? 0) + (evalItem.estimatedMonthlyLossAvoided ?? project.estimatedMonthlyLossAvoided ?? 0),
          },
        });
        const afterState = this.committeeProjectState(updatedProj);
        projectEvents.push({ projectId: project.id, sdNumber: project.sdNumber, before: beforeState, after: afterState });

        // Query official schedule to include in snapshot
        const sched = officialSchedules.find(s => s.projectId === project.id);

        const snapshotData = {
          sdNumber: project.sdNumber,
          title: project.title,
          departments: project.departments.map(d => d.department.code),
          status: newStatus,
          decision: evalItem.decision,
          score: evalItem.score ?? null,
          isLegalRequirement: project.isLegalRequirement,
          endDate: sched?.endDate ? sched.endDate.toISOString() : null,
          requestedDeadline: project.requestedDeadline ? project.requestedDeadline.toISOString() : null,
          roi: updatedProj.roiMonthly,
          beforeState,
          afterState,
        };

        evaluationsToCreate.push({
          meetingId: meeting.id,
          projectId: project.id,
          decision: evalItem.decision,
          score: evalItem.score ?? null,
          notes: evalItem.notes,
          estimatedMonthlyGain: updatedProj.estimatedMonthlyGain,
          estimatedMonthlyLossAvoided: updatedProj.estimatedMonthlyLossAvoided,
          roiMonthly: updatedProj.roiMonthly,
          snapshot: snapshotData,
        });
      }

      await tx.committeeMeetingEvaluation.createMany({
        data: evaluationsToCreate,
      });

      for (const event of projectEvents) {
        await this.events.record(tx, {
          aggregateType: 'PROJECT', aggregateId: event.projectId, eventType: 'PROJECT_COMMITTEE_STATE_CHANGED',
          description: `Decisão do comitê aplicada ao projeto ${event.sdNumber}.`, userId: req.user.id, actorName: req.user.name,
          metadata: { source: 'COMMITTEE', meetingId: meeting.id, before: event.before, after: event.after },
        });
      }

      // 4. Run official allocation engine calculation & persist
      // Fetch input with updated projects
      const sim = await this.engineService.runProposedSimulation(tx, {});
      await this.engineService.persistSchedule(tx, sim.simulation, { triggerType: 'COMMITTEE_MEETING_CREATED', triggeredById: req.user.id, inputHash: sim.stateHash });

      const portfolioSnapshot = await this.capturePortfolioSnapshot(tx);
      await tx.committeeMeeting.update({ where: { id: meeting.id }, data: { portfolioSnapshot } });
      await this.events.record(tx, {
        aggregateType: 'MEETING', aggregateId: meeting.id, eventType: 'COMMITTEE_MEETING_CREATED',
        description: `Ata do comitê de ${formatCivilDatePtBr(body.meetingDate)} registrada com ${body.evaluations.length} projetos avaliados.`,
        userId: req.user.id, actorName: req.user.name, metadata: { meetingId: meeting.id, evaluatedProjectIds: body.evaluations.map(e => e.projectId) },
      });

      // 5. Create change log entry
      const beforeTime = portfolioEndDateBefore ? portfolioEndDateBefore.getTime() : 0;
      const afterTime = sim.simulation.portfolioEndDate ? sim.simulation.portfolioEndDate.getTime() : 0;
      const diffDays = Math.round((afterTime - beforeTime) / (1000 * 60 * 60 * 24));

      await tx.engineChangeLog.create({
        data: {
          changeType: 'COMMITTEE_MEETING_DECISIONS',
          userId: req.user.id,
          portfolioEndDateBefore,
          portfolioEndDateAfter: sim.simulation.portfolioEndDate,
          differenceDays: diffDays,
          mainCause: `Ata de Reunião de Comitê do dia ${formatCivilDatePtBr(body.meetingDate)}`,
          details: `Decisões do comitê aplicadas a ${body.evaluations.length} projetos. Projetos impactados na fila: ${sim.comparison.affectedProjectsCount}.`,
        },
      });

      return { success: true, meetingId: meeting.id, comparison: sim.comparison };
    });

    return result;
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch('meetings/:id/preview')
  async updatePreview(@Param('id') id: string, @Body() body: UpdateMeetingDto) {
    const meeting = await this.prisma.committeeMeeting.findUnique({ where: { id }, include: { evaluations: { include: { meeting: true } } } });
    if (!meeting || meeting.status !== 'FINAL') throw new BadRequestException({ code: 'MEETING_NOT_ACTIVE', message: 'A reunião não existe ou não é a versão ativa.' });
    const projectIds = [...new Set([...meeting.evaluations.map((item: any) => item.projectId), ...body.evaluations.map(item => item.projectId)])];
    const [databaseProjects, otherEvaluations] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: projectIds } } }),
      this.prisma.committeeMeetingEvaluation.findMany({
        where: { projectId: { in: projectIds }, meeting: { status: 'FINAL', id: { not: id } } }, include: { meeting: true },
      }),
    ]);
    const oldByProject = new Map(meeting.evaluations.map((evaluation: any) => [evaluation.projectId, evaluation]));
    const candidatesByProject = new Map<string, Array<{ date: Date; version: number; state: CommitteeProjectState }>>();
    for (const evaluation of otherEvaluations) {
      const list = candidatesByProject.get(evaluation.projectId) || [];
      list.push({ date: evaluation.meeting.meetingDate, version: evaluation.meeting.version, state: this.stateFromEvaluation(evaluation) });
      candidatesByProject.set(evaluation.projectId, list);
    }
    const proposedDate = parseCivilDate(body.meetingDate);
    for (const evaluation of body.evaluations) {
      const project = databaseProjects.find(item => item.id === evaluation.projectId);
      if (!project) continue;
      const oldEvaluation: any = oldByProject.get(project.id);
      const historicalBefore = this.beforeStateFromEvaluation(oldEvaluation) || this.committeeProjectState(project);
      const state: CommitteeProjectState = {
        ...historicalBefore,
        status: evaluation.decision === 'CANCELADO' ? 9 : historicalBefore.status,
        committeeDecision: evaluation.decision, committeeScore: evaluation.score ?? null,
        decisionDate: proposedDate.toISOString(), boardNotes: evaluation.notes?.trim() || null,
        estimatedMonthlyGain: evaluation.estimatedMonthlyGain ?? historicalBefore.estimatedMonthlyGain,
        estimatedMonthlyLossAvoided: evaluation.estimatedMonthlyLossAvoided ?? historicalBefore.estimatedMonthlyLossAvoided,
        roiMonthly: Number(evaluation.estimatedMonthlyGain ?? historicalBefore.estimatedMonthlyGain ?? 0)
          + Number(evaluation.estimatedMonthlyLossAvoided ?? historicalBefore.estimatedMonthlyLossAvoided ?? 0),
      };
      const list = candidatesByProject.get(project.id) || [];
      list.push({ date: proposedDate, version: meeting.version + 1, state });
      candidatesByProject.set(project.id, list);
    }
    const finalStateByProject = new Map<string, CommitteeProjectState>();
    for (const project of databaseProjects) {
      const candidates = candidatesByProject.get(project.id) || [];
      candidates.sort((left, right) => right.date.getTime() - left.date.getTime() || right.version - left.version);
      const oldEvaluation: any = oldByProject.get(project.id);
      const historicalBefore = this.beforeStateFromEvaluation(oldEvaluation);
      const selectedState = candidates[0]?.state || historicalBefore || this.committeeProjectState(project);
      finalStateByProject.set(project.id, {
        ...selectedState,
        status: statusAfterCommitteeRevision({
          currentStatus: project.status,
          nextDecision: selectedState.committeeDecision,
          previousDecision: oldEvaluation?.decision,
          historicalBeforeStatus: historicalBefore?.status,
        }),
      });
    }
    const res = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: (projects) => {
        finalStateByProject.forEach((state, projectId) => {
          const project = projects.find(item => item.id === projectId);
          if (!project) return;
          project.committeeDecision = state.committeeDecision as any;
          project.committeeScore = state.committeeScore ?? 0;
          project.status = state.status;
        });
      },
    });

    return res.comparison;
  }

  private async reviseMeetingInPlace(id: string, req: any, body: ConfirmUpdateMeetingDto) {
    return this.prisma.$transaction(async tx => {
      const meeting = await tx.committeeMeeting.findUnique({ where: { id }, include: { evaluations: { include: { meeting: true } } } });
      if (!meeting || meeting.status !== 'FINAL') throw new BadRequestException({
        code: 'MEETING_NOT_ACTIVE', message: 'A reunião não existe ou não é a versão ativa.',
      });
      const projectIds = [...new Set([...meeting.evaluations.map((item: any) => item.projectId), ...body.evaluations.map(item => item.projectId)])];
      const projects = await tx.project.findMany({
        where: { id: { in: projectIds } }, include: { departments: { include: { department: true } } },
      });
      if (projects.length !== projectIds.length) throw new BadRequestException('Um ou mais projetos avaliados não foram encontrados.');
      if (new Set(body.evaluations.map(item => item.projectId)).size !== body.evaluations.length) {
        throw new BadRequestException('Um projeto não pode aparecer mais de uma vez na mesma reunião.');
      }
      const officialSchedules = await tx.currentProjectSchedule.findMany({});
      const validEnds = officialSchedules.map((item: any) => item.endDate).filter((date: Date | null): date is Date => Boolean(date));
      const portfolioEndDateBefore = validEnds.length ? new Date(Math.max(...validEnds.map((date: Date) => date.getTime()))) : null;
      const oldByProject = new Map(meeting.evaluations.map((evaluation: any) => [evaluation.projectId, evaluation]));
      const currentBefore = new Map(projects.map(project => [project.id, this.committeeProjectState(project)]));
      const meetingDate = parseCivilDate(body.meetingDate);
      const revised = await tx.committeeMeeting.update({ where: { id }, data: {
        meetingDate, notes: body.notes?.trim() || null, version: { increment: 1 }, updatedAt: new Date(),
      } });
      await tx.committeeMeetingEvaluation.deleteMany({ where: { meetingId: id } });

      for (const evaluation of body.evaluations) {
        const project = projects.find(item => item.id === evaluation.projectId)!;
        const oldEvaluation: any = oldByProject.get(project.id);
        const historicalBefore = this.beforeStateFromEvaluation(oldEvaluation) || currentBefore.get(project.id)!;
        const afterState: CommitteeProjectState = {
          ...historicalBefore,
          status: evaluation.decision === 'CANCELADO' ? 9 : Number(historicalBefore.status ?? project.status),
          committeeDecision: evaluation.decision, committeeScore: evaluation.score ?? null,
          decisionDate: meetingDate.toISOString(), boardNotes: evaluation.notes?.trim() || null,
          estimatedMonthlyGain: evaluation.estimatedMonthlyGain ?? historicalBefore.estimatedMonthlyGain ?? project.estimatedMonthlyGain ?? null,
          estimatedMonthlyLossAvoided: evaluation.estimatedMonthlyLossAvoided ?? historicalBefore.estimatedMonthlyLossAvoided ?? project.estimatedMonthlyLossAvoided ?? null,
          roiMonthly: null,
        };
        afterState.roiMonthly = Number(afterState.estimatedMonthlyGain || 0) + Number(afterState.estimatedMonthlyLossAvoided || 0);
        const schedule = officialSchedules.find((item: any) => item.projectId === project.id);
        await tx.committeeMeetingEvaluation.create({ data: {
          meetingId: id, projectId: project.id, decision: evaluation.decision, score: evaluation.score ?? null,
          notes: evaluation.notes?.trim() || null, estimatedMonthlyGain: afterState.estimatedMonthlyGain,
          estimatedMonthlyLossAvoided: afterState.estimatedMonthlyLossAvoided, roiMonthly: afterState.roiMonthly,
          snapshot: {
            sdNumber: project.sdNumber, title: project.title,
            departments: project.departments.map((item: any) => item.department.code), status: afterState.status,
            decision: evaluation.decision, score: evaluation.score ?? null, isLegalRequirement: project.isLegalRequirement,
            endDate: schedule?.endDate?.toISOString() || null, requestedDeadline: project.requestedDeadline?.toISOString() || null,
            roi: afterState.roiMonthly, beforeState: historicalBefore, afterState,
          },
        } });
      }

      const allEvaluations = projectIds.length ? await tx.committeeMeetingEvaluation.findMany({
        where: { projectId: { in: projectIds }, meeting: { status: 'FINAL' } }, include: { meeting: true },
      }) : [];
      const byProject = new Map<string, any[]>();
      for (const evaluation of allEvaluations) {
        const list = byProject.get(evaluation.projectId) || []; list.push(evaluation); byProject.set(evaluation.projectId, list);
      }
      const changes: Array<{ project: any; before: CommitteeProjectState; after: CommitteeProjectState }> = [];
      for (const project of projects) {
        const evaluations = byProject.get(project.id) || [];
        evaluations.sort((left, right) => {
          const dateDiff = new Date(right.meeting.meetingDate).getTime() - new Date(left.meeting.meetingDate).getTime();
          if (dateDiff) return dateDiff;
          return Number(right.meeting.version || 1) - Number(left.meeting.version || 1);
        });
        const oldEvaluation: any = oldByProject.get(project.id);
        const selectedState = evaluations[0]
          ? this.stateFromEvaluation(evaluations[0])
          : this.beforeStateFromEvaluation(oldEvaluation) || currentBefore.get(project.id)!;
        const historicalBefore = this.beforeStateFromEvaluation(oldEvaluation);
        const finalState: CommitteeProjectState = {
          ...selectedState,
          status: statusAfterCommitteeRevision({
            currentStatus: project.status,
            nextDecision: selectedState.committeeDecision,
            previousDecision: oldEvaluation?.decision,
            historicalBeforeStatus: historicalBefore?.status,
          }),
        };
        const beforeState = currentBefore.get(project.id)!;
        if (this.sameCommitteeState(beforeState, finalState)) continue;
        await tx.project.update({ where: { id: project.id }, data: this.stateUpdateData(finalState) });
        changes.push({ project, before: beforeState, after: finalState });
      }
      for (const change of changes) await this.events.record(tx, {
        aggregateType: 'PROJECT', aggregateId: change.project.id, eventType: 'PROJECT_COMMITTEE_STATE_CHANGED',
        description: `Avaliação do comitê revisada para o projeto ${change.project.sdNumber}.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: { source: 'COMMITTEE', meetingId: id, version: revised.version, before: change.before, after: change.after },
      });

      const simulation = await this.engineService.runProposedSimulation(tx, {});
      await this.engineService.persistSchedule(tx, simulation.simulation, {
        triggerType: 'COMMITTEE_MEETING_REVISED', triggeredById: req.user.id, inputHash: simulation.stateHash,
      });
      const portfolioSnapshot = await this.capturePortfolioSnapshot(tx);
      await tx.committeeMeeting.update({ where: { id }, data: { portfolioSnapshot } });
      await this.events.record(tx, {
        aggregateType: 'MEETING', aggregateId: id, eventType: 'COMMITTEE_MEETING_REVISED',
        description: `Ata do comitê de ${formatCivilDatePtBr(meetingDate)} atualizada sem criar uma reunião duplicada.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: { meetingId: id, version: revised.version, evaluatedProjectIds: body.evaluations.map(item => item.projectId) },
      });
      const afterDate = simulation.simulation.portfolioEndDate;
      await tx.engineChangeLog.create({ data: {
        changeType: 'COMMITTEE_MEETING_UPDATE', userId: req.user.id,
        portfolioEndDateBefore, portfolioEndDateAfter: afterDate,
        differenceDays: Math.round(((afterDate?.getTime() || 0) - (portfolioEndDateBefore?.getTime() || 0)) / 86400000),
        mainCause: `Edição da ata do comitê de ${formatCivilDatePtBr(meetingDate)}`,
        details: `A mesma reunião foi atualizada para a versão ${revised.version}. Projetos afetados na fila: ${simulation.comparison.affectedProjectsCount}.`,
      } });
      return { success: true, meetingId: id, version: revised.version, comparison: simulation.comparison };
    }, { timeout: 120000 });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Patch('meetings/:id/confirm')
  async updateConfirm(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: ConfirmUpdateMeetingDto,
  ) {
    const currentHash = await this.engineService.getDatabaseStateHash();
    if (currentHash !== body.stateHash) {
      throw new BadRequestException({
        code: 'DATABASE_CHANGED',
        message: 'A base de dados foi alterada por outro usuário. Por favor, visualize uma nova prévia de impacto antes de confirmar.',
      });
    }

    const meeting = await this.prisma.committeeMeeting.findUnique({ where: { id } });
    if (!meeting) throw new BadRequestException({ code: 'MEETING_NOT_FOUND', message: 'Reunião não encontrada.' });
    if (meeting.status !== 'FINAL') throw new BadRequestException({ code: 'MEETING_NOT_ACTIVE', message: 'Somente a reunião ativa pode ser editada.' });
    return this.reviseMeetingInPlace(id, req, body);

  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Delete('meetings/:id')
  async deleteMeeting(@Param('id') id: string, @Req() req: any) {
    const meeting = await this.prisma.committeeMeeting.findUnique({ where: { id }, include: { evaluations: true } });
    if (!meeting || meeting.status === 'DELETED') {
      throw new BadRequestException({ code: 'MEETING_NOT_FOUND', message: 'Reunião não encontrada.' });
    }
    if (meeting.status !== 'FINAL') {
      throw new BadRequestException({ code: 'MEETING_NOT_ACTIVE', message: 'Somente a versão vigente de uma reunião pode ser excluída.' });
    }

    return this.prisma.$transaction(async tx => {
      const lineage: any[] = [];
      let cursor: any = meeting;
      while (cursor) {
        lineage.push(cursor);
        if (!cursor.supersedesMeetingId) break;
        cursor = await tx.committeeMeeting.findUnique({
          where: { id: cursor.supersedesMeetingId },
          include: { evaluations: true },
        });
      }
      const lineageOldestFirst = [...lineage].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const lineageEvaluations = lineageOldestFirst.flatMap(item =>
        item.evaluations.map((evaluation: any) => ({ ...evaluation, meeting: item })),
      );
      const projectIds = [...new Set(lineageEvaluations.map((evaluation: any) => evaluation.projectId))] as string[];
      const projects = projectIds.length
        ? await tx.project.findMany({ where: { id: { in: projectIds } } })
        : [];
      const projectsById = new Map(projects.map((project: any) => [project.id, project]));
      const remainingEvaluations = projectIds.length
        ? await tx.committeeMeetingEvaluation.findMany({
            where: {
              projectId: { in: projectIds },
              meeting: { status: 'FINAL', id: { not: id } },
            },
            include: { meeting: true },
          })
        : [];
      const remainingByProject = new Map<string, any[]>();
      for (const evaluation of remainingEvaluations) {
        const list = remainingByProject.get(evaluation.projectId) || [];
        list.push(evaluation);
        remainingByProject.set(evaluation.projectId, list);
      }
      for (const list of remainingByProject.values()) {
        list.sort((left, right) => {
          const dateDiff = new Date(right.meeting.meetingDate).getTime() - new Date(left.meeting.meetingDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          const createdDiff = new Date(right.meeting.createdAt).getTime() - new Date(left.meeting.createdAt).getTime();
          if (createdDiff !== 0) return createdDiff;
          return Number(right.meeting.version || 1) - Number(left.meeting.version || 1);
        });
      }

      const oldestCreatedAt = lineageOldestFirst[0]?.createdAt || meeting.createdAt;
      const historicalEvents = projectIds.length
        ? await tx.businessEvent.findMany({
            where: {
              aggregateType: 'PROJECT',
              aggregateId: { in: projectIds },
              createdAt: { lte: oldestCreatedAt },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const eventsByProject = new Map<string, any[]>();
      for (const event of historicalEvents) {
        const list = eventsByProject.get(event.aggregateId) || [];
        list.push(event);
        eventsByProject.set(event.aggregateId, list);
      }

      const officialSchedules = await tx.currentProjectSchedule.findMany({});
      const validEnds = officialSchedules.map((schedule: any) => schedule.endDate).filter((date: Date | null): date is Date => date !== null);
      const portfolioEndDateBefore = validEnds.length
        ? new Date(Math.max(...validEnds.map((date: Date) => date.getTime())))
        : null;

      const deleted = await tx.committeeMeeting.update({
        where: { id },
        data: { status: 'DELETED' },
      });

      const restoredProjects: Array<{ projectId: string; sdNumber: string; source: string; estimatedFields: string[] }> = [];
      for (const projectId of projectIds) {
        const project: any = projectsById.get(projectId);
        if (!project) continue;
        const currentState = this.committeeProjectState(project);
        const latestRemaining = remainingByProject.get(projectId)?.[0];
        const firstLogicalEvaluation = lineageEvaluations.find((evaluation: any) => evaluation.projectId === projectId);

        let targetState: CommitteeProjectState;
        let restorationSource = 'LATEST_REMAINING_MEETING';
        let estimatedFields: string[] = [];
        if (latestRemaining) {
          targetState = this.stateFromEvaluation(latestRemaining);
        } else {
          const storedBefore = this.beforeStateFromEvaluation(firstLogicalEvaluation);
          if (storedBefore) {
            targetState = storedBefore;
            restorationSource = 'STORED_PRE_MEETING_STATE';
          } else {
            const legacy = this.legacyBaseline(project, firstLogicalEvaluation, eventsByProject.get(projectId) || []);
            targetState = legacy.state;
            estimatedFields = legacy.estimatedFields;
            restorationSource = 'ESTIMATED_LEGACY_STATE';
          }
        }

        if (this.sameCommitteeState(currentState, targetState)) continue;
        await tx.project.update({ where: { id: projectId }, data: this.stateUpdateData(targetState) });
        restoredProjects.push({ projectId, sdNumber: project.sdNumber, source: restorationSource, estimatedFields });
        await this.events.record(tx, {
          aggregateType: 'PROJECT', aggregateId: projectId, eventType: 'PROJECT_COMMITTEE_STATE_RESTORED',
          description: `Situação de comitê do projeto ${project.sdNumber} restaurada após a exclusão da reunião.`,
          userId: req.user.id, actorName: req.user.name,
          metadata: {
            source: 'COMMITTEE_MEETING_DELETION', meetingId: id, restorationSource,
            estimated: estimatedFields.length > 0, estimatedFields, before: currentState, after: targetState,
          },
        });
      }

      const sim = await this.engineService.runProposedSimulation(tx, {});
      await this.engineService.persistSchedule(tx, sim.simulation, {
        triggerType: 'COMMITTEE_MEETING_DELETED',
        triggeredById: req.user.id,
        inputHash: sim.stateHash,
      });

      await this.events.record(tx, {
        aggregateType: 'MEETING',
        aggregateId: id,
        eventType: 'COMMITTEE_MEETING_DELETED',
        description: `Ata do comitê de ${formatCivilDatePtBr(meeting.meetingDate)} excluída e efeitos dos projetos recalculados.`,
        userId: req.user.id,
        actorName: req.user.name,
        metadata: {
          meetingId: id, previousStatus: meeting.status, deletionMode: 'SOFT_DELETE_WITH_ROLLBACK',
          affectedProjectIds: projectIds, restoredProjects,
          estimatedProjectIds: restoredProjects.filter(item => item.estimatedFields.length > 0).map(item => item.projectId),
        },
      });

      const beforeTime = portfolioEndDateBefore?.getTime() || 0;
      const afterTime = sim.simulation.portfolioEndDate?.getTime() || 0;
      await tx.engineChangeLog.create({
        data: {
          changeType: 'COMMITTEE_MEETING_DELETED',
          userId: req.user.id,
          portfolioEndDateBefore,
          portfolioEndDateAfter: sim.simulation.portfolioEndDate,
          differenceDays: Math.round((afterTime - beforeTime) / 86400000),
          mainCause: `Exclusão da reunião de comitê de ${formatCivilDatePtBr(meeting.meetingDate)}`,
          details: `${restoredProjects.length} projeto(s) tiveram a situação de comitê restaurada.`,
        },
      });

      return {
        success: true,
        meetingId: deleted.id,
        affectedProjects: projectIds.length,
        restoredProjects: restoredProjects.length,
        estimatedProjects: restoredProjects.filter(item => item.estimatedFields.length > 0).length,
        comparison: sim.comparison,
      };
    });
  }

  @Get('compare')
  async compareMeetings(
    @Query('id1') id1: string,
    @Query('id2') id2: string,
  ) {
    if (!id1) {
      throw new BadRequestException({ code: 'MISSING_PARAM', message: 'ID da reunião base (id1) é obrigatório.' });
    }

    // Load meeting 1 snapshot
    const m1 = await this.prisma.committeeMeeting.findUnique({
      where: { id: id1 },
      include: { evaluations: true },
    });
    if (!m1) throw new BadRequestException({ code: 'MEETING1_NOT_FOUND', message: 'Reunião base não encontrada.' });

    const snap1 = Array.isArray(m1.portfolioSnapshot) ? m1.portfolioSnapshot as any[] : m1.evaluations.map(e => e.snapshot as any);

    let snap2: any[] = [];
    let label2 = 'Cenário Atual';

    if (id2 && id2 !== 'current') {
      const m2 = await this.prisma.committeeMeeting.findUnique({
        where: { id: id2 },
        include: { evaluations: true },
      });
      if (!m2) throw new BadRequestException({ code: 'MEETING2_NOT_FOUND', message: 'Reunião de comparação não encontrada.' });
      snap2 = Array.isArray(m2.portfolioSnapshot) ? m2.portfolioSnapshot as any[] : m2.evaluations.map(e => e.snapshot as any);
      label2 = `Reunião ${formatCivilDatePtBr(m2.meetingDate)}`;
    } else {
      // Fetch current database projects and official schedules
      const currentProjects = await this.prisma.project.findMany({
        include: {
          departments: { include: { department: true } },
          currentSchedule: true,
        },
      });

      snap2 = currentProjects.map(p => ({
        sdNumber: p.sdNumber,
        title: p.title,
        departments: p.departments.map(d => d.department.code),
        status: p.status,
        decision: p.committeeDecision || 'NAO_AVALIADO',
        score: p.committeeScore || null,
        isLegalRequirement: p.isLegalRequirement,
        endDate: p.currentSchedule?.endDate ? p.currentSchedule.endDate.toISOString() : null,
        requestedDeadline: p.requestedDeadline ? p.requestedDeadline.toISOString() : null,
        roi: p.roiMonthly || 0,
      }));
    }

    // Comparison Metrics
    const comparisonDetails: any[] = [];
    let roiChange = 0;
    let totalRoi1 = 0;
    let totalRoi2 = 0;
    let antecipadosCount = 0;
    let postergadosCount = 0;
    let novosProjetosCount = 0;
    let concluidosCount = 0;
    let canceladosCount = 0;
    let homologacaoCount = 0;

    const allSds = Array.from(new Set([
      ...snap1.map((p: any) => p.sdNumber),
      ...snap2.map((p: any) => p.sdNumber),
    ]));

    for (const sd of allSds) {
      const p1 = snap1.find((p: any) => p?.sdNumber === sd);
      const p2 = snap2.find((p: any) => p?.sdNumber === sd);

      if (p1) totalRoi1 += p1.roi || 0;
      if (p2) totalRoi2 += p2.roi || 0;

      if (!p1 && p2) {
        novosProjetosCount++;
        comparisonDetails.push({
          sdNumber: sd,
          title: p2.title,
          status: 'NOVO',
          oldDate: 'Sem data',
          newDate: p2.endDate ? p2.endDate.split('T')[0] : 'Sem data',
          diffDays: 0,
          oldDecision: 'N/A',
          newDecision: p2.decision,
          oldStatus: null,
          newStatus: p2.status,
        });
        continue;
      }

      if (p1 && !p2) {
        // Project concluded or cancelled/removed from engine
        if (p1.status === 7) concluidosCount++;
        continue;
      }

      // Both present
      if (p1 && p2) {
        const date1 = p1.endDate ? new Date(p1.endDate).getTime() : null;
        const date2 = p2.endDate ? new Date(p2.endDate).getTime() : null;
        let diffDays = 0;

        if (date1 && date2) {
          diffDays = Math.round((date2 - date1) / (1000 * 60 * 60 * 24));
        }

        if (diffDays < 0) antecipadosCount++;
        if (diffDays > 0) postergadosCount++;
        if (p2.status === 7 && p1.status !== 7) concluidosCount++;
        if (p2.status === 9 && p1.status !== 9) canceladosCount++;
        if (p2.status === 6) homologacaoCount++;

        const decisionChanged = p1.decision !== p2.decision;

        if (diffDays !== 0 || decisionChanged || p1.status !== p2.status) {
          comparisonDetails.push({
            sdNumber: sd,
            title: p2.title,
            status: p2.status === 7 ? 'CONCLUIDO' : p2.status === 9 ? 'CANCELADO' : 'ALTERADO',
            oldDate: p1.endDate ? p1.endDate.split('T')[0] : 'Sem data',
            newDate: p2.endDate ? p2.endDate.split('T')[0] : 'Sem data',
            diffDays,
            oldDecision: p1.decision,
            newDecision: p2.decision,
            decisionChanged,
            oldStatus: p1.status,
            newStatus: p2.status,
          });
        }
      }
    }

    roiChange = totalRoi2 - totalRoi1;
    const countStatuses = (snapshot: any[]) => snapshot.reduce((acc: Record<string, number>, p: any) => {
      const key = String(p.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const priorityScoreDistribution = buildPriorityScoreDistribution(snap2);

    return {
      meeting1Label: `Reunião ${formatCivilDatePtBr(m1.meetingDate)}`,
      meeting2Label: label2,
      metrics: {
        antecipadosCount,
        postergadosCount,
        novosProjetosCount,
        concluidosCount,
        canceladosCount,
        homologacaoCount,
        roiChange,
        totalRoiBase: totalRoi1,
        totalRoiCompare: totalRoi2,
        statusDistributionBase: countStatuses(snap1),
        statusDistributionCompare: countStatuses(snap2),
        priorityScoreDistribution,
      },
      details: comparisonDetails,
    };
  }
}
