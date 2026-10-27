import { describe, expect, it, vi } from 'vitest';
import { CommitteeController, statusAfterCommitteeRevision } from '../../committee/committee.controller';

describe('revisão de reunião sem regressão do fluxo do projeto', () => {
  it('preserva Concluído quando a avaliação continua não cancelada', () => {
    expect(statusAfterCommitteeRevision({
      currentStatus: 7,
      nextDecision: 'PRIORIZADO',
      previousDecision: 'PRIORIZADO',
      historicalBeforeStatus: 6,
    })).toBe(7);
  });

  it('preserva qualquer status atual em decisões não canceladas', () => {
    expect(statusAfterCommitteeRevision({
      currentStatus: 6,
      nextDecision: 'SEGUNDA_FASE',
      previousDecision: 'PRIORIZADO',
      historicalBeforeStatus: 1,
    })).toBe(6);
  });

  it('cancela explicitamente e restaura o estado anterior ao desfazer a mesma decisão', () => {
    expect(statusAfterCommitteeRevision({ currentStatus: 7, nextDecision: 'CANCELADO' })).toBe(9);
    expect(statusAfterCommitteeRevision({
      currentStatus: 9,
      nextDecision: 'PRIORIZADO',
      previousDecision: 'CANCELADO',
      historicalBeforeStatus: 6,
    })).toBe(6);
  });
});

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function setup(options: { remainingEvaluation?: any; remainingEvaluations?: any[]; beforeState?: any; legacyEvent?: any } = {}) {
  const meeting = {
    id: 'meeting-2', meetingDate: date('2026-08-10'), createdAt: date('2026-08-10'), status: 'FINAL',
    supersedesMeetingId: null, evaluations: [{
      id: 'evaluation-2', projectId: 'project-1', decision: 'CANCELADO', score: 3, notes: 'Cancelado',
      estimatedMonthlyGain: 100, estimatedMonthlyLossAvoided: 50, roiMonthly: 150,
      snapshot: options.beforeState ? { status: 9, beforeState: options.beforeState } : { status: 9 },
    }],
  };
  const project = {
    id: 'project-1', sdNumber: 'SD-1', status: 9, committeeDecision: 'CANCELADO', committeeScore: 3,
    decisionDate: date('2026-08-10'), boardNotes: 'Cancelado', estimatedMonthlyGain: 100,
    estimatedMonthlyLossAvoided: 50, roiMonthly: 150,
  };
  const projectUpdate = vi.fn().mockResolvedValue(undefined);
  const tx: any = {
    committeeMeeting: { update: vi.fn().mockResolvedValue({ id: meeting.id }) },
    project: { findMany: vi.fn().mockResolvedValue([project]), update: projectUpdate },
    committeeMeetingEvaluation: { findMany: vi.fn().mockResolvedValue(options.remainingEvaluations || (options.remainingEvaluation ? [options.remainingEvaluation] : [])) },
    businessEvent: { findMany: vi.fn().mockResolvedValue(options.legacyEvent ? [options.legacyEvent] : []) },
    currentProjectSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    engineChangeLog: { create: vi.fn() },
  };
  const prisma: any = {
    committeeMeeting: { findUnique: vi.fn().mockResolvedValue(meeting) },
    $transaction: vi.fn(async (callback: any) => callback(tx)),
  };
  const engine: any = {
    runProposedSimulation: vi.fn().mockResolvedValue({
      stateHash: 'hash', comparison: { affectedProjectsCount: 1 },
      simulation: { portfolioEndDate: date('2026-12-01') },
    }),
    persistSchedule: vi.fn(),
  };
  const events: any = { record: vi.fn() };
  return { controller: new CommitteeController(prisma, engine, events), tx, engine, events, projectUpdate };
}

