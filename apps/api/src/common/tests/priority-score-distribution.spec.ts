import { describe, expect, it } from 'vitest';
import { buildPriorityScoreDistribution } from '../../committee/priority-score-distribution';

describe('committee priority score distribution', () => {
  it('separates completed and homologation projects, including projects without a score', () => {
    const distribution = buildPriorityScoreDistribution([
      { status: 7, score: null },
      { status: 7, score: 1 },
      { status: 7, score: 10 },
      { status: 6, score: undefined },
      { status: 6, score: 1 },
      { status: 6, score: 2 },
      { status: 5, score: 1 },
    ]);

    expect(distribution).toHaveLength(11);
    expect(distribution[0]).toMatchObject({ label: 'Sem nota', completed: 1, homologation: 1 });
    expect(distribution[1]).toMatchObject({ label: '1', completed: 1, homologation: 1 });
    expect(distribution[2]).toMatchObject({ label: '2', completed: 0, homologation: 1 });
    expect(distribution[10]).toMatchObject({ label: '10', completed: 1, homologation: 0 });
  });
});
