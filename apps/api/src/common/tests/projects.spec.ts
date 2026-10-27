import { describe, it, expect, vi } from 'vitest';
import { ProjectsController } from '../../projects/projects.controller';

describe('Projects and Allocations Business Rules (Modules 05 & 06)', () => {
  const mockPhases = [
    { id: '1', name: 'Gestão de Projetos', value: '5', order: 1 },
    { id: '2', name: 'Levantamento', value: '10', order: 2 },
    { id: '3', name: 'Arquitetura', value: '10', order: 3 },
    { id: '4', name: 'Design', value: '10', order: 4 },
    { id: '5', name: 'Desenvolvimento', value: '40', order: 5 },
    { id: '6', name: 'Qualidade', value: '10', order: 6 },
    { id: '7', name: 'Entrega/Aplicação', value: '2.5', order: 7 },
    { id: '8', name: 'Homologação', value: '10', order: 8 },
    { id: '9', name: 'Golive', value: '2.5', order: 9 },
  ];

  describe('Phase scaling and residue (calculatePhaseMinutes)', () => {
    it('should split exactly 80 hours (4800 minutes) without residue', () => {
      const result = ProjectsController.calculatePhaseMinutes(80, mockPhases);
      
      const totalSum = result.reduce((acc, p) => acc + p.totalMinutes, 0);
      expect(totalSum).toBe(4800);

      // Gestão de Projetos (5%) = 240 mins
      const gp = result.find(p => p.name === 'Gestão de Projetos');
      expect(gp?.totalMinutes).toBe(240);

      // Desenvolvimento (40%) = 1920 mins
      const dev = result.find(p => p.name === 'Desenvolvimento');
      expect(dev?.totalMinutes).toBe(1920);
    });

    it('should split 41 hours (2460 minutes) and apply residue to Desenvolvimento', () => {
      // GP: 5% of 2460 = 123
      // Lev: 10% = 246
      // Arq: 10% = 246
      // Des: 10% = 246
      // Dev: 40% = 984
      // QA: 10% = 246
      // Ent: 2.5% = 61
      // Hom: 10% = 246
      // Go: 2.5% = 61
      // Raw Sum: 123 + 246 + 246 + 246 + 984 + 246 + 61 + 246 + 61 = 2459
      // Residue = 2460 - 2459 = 1 minute
      // Desenvolvimento should absorb this and become 985 minutes.
      
      const result = ProjectsController.calculatePhaseMinutes(41, mockPhases);
      const totalSum = result.reduce((acc, p) => acc + p.totalMinutes, 0);
      expect(totalSum).toBe(2460);

      const dev = result.find(p => p.name === 'Desenvolvimento');
      expect(dev?.totalMinutes).toBe(985);
    });
  });

  describe('Resource splits and residue (calculateResourceSplit)', () => {
    it('should divide 100 minutes equally among 3 resources, giving residue to first resource', () => {
      const resourceIds = ['alice', 'bob', 'charlie'];
      const result = ProjectsController.calculateResourceSplit(100, resourceIds, 'SIMULTANEOUS');

      expect(result.length).toBe(3);
      // Sum should equal exactly 100
      const sum = result.reduce((acc, r) => acc + r.minutesAllocated, 0);
      expect(sum).toBe(100);

      // 100 / 3 = 33 with residue 1. First gets 34, others get 33
      expect(result[0].resourceId).toBe('alice');
      expect(result[0].minutesAllocated).toBe(34);
      expect(result[0].order).toBe(1);

      expect(result[1].resourceId).toBe('bob');
      expect(result[1].minutesAllocated).toBe(33);
      expect(result[1].order).toBe(2);

      expect(result[2].resourceId).toBe('charlie');
      expect(result[2].minutesAllocated).toBe(33);
      expect(result[2].order).toBe(3);
    });

    it('should split sequentially and order resources based on user preferred order', () => {
      const resourceIds = ['alice', 'bob', 'charlie'];
      const preferredOrder = ['bob', 'charlie', 'alice'];
      
      const result = ProjectsController.calculateResourceSplit(100, resourceIds, 'SEQUENTIAL', preferredOrder);
      
      expect(result.length).toBe(3);
      
      // Verification of new ordering
      expect(result[0].resourceId).toBe('bob');
      expect(result[0].minutesAllocated).toBe(34); // Absorbs residue as first in the sequential list
      expect(result[0].order).toBe(1);

      expect(result[1].resourceId).toBe('charlie');
      expect(result[1].minutesAllocated).toBe(33);
      expect(result[1].order).toBe(2);

      expect(result[2].resourceId).toBe('alice');
      expect(result[2].minutesAllocated).toBe(33);
      expect(result[2].order).toBe(3);
    });
  });
});

