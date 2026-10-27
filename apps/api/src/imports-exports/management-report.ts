import { PROJECT_STATUS_LABELS } from './import-export.utils';

export const MANAGEMENT_HEADERS = ['Ordem', 'SD', 'Título', 'Departamento', 'Requisito Legal',
  'Nota Prioridade Diretoria', 'Horas Estimadas', 'Status', 'Data Conclusão', 'Recursos Alocados'];

export interface ReportProject {
  id: string; sdNumber: string; title: string; status: number; totalHours: number;
  isLegalRequirement: boolean; committeeScore: number | null;
  estimatedMonthlyGain: number | null; estimatedMonthlyLossAvoided: number | null;
  realCompletionDate: Date | null; currentSchedule?: { endDate: Date | null } | null;
  classId: string; flowTypeId: string;
  departments: { department: { name: string; code: string } }[];
  systems: { system: { id: string; name: string } }[];
}
export interface ReportAllocation {
  phase: { projectId: string }; resource: { name: string }; minutesAllocated: number;
}
export interface ReportCatalog { id: string; type: string; name: string; value: string | null; order: number | null }
export interface FinancialSummary { gain: number; loss: number; benefit: number; missing: number }

const names = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ');
const compareProject = (a: ReportProject, b: ReportProject) =>
  a.sdNumber.localeCompare(b.sdNumber, 'pt-BR', { numeric: true }) || a.id.localeCompare(b.id);

export function managementRows(projects: ReportProject[], queueIds: string[], allocations: ReportAllocation[]) {
  const positions = new Map(queueIds.map((id, index) => [id, index + 1]));
  const resources = new Map<string, string[]>();
  allocations.forEach(item => resources.set(item.phase.projectId,
    [...(resources.get(item.phase.projectId) || []), item.resource.name]));
  const sorted = [...projects].sort((a, b) => {
    const ap = positions.get(a.id); const bp = positions.get(b.id);
    if (ap != null || bp != null) return (ap ?? Infinity) - (bp ?? Infinity);
    return a.status - b.status || compareProject(a, b);
  });
  return sorted.map(project => [
    positions.get(project.id) ?? null, project.sdNumber, project.title,
    names(project.departments.map(item => item.department.name)), project.isLegalRequirement ? 'Sim' : 'Não',
    project.committeeScore ?? 0, project.totalHours, PROJECT_STATUS_LABELS[project.status] || `Status ${project.status}`,
    project.status === 7 ? project.realCompletionDate : [8, 9].includes(project.status) ? null : project.currentSchedule?.endDate ?? null,
    names(resources.get(project.id) || []),
  ]);
}

export function financialSummary(projects: ReportProject[]): FinancialSummary {
  const gain = projects.reduce((sum, project) => sum + (project.estimatedMonthlyGain ?? 0), 0);
  const loss = projects.reduce((sum, project) => sum + (project.estimatedMonthlyLossAvoided ?? 0), 0);
  return { gain, loss, benefit: gain + loss,
    missing: projects.filter(project => project.estimatedMonthlyGain == null && project.estimatedMonthlyLossAvoided == null).length };
}

export function reportDistributions(projects: ReportProject[], catalogs: ReportCatalog[]) {
  const catalogCounts = (type: string, ids: (project: ReportProject) => string[]) => catalogs
    .filter(item => item.type === type)
    .sort((a, b) => type === 'CLASS'
      ? (Number(a.value) || 0) - (Number(b.value) || 0) || a.name.localeCompare(b.name, 'pt-BR')
      : (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name, 'pt-BR'))
    .map(item => [item.name, projects.filter(project => ids(project).includes(item.id)).length] as [string, number]);
  const notes = new Map<number, number>();
  projects.forEach(project => notes.set(project.committeeScore ?? 0, (notes.get(project.committeeScore ?? 0) || 0) + 1));
  if (!notes.size) notes.set(0, 0);
  const systems = catalogCounts('SYSTEM', project => project.systems.map(item => item.system.id));
  systems.push(['Sem sistema', projects.filter(project => !project.systems.length).length]);
  return {
    classes: catalogCounts('CLASS', project => [project.classId]), systems,
    scores: [...notes.entries()].sort((a, b) => a[0] - b[0]).map(([score, count]) => [String(score), count] as [string, number]),
    flows: catalogCounts('FLOW_TYPE', project => [project.flowTypeId]),
  };
}
