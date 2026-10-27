export interface BottleneckResourceInput {
  id: string;
  name: string;
  role: string;
  recommendedWipLimit: number;
  activeProjectIds: string[];
  allocatedMinutes: number;
  scheduledMinutes: number;
  maxDailyUtilization: number;
}

export interface ResourceBottleneck {
  id: string;
  name: string;
  role: string;
  activeProjectsCount: number;
  wipLimit: number;
  allocatedHours: number;
  scheduledHours: number;
  maxDailyUtilization: number;
  riskScore: number;
  riskLevel: 'CRITICO' | 'ATENCAO' | 'CONTROLADO';
  primaryFactor: 'PROJETOS' | 'HORAS' | 'UTILIZACAO';
}

export function buildBottleneckRanking(inputs: BottleneckResourceInput[]): ResourceBottleneck[] {
  const maxAllocatedMinutes = Math.max(1, ...inputs.map(item => item.allocatedMinutes));

  return inputs
    .map((item) => {
      const activeProjectsCount = new Set(item.activeProjectIds).size;
      const wipLimit = Math.max(1, item.recommendedWipLimit || 1);
      const projectComponent = Math.min(activeProjectsCount / wipLimit, 1) * 45;
      const hoursComponent = Math.min(item.allocatedMinutes / maxAllocatedMinutes, 1) * 35;
      const utilizationComponent = Math.min(item.maxDailyUtilization / 100, 1) * 20;
      const riskScore = Math.round(projectComponent + hoursComponent + utilizationComponent);
      const components = [
        { key: 'PROJETOS' as const, value: projectComponent },
        { key: 'HORAS' as const, value: hoursComponent },
        { key: 'UTILIZACAO' as const, value: utilizationComponent },
      ].sort((a, b) => b.value - a.value);

      return {
        id: item.id,
        name: item.name,
        role: item.role,
        activeProjectsCount,
        wipLimit,
        allocatedHours: Number((item.allocatedMinutes / 60).toFixed(1)),
        scheduledHours: Number((item.scheduledMinutes / 60).toFixed(1)),
        maxDailyUtilization: Number(item.maxDailyUtilization.toFixed(1)),
        riskScore,
        riskLevel: riskScore >= 75 ? 'CRITICO' as const : riskScore >= 50 ? 'ATENCAO' as const : 'CONTROLADO' as const,
        primaryFactor: components[0].key,
      };
    })
    .filter(item => item.activeProjectsCount > 0 || item.allocatedHours > 0)
    .sort((a, b) => b.riskScore - a.riskScore || b.allocatedHours - a.allocatedHours || a.name.localeCompare(b.name));
}
