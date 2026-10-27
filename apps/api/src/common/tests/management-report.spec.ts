import { describe, expect, it, vi } from 'vitest';
import * as ExcelJS from 'exceljs';
import { EngineService } from '../../engine/engine.service';
import { ImportsExportsController } from '../../imports-exports/imports-exports.controller';
import { financialSummary, managementRows, MANAGEMENT_HEADERS, reportDistributions, ReportProject } from '../../imports-exports/management-report';

const end = new Date('2026-12-15T00:00:00Z');
const actual = new Date('2026-08-10T00:00:00Z');
function project(id: string, overrides: Partial<ReportProject> = {}): ReportProject {
  return { id, sdNumber: id, title: `Projeto ${id}`, status: 5, totalHours: 20,
    isLegalRequirement: false, committeeScore: null, realCompletionDate: null,
    estimatedMonthlyGain: null, estimatedMonthlyLossAvoided: null, currentSchedule: { endDate: end },
    classId: 'h20', flowTypeId: 'flow', departments: [], systems: [], ...overrides };
}
const catalog = (id: string, type: string, value: string | null = null) => ({ id, name: id, type, value, order: null });

describe('management Excel data', () => {
  it('uses the effective automatic/manual queue including legal below common, then terminal groups', async () => {
    const projects = [project('legal', { isLegalRequirement: true }), project('common'),
      project('finished', { status: 7, realCompletionDate: actual }), project('returned', { status: 8 }), project('cancelled', { status: 9 })];
    const engine = new EngineService({} as any);
    const input = projects.slice(0, 2).map(p => ({ ...p, openingDate: actual, committeeDecision: 'PRIORIZADO', committeeScore: 0, businessPriorityCode: 'alta' }));
    const automatic = await engine.sortFilaAutomatic(input as any);
    expect(managementRows(projects, automatic.map(p => p.id), []).map(row => row[1])).toEqual(['legal', 'common', 'finished', 'returned', 'cancelled']);
    const manual = engine.composeManualQueue(input as any, ['common', 'legal'], automatic);
    const rows = managementRows(projects, manual.map(p => p.id), []);
    expect(rows.map(row => row[1])).toEqual(['common', 'legal', 'finished', 'returned', 'cancelled']);
    expect(rows.map(row => row[0])).toEqual([1, 2, null, null, null]);
    expect(rows.map(row => row[8])).toEqual([end, end, actual, null, null]);
  });

  it('keeps SD as text, missing dates blank, notes at zero and names unique', () => {
    const p = project('00012', { currentSchedule: null, departments: [
      { department: { name: 'TIC', code: 'TIC' } }, { department: { name: 'Compras', code: 'COM' } }, { department: { name: 'TIC', code: 'TIC' } }] });
    const allocations = ['Zé', 'Ana', 'Ana'].map(name => ({ resource: { name }, phase: { projectId: p.id }, minutesAllocated: 0 }));
    const rows = managementRows([p, project('done', { status: 7 })], [p.id], allocations);
    expect(rows[0]).toEqual([1, '00012', 'Projeto 00012', 'Compras, TIC', 'Não', 0, 20, '5. Processo de Software', null, 'Ana, Zé']);
    expect(rows[1][8]).toBeNull();
  });

  it('reconciles financials, true zero and missing data, and counts all catalog categories', () => {
    const projects = [project('a', { estimatedMonthlyGain: 100, estimatedMonthlyLossAvoided: 30, systems: [{ system: { id: 's1', name: 's1' } }, { system: { id: 's2', name: 's2' } }] }),
      project('b', { committeeScore: 0, estimatedMonthlyGain: 0, estimatedMonthlyLossAvoided: 0 }), project('c', { committeeScore: 7 })];
    expect(financialSummary(projects)).toEqual({ gain: 100, loss: 30, benefit: 130, missing: 1 });
    const d = reportDistributions(projects, [catalog('h20', 'CLASS', '20'), catalog('h4', 'CLASS', '4'), catalog('s1', 'SYSTEM'), catalog('s2', 'SYSTEM'), catalog('s3', 'SYSTEM'), catalog('flow', 'FLOW_TYPE'), catalog('unused', 'FLOW_TYPE')]);
    expect(d.classes).toEqual([['h4', 0], ['h20', 3]]);
    expect(d.systems).toEqual([['s1', 1], ['s2', 1], ['s3', 0], ['Sem sistema', 2]]);
    expect(d.scores).toEqual([['0', 2], ['7', 1]]);
    expect(d.flows).toEqual([['flow', 3], ['unused', 0]]);
  });
});

