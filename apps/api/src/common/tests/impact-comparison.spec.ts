import { describe, expect, it } from 'vitest';
import { EngineService } from '../../engine/engine.service';

describe('impact comparison portfolio dates', () => {
  it('returns the portfolio end dates and their movement in days', () => {
    const service = new EngineService({} as any);
    const result = service.compareSchedules(
      [
        { projectId: 'p1', endDate: new Date('2026-09-15T00:00:00Z'), status: 'ON_TIME' },
        { projectId: 'p2', endDate: new Date('2026-09-20T00:00:00Z'), status: 'ON_TIME' },
      ] as any,
      [
        { projectId: 'p1', endDate: new Date('2026-09-10T00:00:00Z'), status: 'ON_TIME' },
        { projectId: 'p2', endDate: new Date('2026-09-12T00:00:00Z'), status: 'ON_TIME' },
      ],
      [
        { id: 'p1', sdNumber: '1', title: 'Projeto 1' },
        { id: 'p2', sdNumber: '2', title: 'Projeto 2' },
      ],
    );

    expect(result.portfolioEndDateBefore).toBe('2026-09-12T00:00:00.000Z');
    expect(result.portfolioEndDateAfter).toBe('2026-09-20T00:00:00.000Z');
    expect(result.portfolioDifferenceDays).toBe(8);
    expect(result.portfolioDirection).toBe('POSTPONED');
  });

  it('includes projects that enter or leave the simulated schedule', () => {
    const service = new EngineService({} as any);
    const result = service.compareSchedules(
      [
        { projectId: 'new', endDate: new Date('2026-10-10T00:00:00Z'), status: 'ON_TIME' },
      ] as any,
      [
        { projectId: 'removed', endDate: new Date('2026-10-20T00:00:00Z'), status: 'ON_TIME' },
      ],
      [
        { id: 'new', sdNumber: '2', title: 'Projeto novo' },
        { id: 'removed', sdNumber: '1', title: 'Projeto concluído' },
      ],
    );

    expect(result.portfolioEndDateBefore).toBe('2026-10-20T00:00:00.000Z');
    expect(result.portfolioEndDateAfter).toBe('2026-10-10T00:00:00.000Z');
    expect(result.portfolioDifferenceDays).toBe(-10);
    expect(result.affectedProjectsCount).toBe(2);
    expect(result.fullDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: 'new', changeType: 'NEW_FORECAST', oldDate: 'Sem data' }),
      expect.objectContaining({ projectId: 'removed', changeType: 'REMOVED_FROM_SCHEDULE', newDate: 'Sem data' }),
    ]));
  });

  it('explains an unchanged portfolio end when non-critical projects move', () => {
    const service = new EngineService({} as any);
    const projects = [
      { id: 'critical', sdNumber: '429412', title: 'Projeto crítico' },
      { id: 'changed', sdNumber: '433034', title: 'Projeto alterado' },
    ];
    const baseline = {
      projects: [
        { projectId: 'critical', endDate: new Date('2027-11-03T00:00:00Z'), status: 'ON_TIME' },
        { projectId: 'changed', endDate: new Date('2027-08-01T00:00:00Z'), status: 'ON_TIME' },
      ],
      phases: [{ projectId: 'critical', projectPhaseId: 'critical-phase', phaseName: 'Golive', endDate: new Date('2027-11-03T00:00:00Z') }],
      allocations: [{ projectId: 'critical', projectPhaseId: 'critical-phase', resourceId: 'r1', date: new Date('2027-11-03T00:00:00Z'), minutesAllocated: 60 }],
    } as any;
    const proposed = {
      ...baseline,
      projects: [
        { projectId: 'critical', endDate: new Date('2027-11-03T00:00:00Z'), status: 'ON_TIME' },
        { projectId: 'changed', endDate: new Date('2027-09-01T00:00:00Z'), status: 'DELAYED' },
      ],
    } as any;

    const result = service.compareSchedules(proposed.projects, baseline.projects, projects, { baseline, proposed, resources: [{ id: 'r1', name: 'Recurso crítico' }] as any });
    expect(result.portfolioDifferenceDays).toBe(0);
    expect(result.affectedProjectsCount).toBe(1);
    expect(result.criticalPathAfter).toEqual(expect.objectContaining({ projectId: 'critical', sdNumber: '429412', phaseName: 'Golive' }));
    expect(result.portfolioEndUnchangedReason).toContain('429412');
    expect(result.message).not.toContain('ON_TIME');
    expect(result.message).not.toContain('DELAYED');
  });
});
