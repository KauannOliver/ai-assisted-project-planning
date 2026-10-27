import { describe, expect, it } from 'vitest';
import { buildBottleneckRanking } from '../../dashboards/bottleneck-analysis';

describe('resource bottleneck ranking', () => {
  it('prioritizes resources with more concurrent projects, hours and utilization', () => {
    const ranking = buildBottleneckRanking([
      {
        id: 'busy', name: 'Recurso Crítico', role: 'Desenvolvedor', recommendedWipLimit: 3,
        activeProjectIds: ['p1', 'p2', 'p3', 'p3'], allocatedMinutes: 12000,
        scheduledMinutes: 10800, maxDailyUtilization: 100,
      },
      {
        id: 'light', name: 'Recurso Disponível', role: 'Analista', recommendedWipLimit: 4,
        activeProjectIds: ['p4'], allocatedMinutes: 1200,
        scheduledMinutes: 900, maxDailyUtilization: 35,
      },
    ]);

    expect(ranking[0].id).toBe('busy');
    expect(ranking[0].activeProjectsCount).toBe(3);
    expect(ranking[0].allocatedHours).toBe(200);
    expect(ranking[0].riskLevel).toBe('CRITICO');
    expect(ranking[1].riskScore).toBeLessThan(ranking[0].riskScore);
  });
});
