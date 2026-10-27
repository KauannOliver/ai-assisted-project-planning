export type PriorityScoreBucket = {
  label: string;
  completed: number;
  homologation: number;
};

export function buildPriorityScoreDistribution(projects: Array<{ status?: number | null; score?: number | null }>): PriorityScoreBucket[] {
  const buckets: PriorityScoreBucket[] = [
    { label: 'Sem nota', completed: 0, homologation: 0 },
    ...Array.from({ length: 10 }, (_, index) => ({ label: String(index + 1), completed: 0, homologation: 0 })),
  ];

  for (const project of projects) {
    if (project.status !== 6 && project.status !== 7) continue;
    const numericScore = Number(project.score);
    const roundedScore = Number.isFinite(numericScore) ? Math.round(numericScore) : 0;
    const bucketIndex = roundedScore >= 1 && roundedScore <= 10 ? roundedScore : 0;
    if (project.status === 7) buckets[bucketIndex].completed++;
    if (project.status === 6) buckets[bucketIndex].homologation++;
  }

  return buckets;
}