function controllerFixture() {
  const projects = [project('00001', { title: 'Título longo '.repeat(22), estimatedMonthlyGain: 100, estimatedMonthlyLossAvoided: 20 }),
    project('done', { status: 7, realCompletionDate: actual, estimatedMonthlyGain: 200, estimatedMonthlyLossAvoided: 10 }),
    project('cancelled', { status: 9, estimatedMonthlyGain: 10000 }),
    project('351708', { title: 'TO_VOLUNTARIO_DE_POSICOES_CRITICAS', estimatedMonthlyGain: 0, estimatedMonthlyLossAvoided: 0 }),
    project('331249', { title: 'AUTOMATIZACAO_DO_ACOMPANHAMENTO_DA_LIDERANCA', estimatedMonthlyGain: 0, estimatedMonthlyLossAvoided: 0 })];
  const dbProjects = projects.map(p => ({ ...p, classification: { name: 'Melhoria' }, flowType: { name: 'Normal' }, businessPriority: { name: 'Alta' }, class: { name: '20h' } }));
  const catalogs = [...Array.from({ length: 16 }, (_, i) => catalog(`h${i}`, 'CLASS', String(i))), catalog('flow', 'FLOW_TYPE')];
  const client = {
    project: { findMany: vi.fn().mockResolvedValue(dbProjects) },
    resource: { findMany: vi.fn().mockResolvedValue([]) }, projectPhaseAllocation: { findMany: vi.fn().mockResolvedValue([
      { resource: { name: 'Ana' }, phase: { projectId: '00001', name: 'Análise', executionMode: 'SEQUENTIAL', project: { sdNumber: '00001', title: 'Projeto 00001' } }, minutesAllocated: 60, order: 1 },
      { resource: { name: 'Bia' }, phase: { projectId: 'done', name: 'Análise', executionMode: 'SEQUENTIAL', project: { sdNumber: 'done', title: 'Projeto concluído' } }, minutesAllocated: 90, order: 1 },
      { resource: { name: 'Caio' }, phase: { projectId: 'cancelled', name: 'Análise', executionMode: 'SEQUENTIAL', project: { sdNumber: 'cancelled', title: 'Projeto cancelado' } }, minutesAllocated: 120, order: 1 },
    ]) },
    catalogItem: { findMany: vi.fn().mockResolvedValue(catalogs) }, currentProjectSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    resourceUnavailability: { findMany: vi.fn().mockResolvedValue([]) }, committeeMeeting: { findMany: vi.fn().mockResolvedValue([{
      meetingDate: actual, version: 1, createdBy: { name: 'Admin' }, evaluations: [{
        meetingDate: actual, decision: 'PRIORIZADO', score: 6, estimatedMonthlyGain: 6000000,
        estimatedMonthlyLossAvoided: 0, notes: 'Registro histórico', project: dbProjects[0],
      }, ...dbProjects.slice(3).map((p, index) => ({ meetingDate: actual, decision: 'PRIORIZADO', score: 6,
        estimatedMonthlyGain: index === 0 ? 6000000 : 600000, estimatedMonthlyLossAvoided: 0,
        notes: 'Registro histórico', project: p }))],
    }]) },
  };
  const engine = { getEffectivePriorityQueue: vi.fn().mockResolvedValue({ projects: [{ id: '00001' }] }) };
  return { controller: new ImportsExportsController(client as any, engine as any, {} as any), engine, client };
}