describe('exclusão de reunião do comitê', () => {
  it('restaura a avaliação válida mais recente e recalcula o cronograma uma única vez', async () => {
    const previousMeeting = { id: 'meeting-1', meetingDate: date('2026-07-10'), createdAt: date('2026-07-10'), version: 1 };
    const previousEvaluation = {
      projectId: 'project-1', decision: 'PRIORIZADO', score: 8, notes: 'Aprovado',
      estimatedMonthlyGain: 80, estimatedMonthlyLossAvoided: 20, roiMonthly: 100,
      snapshot: { status: 5 }, meeting: previousMeeting,
    };
    const { controller, projectUpdate, engine, events } = setup({ remainingEvaluation: previousEvaluation });

    const result = await controller.deleteMeeting('meeting-2', { user: { id: 'admin', name: 'Administrador' } });

    expect(projectUpdate).toHaveBeenCalledWith({ where: { id: 'project-1' }, data: expect.objectContaining({
      status: 5, committeeDecision: 'PRIORIZADO', committeeScore: 8, boardNotes: 'Aprovado',
      estimatedMonthlyGain: 80, estimatedMonthlyLossAvoided: 20, roiMonthly: 100,
    }) });
    expect(engine.runProposedSimulation).toHaveBeenCalledTimes(1);
    expect(engine.persistSchedule).toHaveBeenCalledTimes(1);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'PROJECT_COMMITTEE_STATE_RESTORED' }));
    expect(result).toMatchObject({ success: true, restoredProjects: 1, estimatedProjects: 0 });
  });

  it('restaura o estado anterior armazenado quando não há outra reunião', async () => {
    const beforeState = {
      status: 4, committeeDecision: null, committeeScore: null, decisionDate: null, boardNotes: null,
      estimatedMonthlyGain: 20, estimatedMonthlyLossAvoided: 10, roiMonthly: 30,
    };
    const { controller, projectUpdate } = setup({ beforeState });

    const result = await controller.deleteMeeting('meeting-2', { user: { id: 'admin', name: 'Administrador' } });

    expect(projectUpdate).toHaveBeenCalledWith({ where: { id: 'project-1' }, data: expect.objectContaining({ status: 4, committeeDecision: null, roiMonthly: 30 }) });
    expect(result).toMatchObject({ restoredProjects: 1, estimatedProjects: 0 });
  });

  it('mantém a decisão de uma reunião posterior ao excluir uma reunião intermediária', async () => {
    const laterEvaluation = {
      projectId: 'project-1', decision: 'SEGUNDA_FASE', score: 9, notes: 'Decisão posterior',
      estimatedMonthlyGain: 200, estimatedMonthlyLossAvoided: 25, roiMonthly: 225,
      snapshot: { status: 6 },
      meeting: { id: 'meeting-3', meetingDate: date('2026-09-10'), createdAt: date('2026-09-10'), version: 1 },
    };
    const { controller, projectUpdate } = setup({ remainingEvaluations: [laterEvaluation] });

    await controller.deleteMeeting('meeting-2', { user: { id: 'admin', name: 'Administrador' } });

    expect(projectUpdate).toHaveBeenCalledWith({ where: { id: 'project-1' }, data: expect.objectContaining({
      status: 6, committeeDecision: 'SEGUNDA_FASE', committeeScore: 9, boardNotes: 'Decisão posterior', roiMonthly: 225,
    }) });
  });

  it('marca a restauração como estimada para uma reunião histórica sem estado anterior', async () => {
    const legacyEvent = { aggregateId: 'project-1', metadata: { after: { status: 5, estimatedMonthlyGain: 15, estimatedMonthlyLossAvoided: 5 } } };
    const { controller, projectUpdate, events } = setup({ legacyEvent });

    const result = await controller.deleteMeeting('meeting-2', { user: { id: 'admin', name: 'Administrador' } });

    expect(projectUpdate).toHaveBeenCalledWith({ where: { id: 'project-1' }, data: expect.objectContaining({ status: 5, roiMonthly: 20 }) });
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'PROJECT_COMMITTEE_STATE_RESTORED', metadata: expect.objectContaining({ estimated: true, restorationSource: 'ESTIMATED_LEGACY_STATE' }),
    }));
    expect(result).toMatchObject({ restoredProjects: 1, estimatedProjects: 1 });
  });
});