describe('exclusão permanente de projeto', () => {
  it('remove dependências derivadas, apaga o projeto e recalcula o cronograma na mesma transação', async () => {
    const project = {
      id: 'project-1', sdNumber: '123', title: 'Projeto', requester: 'Solicitante', status: 5,
      departments: [{ department: { code: 'TIC' } }], systems: [{ system: { code: 'SYS' } }],
      phases: [{ allocations: [{ id: 'allocation-1' }] }], deliveries: [], plannedDeliveries: [], committeeEvaluations: [], currentSchedule: null,
    };
    const projectDelete = vi.fn();
    const tx: any = {
      priorityQueueState: { findUnique: vi.fn().mockResolvedValue({ manualOrder: '["project-1"]' }), update: vi.fn() },
      scheduleRunAllocation: { deleteMany: vi.fn() }, scheduleRunPhase: { deleteMany: vi.fn() }, scheduleRunProject: { deleteMany: vi.fn() },
      currentResourceAllocation: { deleteMany: vi.fn() }, currentEngineWarning: { deleteMany: vi.fn() }, project: { delete: projectDelete },
    };
    const engine: any = {
      runProposedSimulation: vi.fn().mockResolvedValue({ simulation: { portfolioEndDate: null }, comparison: { affectedProjectsCount: 2 }, stateHash: 'hash' }),
      persistSchedule: vi.fn(),
    };
    const events: any = { record: vi.fn() };
    const prisma: any = {
      project: { findUnique: vi.fn().mockResolvedValue(project) },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const controller = new ProjectsController(prisma, engine, events);
    const result = await controller.permanentlyDelete('project-1', { user: { id: 'admin', name: 'Administrador' } });
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: 'project-1' } });
    expect(engine.persistSchedule).toHaveBeenCalledWith(tx, expect.anything(), expect.objectContaining({ triggerType: 'PROJECT_PERMANENTLY_DELETED' }));
    expect(events.record).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'PROJECT_PERMANENTLY_DELETED' }));
    expect(result.comparison.affectedProjectsCount).toBe(2);
  });
});

describe('transições entre Homologação e Concluído', () => {
  const baseProject = {
    id: 'project-status', sdNumber: 'SD-STATUS', title: 'Projeto', requester: 'Solicitante',
    openingDate: new Date('2026-08-01T00:00:00.000Z'), requestedDeadline: null,
    realCompletionDate: new Date('2026-08-20T00:00:00.000Z'),
    classificationId: 'classification', flowTypeId: 'flow', businessPriorityId: 'priority', classId: 'class',
    totalHours: 60, isLegalRequirement: false, status: 7,
    estimatedMonthlyGain: 0, estimatedMonthlyLossAvoided: 0, projectManagerNotes: null,
    departments: [],
  };

  it('reabre o projeto, limpa a data de conclusão e amplia a transação do recálculo', async () => {
    const updated = { ...baseProject, status: 6, realCompletionDate: null };
    const tx: any = { project: { update: vi.fn().mockResolvedValue(updated) }, projectPhase: { findMany: vi.fn().mockResolvedValue([
      { id: 'phase', phaseId: 'dev', name: 'Desenvolvimento', percentage: 100, order: 1, totalMinutes: 3600, executionMode: 'SIMULTANEOUS', allocations: [] },
    ]) } };
    const engine: any = {
      runProposedSimulation: vi.fn().mockResolvedValue({ simulation: {}, stateHash: 'hash' }),
      persistSchedule: vi.fn(),
    };
    const events: any = { record: vi.fn() };
    const transaction = vi.fn(async (callback: any) => callback(tx));
    const prisma: any = {
      project: { findUnique: vi.fn().mockResolvedValue(baseProject) },
      $transaction: transaction,
    };

    const controller = new ProjectsController(prisma, engine, events);
    const result = await controller.updateConfirm('project-status', { user: { id: 'admin', name: 'Administrador' } }, { status: 6 } as any);

    expect(tx.project.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-status' },
      data: expect.objectContaining({ status: 6, realCompletionDate: null }),
    }));
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 120000 });
    expect(events.record).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'PROJECT_REOPENED' }));
    expect(result.status).toBe(6);
  });

  it('conclui usando data civil e amplia a transação do recálculo', async () => {
    const homologationProject = { ...baseProject, status: 6, realCompletionDate: null };
    const updated = { ...homologationProject, status: 7, realCompletionDate: new Date('2026-08-21T00:00:00.000Z') };
    const tx: any = { project: { update: vi.fn().mockResolvedValue(updated) } };
    const engine: any = {
      runProposedSimulation: vi.fn().mockResolvedValue({ simulation: {}, stateHash: 'hash' }),
      persistSchedule: vi.fn(),
    };
    const transaction = vi.fn(async (callback: any) => callback(tx));
    const prisma: any = {
      project: { findUnique: vi.fn().mockResolvedValue(homologationProject) },
      $transaction: transaction,
    };
    const controller = new ProjectsController(prisma, engine, { record: vi.fn() } as any);

    const result = await controller.completeConfirm('project-status', { user: { id: 'admin', name: 'Administrador' } }, { realCompletionDate: '2026-08-21' });

    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'project-status' },
      data: { status: 7, realCompletionDate: new Date('2026-08-21T00:00:00.000Z') },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 120000 });
    expect(result.status).toBe(7);
  });
});