describe('export workbook contract', () => {
  it('reopens complete Excel with second management sheet, dates, filters and dynamic blocks', async () => {
    const { controller, engine } = controllerFixture();
    const workbook = await (controller as any).buildExportWorkbook('complete', (controller as any).prisma);
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(reopened.worksheets.map(s => s.name)).toEqual(['Dashboard', 'Relatório Gerencial', 'Dados do Dashboard', 'Projetos', 'Cronograma', 'Recursos', 'Alocações', 'Indisponibilidades', 'Comitê']);
    const sheet = reopened.getWorksheet('Relatório Gerencial')!;
    expect(sheet.getRow(1).values.slice(1)).toEqual(MANAGEMENT_HEADERS);
    expect(sheet.getCell('B2').value).toBe('00001');
    expect(sheet.getCell('G2').value).toBe(20); expect(sheet.getCell('F2').value).toBe(0);
    expect(sheet.getCell('I2').value).toEqual(end); expect(sheet.getCell('I3').value).toEqual(end);
    expect(sheet.getCell('I4').value).toEqual(end); expect(sheet.getCell('I5').value).toEqual(actual); expect(sheet.getCell('I6').value).toBeNull();
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1, xSplit: 2 });
    expect(sheet.autoFilter).toBe('A1:J6'); expect(sheet.getRow(2).height).toBeGreaterThan(24);
    const dashboard = reopened.getWorksheet('Dashboard')!;
    expect(dashboard.getCell('G40').value).toBe(100); expect(dashboard.getCell('S40').value).toBe(120);
    expect(dashboard.getCell('G41').value).toBe(200); expect(dashboard.getCell('S41').value).toBe(210);
    expect(dashboard.getCell('M26').value).toBe('Horas planejadas por recurso em projetos ativos');
    expect(dashboard.getCell('Q28').value).toBe(1);
    expect(dashboard.getCell('Q28').numFmt).toBe('#,##0.00');
    const source = reopened.getWorksheet('Dados do Dashboard')!;
    const activeResourceRows = source.getSheetValues().filter(row => Array.isArray(row) && row[1] === 'Horas planejadas por recurso em projetos ativos');
    expect(activeResourceRows).toEqual([expect.arrayContaining(['Horas planejadas por recurso em projetos ativos', 'Ana', 1])]);
    expect(activeResourceRows.some(row => row?.[2] === 'Bia' || row?.[2] === 'Caio')).toBe(false);
    const committee = reopened.getWorksheet('Comitê')!;
    expect(committee.getRow(1).values.slice(1, 10)).toContain('Ganho Mensal Atual');
    expect(committee.getCell('H2').value).toBe(100);
    expect(committee.getCell('I2').value).toBe(20);
    expect(committee.getCell('J2').value).toBe('Registro histórico');
    expect(committee.getCell('D3').value).toBe('351708');
    expect(committee.getCell('H3').value).toBe(0);
    expect(committee.getCell('D4').value).toBe('331249');
    expect(committee.getCell('H4').value).toBe(0);
    expect(dashboard.getCell('A63').value).toBe('h15'); expect(dashboard.getCell('A66').value).toBe('Projetos por nota da diretoria');
    expect(engine.getEffectivePriorityQueue).toHaveBeenCalledOnce();
  });

  it('keeps individual export worksheet contract without asking for the queue', async () => {
    const { controller, engine } = controllerFixture();
    const workbook = await (controller as any).buildExportWorkbook('projects', (controller as any).prisma);
    expect(workbook.worksheets.map(s => s.name)).toEqual(['Projetos']);
    expect(engine.getEffectivePriorityQueue).not.toHaveBeenCalled();
  });

  it('shows current project financials in the individual committee export while keeping meeting context', async () => {
    const { controller } = controllerFixture();
    const workbook = await (controller as any).buildExportWorkbook('committee', (controller as any).prisma);
    const sheet = workbook.getWorksheet('Comitê')!;
    expect(sheet.getCell('H2').value).toBe(100);
    expect(sheet.getCell('I2').value).toBe(20);
    expect(sheet.getCell('F2').value).toBe('Priorizado');
    expect(sheet.getCell('G2').value).toBe(6);
    expect(sheet.getCell('J2').value).toBe('Registro histórico');
    expect(sheet.getCell('D3').value).toBe('351708');
    expect(sheet.getCell('H3').value).toBe(0);
    expect(sheet.getCell('D4').value).toBe('331249');
    expect(sheet.getCell('H4').value).toBe(0);
  });

  it('reads the complete report in repeatable-read transaction', async () => {
    const { controller, client } = controllerFixture();
    const transaction = vi.fn(async callback => callback(client));
    (controller as any).prisma.$transaction = transaction;
    (controller as any).sendWorkbook = vi.fn();
    await controller.exportData('complete', {} as any);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead', timeout: 60000 });
  });
});
