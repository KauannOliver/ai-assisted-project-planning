import {
  BadRequestException, Body, Controller, Get, Param, Post, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { CatalogType, UnavailabilityType, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';
import { BusinessEventsService } from '../history-alerts/business-events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  catalogDisplayValue, COMMITTEE_DECISION_LABELS, dateOnlyKey,
  EXECUTION_MODE_LABELS, formatCivilDatePtBr, IMPORT_TYPE_LABELS,
  normalizeHeader, normalizeText, parseCivilDate, parseProjectStatus,
  PROJECT_STATUS_LABELS, resolveCatalogItem, resolveFriendlyEnum,
  sameStringSet, sanitizeNaturalLanguage, SCHEDULE_STATUS_LABELS, splitMultiValues,
  UNAVAILABILITY_TYPE_LABELS, USER_STATUS_LABELS,
} from './import-export.utils';
import {
  CommitteeImportRow, committeeFileIdentity, parseCommitteeDecision,
  parseImportNumber, resolveCommitteeProject,
} from '../committee/committee-import.utils';
import { financialSummary, managementRows, MANAGEMENT_HEADERS, reportDistributions } from './management-report';

import { calculatePhaseMinutes, calculateResourceSplit, normalizeProjectEffort, reconcileProjectEffort } from '../projects/project-effort';

type ImportMode = 'create_only' | 'upsert';
type ImportType = 'projects' | 'allocations' | 'unavailabilities' | 'committee';
type ParsedRow = { __line: number; [key: string]: any };

const HEADER_ALIASES: Record<ImportType, Record<string, string[]>> = {
  projects: {
    sd: ['SD', 'Número SD', 'Número da Solicitação', 'Solicitação'],
    title: ['Título', 'Título do Projeto', 'Projeto'], requester: ['Solicitante'],
    departments: ['Departamentos', 'Departamento'], systems: ['Sistemas', 'Sistema'],
    openingDate: ['Data Abertura', 'Abertura', 'Data de Abertura'], deadline: ['Prazo Solicitado', 'Prazo'],
    status: ['Status', 'Estágio'], classification: ['Classificação'], flow: ['Fluxo', 'Tipo de Fluxo'],
    priority: ['Prioridade', 'Prioridade de Negócio'], projectClass: ['Classe'], legal: ['Requisito Legal', 'Legal'],
    gain: ['Ganho Estimado', 'Ganho Mensal'], loss: ['Prejuízo Evitado', 'Prejuízo Evitado Mensal'],
    problem: ['Descrição Problema', 'Descrição do Problema'], objective: ['Objetivo'],
    currentProcess: ['Processo Atual'], desiredProcess: ['Processo Desejado'],
  },
  allocations: {
    sd: ['SD', 'Número SD', 'Solicitação'], phase: ['Fase'], resource: ['Recurso'],
    executionMode: ['Modo Execução', 'Modo de Execução', 'Execução'], order: ['Ordem'],
  },
  unavailabilities: {
    resource: ['Recurso'], type: ['Tipo'], start: ['Início', 'Data Início'], end: ['Fim', 'Data Fim'],
    hours: ['Horas por Dia', 'Horas'], global: ['Global'], recurring: ['Recorrente'], notes: ['Observação', 'Descrição'],
  },
  committee: {
    meetingDate: ['Data da Reunião', 'Data Reunião', 'Data'],
    meetingNotes: ['Observação da Reunião', 'Observações da Reunião', 'Ata', 'Observação Geral'],
    sd: ['Projeto (SD)', 'Projeto', 'SD', 'Número SD', 'Solicitação'],
    decision: ['Decisão', 'Parecer do Comitê'], score: ['Nota da Diretoria', 'Nota', 'Prioridade da Diretoria'],
    projectNotes: ['Parecer do Projeto', 'Parecer', 'Observação do Projeto'],
    gain: ['Ganho Mensal Estimado', 'Ganho Mensal', 'Ganho Estimado'],
    loss: ['Prejuízo Mensal Evitado', 'Prejuízo Evitado Mensal', 'Prejuízo Evitado'],
  },
};

const REQUIRED_FIELDS: Record<ImportType, string[]> = {
  projects: ['sd', 'title', 'requester', 'departments', 'systems', 'openingDate', 'status', 'classification', 'flow', 'priority', 'projectClass'],
  allocations: ['sd', 'phase', 'resource', 'executionMode'],
  unavailabilities: ['resource', 'type', 'start', 'end', 'global'],
  committee: ['meetingDate', 'sd', 'decision'],
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ImportsExportsController {
  constructor(
    private prisma: PrismaService,
    private engineService: EngineService,
    private events: BusinessEventsService,
  ) {}

  private parseCSV(text: string): string[][] {
    const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = firstLine.includes(';') ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i++; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === delimiter && !quoted) { row.push(value.trim()); value = ''; continue; }
      if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(value.trim()); value = '';
        if (row.some(cell => cell.length > 0)) rows.push(row);
        row = []; continue;
      }
      value += char;
    }
    row.push(value.trim()); if (row.some(cell => cell.length > 0)) rows.push(row);
    if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
    return rows;
  }

  private yes(value?: string) {
    return ['sim', 's', 'yes', 'true', '1'].includes(normalizeText(value));
  }

  private parseRows(type: ImportType, csvText: string): { rows: ParsedRow[]; missingHeaders: string[] } {
    const matrix = this.parseCSV(csvText);
    if (!matrix.length) return { rows: [], missingHeaders: REQUIRED_FIELDS[type] };
    const aliases = HEADER_ALIASES[type];
    const normalizedHeaders = matrix[0].map(normalizeHeader);
    const indexes: Record<string, number> = {};
    Object.entries(aliases).forEach(([field, candidates]) => {
      const candidateKeys = candidates.map(normalizeHeader);
      indexes[field] = normalizedHeaders.findIndex(header => candidateKeys.includes(header));
    });
    const missingHeaders = REQUIRED_FIELDS[type].filter(field => indexes[field] < 0);
    const rows = matrix.slice(1).filter(row => row.some(Boolean)).map((row, index) => {
      const parsed: ParsedRow = { __line: index + 2 };
      Object.keys(aliases).forEach(field => { parsed[field] = indexes[field] >= 0 ? String(row[indexes[field]] ?? '').trim() : ''; });
      return parsed;
    });
    return { rows, missingHeaders };
  }

  private cellText(value: ExcelJS.CellValue): string {
    if (value == null) return '';
    if (value instanceof Date) return formatCivilDatePtBr(value);
    if (typeof value === 'object') {
      if ('text' in value) return String(value.text || '');
      if ('result' in value) return String(value.result || '');
      if ('richText' in value) return value.richText.map(part => part.text).join('');
    }
    return String(value);
  }

  private addWorksheet(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: any[][] = []) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
    sheet.addRow(headers); rows.forEach(row => sheet.addRow(row));
    const header = sheet.getRow(1); header.height = 30;
    header.eachCell(cell => {
      cell.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF212A57' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    sheet.columns.forEach((column, index) => {
      const longest = Math.max(headers[index]?.length || 10, ...rows.slice(0, 200).map(row => String(row[index] ?? '').length));
      column.width = Math.min(42, Math.max(12, longest + 2));
    });
    sheet.eachRow((row, number) => {
      if (number > 1) {
        row.height = 22;
        row.alignment = { vertical: 'middle' };
        if (number % 2 === 1) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8FC' } }; });
      }
    });
    return sheet;
  }

  private styleDateColumns(sheet: ExcelJS.Worksheet, columns: number[]) {
    columns.forEach(column => { sheet.getColumn(column).numFmt = 'dd/mm/yyyy'; });
  }

  private addList(sheet: ExcelJS.Worksheet, column: number, title: string, values: string[]) {
    const col = sheet.getColumn(column); col.hidden = true;
    sheet.getCell(1, column).value = title;
    values.forEach((value, index) => { sheet.getCell(index + 2, column).value = value; });
    return `$${col.letter}$2:$${col.letter}$${Math.max(2, values.length + 1)}`;
  }

  private applyListValidation(sheet: ExcelJS.Worksheet, column: number, formula: string, allowBlank = false) {
    for (let row = 2; row <= 1000; row++) {
      sheet.getCell(row, column).dataValidation = {
        type: 'list', allowBlank, formulae: [formula], showErrorMessage: true,
        errorTitle: 'Valor não reconhecido', error: 'Escolha uma opção disponível na lista.',
      };
    }
  }

  private addInstructions(workbook: ExcelJS.Workbook, title: string, lines: string[]) {
    const sheet = workbook.addWorksheet('Instruções', { views: [{ showGridLines: false }] });
    sheet.mergeCells('A1:H2'); sheet.getCell('A1').value = title;
    sheet.getCell('A1').font = { name: 'Aptos Display', bold: true, size: 20, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').alignment = { vertical: 'middle' };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF212A57' } };
    lines.forEach((line, index) => {
      const row = index + 4; sheet.mergeCells(row, 1, row, 8); sheet.getCell(row, 1).value = line;
      sheet.getCell(row, 1).font = { name: 'Aptos', size: 11, color: { argb: index === 0 ? 'FF212A57' : 'FF46516B' }, bold: index === 0 };
      sheet.getCell(row, 1).alignment = { vertical: 'middle', wrapText: true }; sheet.getRow(row).height = index === 0 ? 26 : 34;
    });
    sheet.columns.forEach(column => { column.width = 15; });
    return sheet;
  }

  private addCatalogSheet(workbook: ExcelJS.Workbook, groups: Array<{ group: string; items: Array<{ code: string; name: string }> }>) {
    const rows = groups.flatMap(group => group.items.map(item => [group.group, item.code, item.name, catalogDisplayValue(item)]));
    const sheet = this.addWorksheet(workbook, 'Cadastros disponíveis', ['Cadastro', 'Código', 'Nome', 'Valor aceito na importação'], rows);
    sheet.getColumn(1).width = 24; sheet.getColumn(2).width = 18; sheet.getColumn(3).width = 42; sheet.getColumn(4).width = 58;
    return sheet;
  }

  private async sendWorkbook(res: Response, workbook: ExcelJS.Workbook, filename: string) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const buffer = await workbook.xlsx.writeBuffer(); res.end(Buffer.from(buffer));
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('imports/:type/parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async parseSpreadsheet(@Param('type') rawType: string, @UploadedFile() file?: any) {
    const type = rawType as ImportType;
    if (!Object.keys(HEADER_ALIASES).includes(type)) throw new BadRequestException('Tipo de importação inválido.');
    if (!file) throw new BadRequestException('Arquivo não enviado.');
    const extension = String(file.originalname).toLowerCase().split('.').pop();
    if (extension === 'csv' || extension === 'txt') {
      const csvText = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
      return { csvText, fileName: file.originalname, sheetName: null, rows: Math.max(0, this.parseCSV(csvText).length - 1), warnings: [] };
    }
    if (extension !== 'xlsx') throw new BadRequestException('Envie um arquivo XLSX ou CSV.');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(file.buffer);
    const expected = { projects: 'Projetos', allocations: 'Alocações', unavailabilities: 'Indisponibilidades', committee: 'Comitê' }[type];
    const sheet = workbook.worksheets.find(item => normalizeText(item.name) === normalizeText(expected)) || workbook.worksheets.find(item => normalizeText(item.name) !== 'instrucoes');
    if (!sheet) throw new BadRequestException('A planilha não possui uma aba de dados legível.');
    const output: string[] = []; const visibleColumnCount = Object.keys(HEADER_ALIASES[type]).length;
    sheet.eachRow({ includeEmpty: false }, row => {
      const values: string[] = [];
      for (let col = 1; col <= visibleColumnCount; col++) {
        const cell = this.cellText(row.getCell(col).value).replace(/"/g, '""');
        values.push(cell.includes(';') || cell.includes('\n') ? `"${cell}"` : cell);
      }
      if (values.some(value => value.length > 0)) output.push(values.join(';'));
    });
    return {
      csvText: output.join('\n'), fileName: file.originalname, sheetName: sheet.name,
      rows: Math.max(0, output.length - 1), warnings: sheet.name === expected ? [] : [`A aba ${sheet.name} foi utilizada como fonte de dados.`],
    };
  }

  @Get('imports/templates/:type')
  async getTemplate(@Param('type') rawType: string, @Res() res: Response) {
    const type = rawType as ImportType;
    if (!Object.keys(HEADER_ALIASES).includes(type)) throw new BadRequestException('Modelo inválido.');
    const [catalogs, departments, resources, projects] = await Promise.all([
      this.prisma.catalogItem.findMany({ where: { status: UserStatus.ACTIVE }, orderBy: [{ type: 'asc' }, { order: 'asc' }, { name: 'asc' }] }),
      this.prisma.department.findMany({ where: { status: UserStatus.ACTIVE }, orderBy: { code: 'asc' } }),
      this.prisma.resource.findMany({ where: { status: UserStatus.ACTIVE }, orderBy: { name: 'asc' } }),
      this.prisma.project.findMany({ include: { phases: true }, orderBy: { sdNumber: 'asc' } }),
    ]);
    const byType = (catalogType: CatalogType) => catalogs.filter(item => item.type === catalogType);
    const workbook = new ExcelJS.Workbook(); workbook.creator = 'TIC - Gestão de Projetos'; workbook.created = new Date();
    const commonInstructions = [
      'Preencha somente a aba de dados e não altere os nomes dos cabeçalhos.',
      'Campos com uma opção possuem listas suspensas alimentadas pelos cadastros atuais.',
      'Consulte a aba “Cadastros disponíveis” sempre que precisar confirmar os valores aceitos.',
      'Antes de salvar, remova a linha de exemplo caso ela não faça parte da importação.',
    ];
    this.addInstructions(workbook, `Modelo de importação de ${IMPORT_TYPE_LABELS[type]}`, type === 'committee' ? [
      'IMPORTANTE: cada arquivo representa uma única reunião; use uma linha para cada projeto efetivamente avaliado.',
      'Repita a mesma Data da Reunião em todas as linhas. A Observação da Reunião pode ser repetida ou informada apenas na primeira linha.',
      'Escolha o projeto e a decisão nas listas. A nota da diretoria deve ser um número inteiro entre 1 e 10.',
      'Informe o parecer individual e, quando aplicável, os valores mensais de ganho e prejuízo evitado.',
      'No modo “Criar somente”, uma reunião já existente na mesma data será rejeitada. No modo “Atualizar ou criar”, ela será atualizada sem duplicação.',
      'A confirmação atualiza os projetos avaliados, registra a auditoria e recalcula o cronograma em uma única transação.',
      ...commonInstructions,
    ] : [
      ...commonInstructions,
      'Use datas no formato dd/mm/aaaa. O prazo solicitado pode ficar em branco.',
      'Departamentos e sistemas podem receber vários códigos separados por vírgula, por exemplo: TIC,COM.',
    ]);

    let sheet: ExcelJS.Worksheet;
    if (type === 'projects') {
      const classifications = byType(CatalogType.CLASSIFICATION); const flows = byType(CatalogType.FLOW_TYPE);
      const priorities = byType(CatalogType.BUSINESS_PRIORITY); const classes = byType(CatalogType.CLASS); const systems = byType(CatalogType.SYSTEM);
      sheet = this.addWorksheet(workbook, 'Projetos', ['SD','Título','Solicitante','Departamentos','Sistemas','Data Abertura','Prazo Solicitado','Status','Classificação','Fluxo','Prioridade','Classe','Requisito Legal','Ganho Estimado','Prejuízo Evitado','Descrição Problema','Objetivo','Processo Atual','Processo Desejado'], [[
        'SD-MODELO-001','Projeto de exemplo','Solicitante de exemplo',departments[0]?.code || '',systems[0]?.code || '',new Date(),null,PROJECT_STATUS_LABELS[1],
        classifications[0]?.name || '', flows[0]?.name || '', priorities[0]?.name || '', classes[0]?.name || '', 'Não',0,0,
        'Descreva o problema','Descreva o objetivo','Descreva o processo atual','Descreva o processo desejado',
      ]]);
      this.styleDateColumns(sheet, [6, 7]);
      sheet.getCell('D1').note = 'Informe um ou mais códigos separados por vírgula. Consulte a aba Cadastros disponíveis.';
      sheet.getCell('E1').note = 'Informe um ou mais códigos separados por vírgula. Consulte a aba Cadastros disponíveis.';
      const statusList = this.addList(sheet, 27, 'Status', Object.values(PROJECT_STATUS_LABELS));
      const classificationList = this.addList(sheet, 28, 'Classificações', classifications.map(item => item.name));
      const flowList = this.addList(sheet, 29, 'Fluxos', flows.map(item => item.name));
      const priorityList = this.addList(sheet, 30, 'Prioridades', priorities.map(item => item.name));
      const classList = this.addList(sheet, 31, 'Classes', classes.map(item => item.name));
      const yesNoList = this.addList(sheet, 32, 'Sim ou Não', ['Sim','Não']);
      [[8,statusList],[9,classificationList],[10,flowList],[11,priorityList],[12,classList],[13,yesNoList]].forEach(([column, formula]) => this.applyListValidation(sheet, column as number, formula as string));
      this.addCatalogSheet(workbook, [
        { group: 'Departamentos', items: departments }, { group: 'Sistemas', items: systems },
        { group: 'Classificações', items: classifications }, { group: 'Fluxos', items: flows },
        { group: 'Prioridades', items: priorities }, { group: 'Classes', items: classes },
      ]);
    } else if (type === 'allocations') {
      const phases = [...new Set(projects.flatMap(project => project.phases.map(phase => phase.name)))].sort();
      sheet = this.addWorksheet(workbook, 'Alocações', ['SD','Fase','Recurso','Modo Execução','Ordem'], [[projects[0]?.sdNumber || '',projects[0]?.phases[0]?.name || phases[0] || '',resources[0]?.name || '',EXECUTION_MODE_LABELS.SIMULTANEOUS,1]]);
      const sdList = this.addList(sheet, 27, 'Projetos', projects.map(project => project.sdNumber));
      const phaseList = this.addList(sheet, 28, 'Fases', phases); const resourceList = this.addList(sheet, 29, 'Recursos', resources.map(resource => resource.name));
      const modeList = this.addList(sheet, 30, 'Modos', Object.values(EXECUTION_MODE_LABELS));
      [[1,sdList],[2,phaseList],[3,resourceList],[4,modeList]].forEach(([column, formula]) => this.applyListValidation(sheet, column as number, formula as string));
      this.addCatalogSheet(workbook, [
        { group: 'Projetos', items: projects.map(project => ({ code: project.sdNumber, name: project.title })) },
        { group: 'Fases', items: phases.map(name => ({ code: name, name })) },
        { group: 'Recursos', items: resources.map(resource => ({ code: resource.name, name: resource.name })) },
      ]);
    } else if (type === 'unavailabilities') {
      const start = new Date(); start.setUTCDate(start.getUTCDate() + 30); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 4);
      sheet = this.addWorksheet(workbook, 'Indisponibilidades', ['Recurso','Tipo','Início','Fim','Horas por Dia','Global','Recorrente','Observação'], [[resources[0]?.name || '',UNAVAILABILITY_TYPE_LABELS.FERIAS,start,end,'','Não','Não','Exemplo de indisponibilidade']]);
      this.styleDateColumns(sheet, [3, 4]);
      const resourceList = this.addList(sheet, 27, 'Recursos', ['GLOBAL', ...resources.map(resource => resource.name)]);
      const typeList = this.addList(sheet, 28, 'Tipos', Object.values(UNAVAILABILITY_TYPE_LABELS));
      const yesNoList = this.addList(sheet, 29, 'Sim ou Não', ['Sim','Não']);
      this.applyListValidation(sheet, 1, resourceList); this.applyListValidation(sheet, 2, typeList);
      this.applyListValidation(sheet, 6, yesNoList); this.applyListValidation(sheet, 7, yesNoList);
      this.addCatalogSheet(workbook, [
        { group: 'Recursos', items: resources.map(resource => ({ code: resource.name, name: resource.name })) },
        { group: 'Tipos de indisponibilidade', items: Object.entries(UNAVAILABILITY_TYPE_LABELS).map(([code, name]) => ({ code, name })) },
      ]);
    } else {
      const exampleProject = projects[0];
      const exampleDate = parseCivilDate(dateOnlyKey(new Date()));
      sheet = this.addWorksheet(workbook, 'Comitê', [
        'Data da Reunião', 'Observação da Reunião', 'Projeto (SD)', 'Decisão',
        'Nota da Diretoria', 'Parecer do Projeto', 'Ganho Mensal Estimado', 'Prejuízo Mensal Evitado',
      ], [[
        exampleDate, 'Reunião ordinária do comitê',
        exampleProject ? `${exampleProject.sdNumber} — ${exampleProject.title}` : '',
        COMMITTEE_DECISION_LABELS.PRIORIZADO, 8, 'Projeto aprovado para priorização.', 0, 0,
      ]]);
      this.styleDateColumns(sheet, [1]);
      sheet.getColumn(5).numFmt = '0';
      sheet.getColumn(7).numFmt = 'R$ #,##0.00';
      sheet.getColumn(8).numFmt = 'R$ #,##0.00';
      sheet.getCell('A1').note = 'Use a mesma data em todas as linhas. Formato: dd/mm/aaaa.';
      sheet.getCell('B1').note = 'Observação geral da ata. Pode ser informada somente na primeira linha ou repetida de forma idêntica.';
      sheet.getCell('C1').note = 'Selecione o projeto pelo número da solicitação e título.';
      sheet.getCell('E1').note = 'Número inteiro entre 1 e 10.';
      const projectList = this.addList(sheet, 27, 'Projetos', projects.map(project => `${project.sdNumber} — ${project.title}`));
      const decisionList = this.addList(sheet, 28, 'Decisões', [
        COMMITTEE_DECISION_LABELS.PRIORIZADO,
        COMMITTEE_DECISION_LABELS.SEGUNDA_FASE,
        COMMITTEE_DECISION_LABELS.CANCELADO,
      ]);
      this.applyListValidation(sheet, 3, projectList);
      this.applyListValidation(sheet, 4, decisionList);
      for (let row = 2; row <= 1000; row++) {
        sheet.getCell(row, 5).dataValidation = {
          type: 'whole', operator: 'between', allowBlank: false, formulae: [1, 10],
          showErrorMessage: true, errorTitle: 'Nota inválida', error: 'Informe um número inteiro entre 1 e 10.',
        };
      }
      this.addCatalogSheet(workbook, [
        { group: 'Projetos', items: projects.map(project => ({ code: project.sdNumber, name: project.title })) },
        { group: 'Decisões do comitê', items: [
          { code: 'PRIORIZADO', name: COMMITTEE_DECISION_LABELS.PRIORIZADO },
          { code: 'SEGUNDA_FASE', name: COMMITTEE_DECISION_LABELS.SEGUNDA_FASE },
          { code: 'CANCELADO', name: COMMITTEE_DECISION_LABELS.CANCELADO },
        ] },
      ]);
    }
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 1, showGridLines: false }];
    await this.sendWorkbook(res, workbook, `modelo_${type}.xlsx`);
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('imports/:type/validate')
  async validateImport(@Param('type') rawType: string, @Body() body: any) {
    const type = rawType as ImportType;
    if (!Object.keys(HEADER_ALIASES).includes(type)) throw new BadRequestException('Tipo de importação inválido.');
    const mode: ImportMode = body.mode === 'upsert' ? 'upsert' : 'create_only';
    const parsed = this.parseRows(type, body.csvText || '');
    const errors: any[] = [];
    const error = (line: number, column: string, code: string, description: string) => errors.push({ line, column, code, description });
    if (parsed.missingHeaders.length) parsed.missingHeaders.forEach(field => error(1, HEADER_ALIASES[type][field][0], 'MISSING_COLUMN', `A coluna ${HEADER_ALIASES[type][field][0]} não foi encontrada.`));
    if (!parsed.rows.length) error(1, 'Arquivo', 'EMPTY', 'Arquivo sem registros.');
    const [catalogs, departments, resources, projects, committeeMeetings] = await Promise.all([
      this.prisma.catalogItem.findMany({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.department.findMany({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.resource.findMany({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.project.findMany({ include: { phases: true } }),
      this.prisma.committeeMeeting.findMany({ where: { status: 'FINAL' }, select: { id: true, meetingDate: true } }),
    ]);
    const systems = catalogs.filter(catalog => catalog.type === CatalogType.SYSTEM);
    const seenSd = new Set<string>();
    parsed.rows.forEach(row => {
      const line = Number(row.__line);
      if (type === 'projects') {
        const key = normalizeText(row.sd);
        if (!row.sd) error(line, 'SD', 'REQUIRED', 'O número SD é obrigatório.');
        else if (seenSd.has(key)) error(line, 'SD', 'DUPLICATE_IN_FILE', `A SD ${row.sd} aparece mais de uma vez no arquivo.`);
        seenSd.add(key);
        const existing = projects.find(project => normalizeText(project.sdNumber) === key);
        if (mode === 'create_only' && existing) error(line, 'SD', 'DUPLICATE_SD', `A SD ${row.sd} já existe.`);
        if (!row.title) error(line, 'Título', 'REQUIRED', 'O título é obrigatório.');
        if (!row.requester) error(line, 'Solicitante', 'REQUIRED', 'O solicitante é obrigatório.');
        if (!splitMultiValues(row.departments).length) error(line, 'Departamentos', 'REQUIRED', 'Informe ao menos um departamento.');
        splitMultiValues(row.departments).forEach(value => { if (!resolveCatalogItem(departments, value)) error(line, 'Departamentos', 'INVALID_DEPARTMENT', `Departamento ${value} não encontrado.`); });
        if (!splitMultiValues(row.systems).length) error(line, 'Sistemas', 'REQUIRED', 'Informe ao menos um sistema.');
        splitMultiValues(row.systems).forEach(value => { if (!resolveCatalogItem(systems, value)) error(line, 'Sistemas', 'INVALID_SYSTEM', `Sistema ${value} não encontrado.`); });
        const catalogOk = (catalogType: CatalogType, value: string) => resolveCatalogItem(catalogs.filter(item => item.type === catalogType), value);
        if (!catalogOk(CatalogType.CLASSIFICATION, row.classification)) error(line, 'Classificação', 'INVALID_CATALOG', `Classificação ${row.classification} inválida.`);
        if (!catalogOk(CatalogType.FLOW_TYPE, row.flow)) error(line, 'Fluxo', 'INVALID_CATALOG', `Fluxo ${row.flow} inválido.`);
        if (!catalogOk(CatalogType.BUSINESS_PRIORITY, row.priority)) error(line, 'Prioridade', 'INVALID_CATALOG', `Prioridade ${row.priority} inválida.`);
        if (!catalogOk(CatalogType.CLASS, row.projectClass)) error(line, 'Classe', 'INVALID_CATALOG', `Classe ${row.projectClass} inválida.`);
        const effortClass = catalogOk(CatalogType.CLASS, row.projectClass);
        if (effortClass) {
          try { calculatePhaseMinutes(Number(effortClass.value), existing ? existing.phases.map(phase=>({id:phase.phaseId,name:phase.name,value:String(phase.percentage),order:phase.order})) : catalogs.filter(item=>item.type===CatalogType.PHASE)); }
          catch { error(line,'Horas','PROJECT_EFFORT_INVALID','Horas ou percentuais das fases inválidos para distribuir o esforço.'); }
        }
        if (Number.isNaN(parseProjectStatus(row.status))) error(line, 'Status', 'INVALID_STATUS', `Status ${row.status} inválido.`);
        if (Number.isNaN(parseCivilDate(row.openingDate).getTime())) error(line, 'Data Abertura', 'INVALID_DATE', 'Use uma data de abertura válida no formato dd/mm/aaaa.');
        if (row.deadline && Number.isNaN(parseCivilDate(row.deadline).getTime())) error(line, 'Prazo Solicitado', 'INVALID_DATE', 'Use um prazo válido no formato dd/mm/aaaa.');
      } else if (type === 'allocations') {
        const project = projects.find(item => normalizeText(item.sdNumber) === normalizeText(row.sd));
        if (!project) error(line, 'SD', 'PROJECT_NOT_FOUND', `Projeto ${row.sd} não encontrado.`);
        else if (!project.phases.some(phase => normalizeText(phase.name) === normalizeText(row.phase))) error(line, 'Fase', 'PHASE_NOT_FOUND', `Fase ${row.phase} não encontrada no projeto.`);
        if (!resources.some(resource => normalizeText(resource.name) === normalizeText(row.resource))) error(line, 'Recurso', 'RESOURCE_NOT_FOUND', `Recurso ${row.resource} não encontrado.`);
        if (!resolveFriendlyEnum(row.executionMode, EXECUTION_MODE_LABELS)) error(line, 'Modo Execução', 'INVALID_MODE', 'Escolha Simultâneo ou Sequencial.');
      } else if (type === 'unavailabilities') {
        const global = this.yes(row.global) || normalizeText(row.resource) === 'global';
        if (!resolveFriendlyEnum(row.type, UNAVAILABILITY_TYPE_LABELS)) error(line, 'Tipo', 'INVALID_TYPE', `Tipo ${row.type} inválido.`);
        if (!global && !resources.some(resource => normalizeText(resource.name) === normalizeText(row.resource))) error(line, 'Recurso', 'RESOURCE_NOT_FOUND', `Recurso ${row.resource} não encontrado.`);
        const start = parseCivilDate(row.start); const end = parseCivilDate(row.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) error(line, 'Datas', 'INVALID_DATE', 'Informe um período válido no formato dd/mm/aaaa.');
        if (row.hours && (Number(row.hours) <= 0 || Number(row.hours) > 24)) error(line, 'Horas por Dia', 'INVALID_HOURS', 'Informe entre 0 e 24 horas.');
      } else {
        const date = parseCivilDate(row.meetingDate);
        if (Number.isNaN(date.getTime())) error(line, 'Data da Reunião', 'INVALID_DATE', 'Use uma data válida no formato dd/mm/aaaa.');
        const project = resolveCommitteeProject(projects, row.sd);
        const projectKey = project?.id || normalizeText(row.sd);
        if (!project) error(line, 'Projeto (SD)', 'PROJECT_NOT_FOUND', `Projeto ${row.sd || '(não informado)'} não encontrado.`);
        else if (seenSd.has(projectKey)) error(line, 'Projeto (SD)', 'DUPLICATE_IN_FILE', `O projeto ${project.sdNumber} aparece mais de uma vez na reunião.`);
        seenSd.add(projectKey);
        if (!parseCommitteeDecision(row.decision)) error(line, 'Decisão', 'INVALID_DECISION', 'Escolha Priorizado, Segunda fase ou Cancelado.');
        const score = Number(String(row.score ?? '').replace(',', '.'));
        if (!Number.isInteger(score) || score < 1 || score > 10) error(line, 'Nota da Diretoria', 'INVALID_SCORE', 'Informe uma nota inteira entre 1 e 10.');
        for (const [column, value] of [['Ganho Mensal Estimado', row.gain], ['Prejuízo Mensal Evitado', row.loss]] as const) {
          const amount = parseImportNumber(value);
          if (Number.isNaN(amount) || (amount !== null && amount < 0)) error(line, column, 'INVALID_AMOUNT', 'Informe um valor numérico maior ou igual a zero.');
        }
      }
    });
    if (type === 'committee' && parsed.rows.length) {
      const identity = committeeFileIdentity(parsed.rows as CommitteeImportRow[]);
      if (identity.hasMultipleDates) error(1, 'Data da Reunião', 'MULTIPLE_MEETING_DATES', 'O arquivo deve representar uma única reunião e todas as linhas precisam ter a mesma data.');
      if (identity.hasConflictingNotes) error(1, 'Observação da Reunião', 'CONFLICTING_NOTES', 'A observação geral da reunião deve ser igual em todas as linhas preenchidas.');
      if (identity.meetingDateKey) {
        const sameDate = committeeMeetings.filter(meeting => dateOnlyKey(meeting.meetingDate) === identity.meetingDateKey);
        if (sameDate.length > 1) error(1, 'Data da Reunião', 'AMBIGUOUS_MEETING', 'Há mais de uma reunião ativa nessa data. Corrija as duplicidades pela tela de Comitê antes de importar.');
        else if (mode === 'create_only' && sameDate.length === 1) error(1, 'Data da Reunião', 'MEETING_ALREADY_EXISTS', 'Já existe uma reunião nessa data. Use “Atualizar ou criar” para corrigir a ata sem duplicá-la.');
      }
    }
    const rejectedLines = new Set(errors.filter(item => item.line > 1).map(item => item.line));
    const validRows = parsed.rows.filter(row => !rejectedLines.has(Number(row.__line)));
    const committeeIdentity = type === 'committee' ? committeeFileIdentity(validRows as CommitteeImportRow[]) : null;
    const committeeExists = committeeIdentity?.meetingDateKey
      ? committeeMeetings.some(meeting => dateOnlyKey(meeting.meetingDate) === committeeIdentity.meetingDateKey)
      : false;
    const updatedCount = type === 'projects'
      ? validRows.filter(row => projects.some(project => normalizeText(project.sdNumber) === normalizeText(row.sd))).length
      : type === 'committee' && committeeExists ? validRows.length : 0;
    return {
      valid: errors.length === 0, errorsCount: errors.length, recordsCount: parsed.rows.length,
      validRecordsCount: validRows.length, rejectedCount: rejectedLines.size,
      newCount: type === 'projects' || type === 'committee' ? validRows.length - updatedCount : validRows.length,
      updatedCount, mode, errors,
    };
  }

  private async normalizedContext() {
    const [catalogs, departments, resources] = await Promise.all([
      this.prisma.catalogItem.findMany(), this.prisma.department.findMany(), this.prisma.resource.findMany(),
    ]);
    return { catalogs, departments, resources };
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('imports/:type/preview-impact')
  async previewImpact(@Param('type') rawType: string, @Body() body: any) {
    const type = rawType as ImportType;
    const validation = await this.validateImport(type, body);
    if (!validation.valid) throw new BadRequestException({ message: 'Corrija os dados antes de simular o impacto.', errors: validation.errors });
    const rows = this.parseRows(type, body.csvText || '').rows;
    const { catalogs, resources } = await this.normalizedContext();
    const projectSources = type === 'projects' ? await this.prisma.project.findMany({where:{sdNumber:{in:rows.map(row=>row.sd)}},include:{phases:{include:{phaseCatalog:{select:{code:true}},allocations:true}}}}) : [];
    const committeeEffectiveProjects = new Set<string>();
    let committeeProjects: Array<{ id: string; sdNumber: string; title: string }> = [];
    if (type === 'committee') {
      committeeProjects = await this.prisma.project.findMany({ select: { id: true, sdNumber: true, title: true } });
      const meetingDate = parseCivilDate((rows[0] as CommitteeImportRow).meetingDate);
      const projectIds = (rows as CommitteeImportRow[]).map(row => resolveCommitteeProject(committeeProjects, row.sd)?.id).filter(Boolean) as string[];
      const laterEvaluations = projectIds.length ? await this.prisma.committeeMeetingEvaluation.findMany({
        where: { projectId: { in: projectIds }, meeting: { status: 'FINAL', meetingDate: { gt: meetingDate } } },
        select: { projectId: true },
      }) : [];
      const projectsWithLaterDecision = new Set(laterEvaluations.map(item => item.projectId));
      projectIds.filter(projectId => !projectsWithLaterDecision.has(projectId)).forEach(projectId => committeeEffectiveProjects.add(projectId));
    }
    const result = await this.engineService.runProposedSimulation(this.prisma, {
      projectsModifier: projects => {
        if (type === 'projects') rows.forEach(row => {
          const classItem = resolveCatalogItem(catalogs.filter(c => c.type === CatalogType.CLASS), row.projectClass);
          const priority = resolveCatalogItem(catalogs.filter(c => c.type === CatalogType.BUSINESS_PRIORITY), row.priority);
          const existing = projects.find(project => normalizeText(project.sdNumber) === normalizeText(row.sd));
          const values = {
            title: row.title, requester: row.requester, totalHours: Number(classItem?.value || 0), status: parseProjectStatus(row.status),
            isLegalRequirement: this.yes(row.legal), businessPriorityCode: String(priority?.code || '').toLowerCase(),
            openingDate: parseCivilDate(row.openingDate), requestedDeadline: row.deadline ? parseCivilDate(row.deadline) : null,
          };
          if (existing) { Object.assign(existing, values); normalizeProjectEffort(existing); }
          else {
            const source = projectSources.find(project=>project.sdNumber===row.sd);
            const phases = source ? source.phases.map(phase=>({...phase,phaseCode:phase.phaseCatalog.code,executionMode:phase.executionMode as 'SIMULTANEOUS' | 'SEQUENTIAL'})) : calculatePhaseMinutes(values.totalHours,catalogs.filter(c=>c.type===CatalogType.PHASE && c.status===UserStatus.ACTIVE)).map(phase=>({...phase,id:`import-${row.sd}-${phase.phaseId}`,phaseCode:catalogs.find(c=>c.id===phase.phaseId)?.code,executionMode:'SIMULTANEOUS' as const,allocations:[]}));
            const proposed = {id:source?.id ?? `import-${row.sd}`,sdNumber:row.sd,...values,committeeDecision:source?.committeeDecision ?? null,committeeScore:source?.committeeScore ?? 0,phases};
            normalizeProjectEffort(proposed); projects.push(proposed);
          }
        });
        if (type === 'allocations') {
          const grouped = new Map<string, { project: any; phase: any; resourceIds: string[]; mode: string }>();
          rows.forEach(row => {
            const project = projects.find(item => normalizeText(item.sdNumber) === normalizeText(row.sd));
            const phase = project?.phases.find(item => normalizeText(item.name) === normalizeText(row.phase));
            const resource = resources.find(item => normalizeText(item.name) === normalizeText(row.resource));
            const mode = resolveFriendlyEnum(row.executionMode, EXECUTION_MODE_LABELS);
            if (!project || !phase || !resource || !mode) return;
            const entry = grouped.get(phase.id) || { project, phase, resourceIds: [], mode };
            if (!entry.resourceIds.includes(resource.id)) entry.resourceIds.push(resource.id); grouped.set(phase.id, entry);
          });
          grouped.forEach(entry => {
            entry.phase.executionMode = entry.mode as any;
            entry.phase.allocations = calculateResourceSplit(entry.phase.totalMinutes,entry.resourceIds,entry.mode).map(allocation=>({id:`import-${entry.phase.id}-${allocation.resourceId}`,...allocation}));
          });
        }
        if (type === 'committee') {
          (rows as CommitteeImportRow[]).forEach(row => {
            const sourceProject = resolveCommitteeProject(committeeProjects, row.sd);
            const project = sourceProject ? projects.find(item => item.id === sourceProject.id) : undefined;
            const decision = parseCommitteeDecision(row.decision);
            if (!project || !decision || !committeeEffectiveProjects.has(project.id)) return;
            project.committeeDecision = decision as any;
            project.committeeScore = Number(row.score);
            if (decision === 'CANCELADO') project.status = 9;
          });
        }
      },
      resourcesModifier: engineResources => {
        if (type !== 'unavailabilities') return;
        rows.forEach(row => {
          const global = this.yes(row.global) || normalizeText(row.resource) === 'global'; if (global) return;
          const resource = engineResources.find(item => normalizeText(item.name) === normalizeText(row.resource));
          resource?.unavailabilities.push({ type: resolveFriendlyEnum(row.type, UNAVAILABILITY_TYPE_LABELS) as any, startDate: parseCivilDate(row.start), endDate: parseCivilDate(row.end), unavailableMinutesPerDay: row.hours ? Math.round(Number(row.hours) * 60) : null, annualRecurrence: this.yes(row.recurring) });
        });
      },
      holidaysModifier: holidays => {
        if (type !== 'unavailabilities') return;
        rows.filter(row => this.yes(row.global) || normalizeText(row.resource) === 'global').forEach(row => holidays.push({ startDate: parseCivilDate(row.start), endDate: parseCivilDate(row.end), annualRecurrence: this.yes(row.recurring), unavailableMinutesPerDay: row.hours ? Math.round(Number(row.hours) * 60) : null }));
      },
    });
    return {
      ...result.comparison,
      stateHash: result.stateHash,
      historicalProjectsCount: type === 'committee' ? rows.length - committeeEffectiveProjects.size : 0,
    };
  }

  private async recordProjectChange(tx: any, req: any, projectId: string, batchId: string, eventType: string, field: string, fieldLabel: string, before: any, after: any) {
    await this.events.record(tx, {
      aggregateType: 'PROJECT', aggregateId: projectId, eventType,
      description: `${fieldLabel} alterado por importação.`, userId: req.user.id, actorName: req.user.name,
      metadata: { source: 'IMPORT', batchId, field, fieldLabel, before, after },
    });
  }

  private committeeProjectState(project: any) {
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

  private committeeStateFromEvaluation(evaluation: any) {
    const snapshot = evaluation?.snapshot && typeof evaluation.snapshot === 'object' ? evaluation.snapshot : {};
    const state = snapshot.afterState || snapshot.after || {};
    return {
      status: Number(state.status ?? snapshot.status ?? (evaluation.decision === 'CANCELADO' ? 9 : 1)),
      committeeDecision: state.committeeDecision ?? state.decision ?? evaluation.decision ?? null,
      committeeScore: state.committeeScore ?? state.score ?? evaluation.score ?? null,
      decisionDate: state.decisionDate ?? evaluation.meeting?.meetingDate?.toISOString?.() ?? null,
      boardNotes: state.boardNotes ?? evaluation.notes ?? null,
      estimatedMonthlyGain: state.estimatedMonthlyGain ?? evaluation.estimatedMonthlyGain ?? null,
      estimatedMonthlyLossAvoided: state.estimatedMonthlyLossAvoided ?? evaluation.estimatedMonthlyLossAvoided ?? null,
      roiMonthly: state.roiMonthly ?? state.roi ?? evaluation.roiMonthly ?? null,
    };
  }

  private committeeBeforeState(evaluation: any) {
    const snapshot = evaluation?.snapshot && typeof evaluation.snapshot === 'object' ? evaluation.snapshot : {};
    return snapshot.beforeState && typeof snapshot.beforeState === 'object' ? snapshot.beforeState : null;
  }

  private committeeStateUpdate(state: any) {
    return {
      status: Number(state.status ?? 1), committeeDecision: state.committeeDecision ?? null,
      committeeScore: state.committeeScore ?? null, decisionDate: state.decisionDate ? new Date(state.decisionDate) : null,
      boardNotes: state.boardNotes ?? null, estimatedMonthlyGain: state.estimatedMonthlyGain ?? null,
      estimatedMonthlyLossAvoided: state.estimatedMonthlyLossAvoided ?? null, roiMonthly: state.roiMonthly ?? null,
    };
  }

  private async captureCommitteePortfolioSnapshot(tx: any) {
    const projects = await tx.project.findMany({
      include: { departments: { include: { department: true } }, currentSchedule: true }, orderBy: { sdNumber: 'asc' },
    });
    return projects.map((project: any) => ({
      projectId: project.id, sdNumber: project.sdNumber, title: project.title,
      departments: project.departments.map((item: any) => item.department.code), status: project.status,
      decision: project.committeeDecision || 'NAO_AVALIADO', score: project.committeeScore,
      isLegalRequirement: project.isLegalRequirement, endDate: project.currentSchedule?.endDate?.toISOString() || null,
      requestedDeadline: project.requestedDeadline?.toISOString() || null,
      realCompletionDate: project.realCompletionDate?.toISOString() || null, roi: project.roiMonthly || 0,
    }));
  }

  private async confirmCommitteeImport(rows: CommitteeImportRow[], mode: ImportMode, req: any, stateHash?: string) {
    if (stateHash) {
      const currentHash = await this.engineService.getDatabaseStateHash();
      if (currentHash !== stateHash) throw new BadRequestException({
        code: 'DATABASE_CHANGED',
        message: 'A base de dados mudou após a prévia. Valide e simule o arquivo novamente antes de confirmar.',
      });
    }
    const batchId = randomUUID();
    const identity = committeeFileIdentity(rows);
    const meetingDate = parseCivilDate(identity.meetingDateKey!);
    return this.prisma.$transaction(async tx => {
      const nextDay = new Date(meetingDate); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const sameDateMeetings = await tx.committeeMeeting.findMany({
        where: { status: 'FINAL', meetingDate: { gte: meetingDate, lt: nextDay } },
        include: { evaluations: { include: { meeting: true } } },
      });
      if (sameDateMeetings.length > 1) throw new BadRequestException('Há mais de uma reunião ativa nessa data; corrija essa situação antes de importar.');
      const existingMeeting = sameDateMeetings[0] || null;
      if (existingMeeting && mode === 'create_only') throw new BadRequestException('Já existe uma reunião nessa data. Use “Atualizar ou criar”.');

      const projects = await tx.project.findMany({ include: { departments: { include: { department: true } } } });
      const resolvedRows = rows.map(row => ({ row, project: resolveCommitteeProject(projects, row.sd)! }));
      const oldEvaluations = existingMeeting?.evaluations || [];
      const oldByProject = new Map(oldEvaluations.map((evaluation: any) => [evaluation.projectId, evaluation]));
      const affectedIds = new Set<string>([...oldEvaluations.map((evaluation: any) => evaluation.projectId), ...resolvedRows.map(item => item.project.id)]);
      const currentProjects = projects.filter(project => affectedIds.has(project.id));
      const currentBefore = new Map(currentProjects.map(project => [project.id, this.committeeProjectState(project)]));
      const officialSchedules = await tx.currentProjectSchedule.findMany({});
      const validEnds = officialSchedules.map((item: any) => item.endDate).filter((date: Date | null): date is Date => Boolean(date));
      const portfolioEndDateBefore = validEnds.length ? new Date(Math.max(...validEnds.map((date: Date) => date.getTime()))) : null;

      const meeting = existingMeeting
        ? await tx.committeeMeeting.update({ where: { id: existingMeeting.id }, data: {
            meetingDate, notes: identity.notes || null, version: { increment: 1 }, updatedAt: new Date(),
          } })
        : await tx.committeeMeeting.create({ data: { meetingDate, notes: identity.notes || null, createdById: req.user.id } });
      if (existingMeeting) await tx.committeeMeetingEvaluation.deleteMany({ where: { meetingId: meeting.id } });

      for (const { row, project } of resolvedRows) {
        const previousEvaluation: any = oldByProject.get(project.id);
        const historicalBefore = this.committeeBeforeState(previousEvaluation) || currentBefore.get(project.id)!;
        const decision = parseCommitteeDecision(row.decision)!;
        const gain = parseImportNumber(row.gain);
        const loss = parseImportNumber(row.loss);
        const afterState = {
          ...historicalBefore,
          status: decision === 'CANCELADO' ? 9 : Number(historicalBefore.status ?? project.status),
          committeeDecision: decision, committeeScore: Number(row.score), decisionDate: meetingDate.toISOString(),
          boardNotes: row.projectNotes?.trim() || null,
          estimatedMonthlyGain: gain ?? historicalBefore.estimatedMonthlyGain ?? project.estimatedMonthlyGain ?? null,
          estimatedMonthlyLossAvoided: loss ?? historicalBefore.estimatedMonthlyLossAvoided ?? project.estimatedMonthlyLossAvoided ?? null,
        };
        afterState.roiMonthly = Number(afterState.estimatedMonthlyGain || 0) + Number(afterState.estimatedMonthlyLossAvoided || 0);
        const schedule = officialSchedules.find((item: any) => item.projectId === project.id);
        await tx.committeeMeetingEvaluation.create({ data: {
          meetingId: meeting.id, projectId: project.id, decision, score: Number(row.score),
          notes: row.projectNotes?.trim() || null,
          estimatedMonthlyGain: afterState.estimatedMonthlyGain, estimatedMonthlyLossAvoided: afterState.estimatedMonthlyLossAvoided,
          roiMonthly: afterState.roiMonthly,
          snapshot: {
            sdNumber: project.sdNumber, title: project.title,
            departments: project.departments.map((item: any) => item.department.code),
            status: afterState.status, decision, score: Number(row.score), isLegalRequirement: project.isLegalRequirement,
            endDate: schedule?.endDate?.toISOString() || null, requestedDeadline: project.requestedDeadline?.toISOString() || null,
            roi: afterState.roiMonthly, beforeState: historicalBefore, afterState,
          },
        } });
      }

      const allEvaluations = affectedIds.size ? await tx.committeeMeetingEvaluation.findMany({
        where: { projectId: { in: Array.from(affectedIds) }, meeting: { status: 'FINAL' } }, include: { meeting: true },
      }) : [];
      const byProject = new Map<string, any[]>();
      for (const evaluation of allEvaluations) {
        const list = byProject.get(evaluation.projectId) || []; list.push(evaluation); byProject.set(evaluation.projectId, list);
      }
      for (const project of currentProjects) {
        const evaluations = byProject.get(project.id) || [];
        evaluations.sort((left, right) => {
          const dateDiff = new Date(right.meeting.meetingDate).getTime() - new Date(left.meeting.meetingDate).getTime();
          if (dateDiff) return dateDiff;
          return Number(right.meeting.version || 1) - Number(left.meeting.version || 1);
        });
        const oldEvaluation: any = oldByProject.get(project.id);
        const finalState = evaluations[0]
          ? this.committeeStateFromEvaluation(evaluations[0])
          : this.committeeBeforeState(oldEvaluation) || currentBefore.get(project.id)!;
        const beforeState = currentBefore.get(project.id)!;
        if (JSON.stringify(beforeState) === JSON.stringify(finalState)) continue;
        await tx.project.update({ where: { id: project.id }, data: this.committeeStateUpdate(finalState) });
        await this.events.record(tx, {
          aggregateType: 'PROJECT', aggregateId: project.id, eventType: 'PROJECT_COMMITTEE_STATE_CHANGED',
          description: `Avaliação do comitê do projeto ${project.sdNumber} atualizada por importação.`,
          userId: req.user.id, actorName: req.user.name,
          metadata: { source: 'IMPORT', batchId, meetingId: meeting.id, before: beforeState, after: finalState },
        });
      }

      const simulation = await this.engineService.runProposedSimulation(tx, {});
      await this.engineService.persistSchedule(tx, simulation.simulation, {
        triggerType: existingMeeting ? 'COMMITTEE_MEETING_REVISED' : 'COMMITTEE_MEETING_CREATED',
        triggeredById: req.user.id, inputHash: simulation.stateHash,
      });
      const portfolioSnapshot = await this.captureCommitteePortfolioSnapshot(tx);
      await tx.committeeMeeting.update({ where: { id: meeting.id }, data: { portfolioSnapshot } });
      await this.events.record(tx, {
        aggregateType: 'MEETING', aggregateId: meeting.id,
        eventType: existingMeeting ? 'COMMITTEE_MEETING_REVISED' : 'COMMITTEE_MEETING_CREATED',
        description: `${existingMeeting ? 'Reunião do comitê atualizada' : 'Reunião do comitê criada'} por importação em ${formatCivilDatePtBr(meetingDate)}, com ${rows.length} projetos avaliados.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: { source: 'IMPORT', batchId, meetingId: meeting.id, evaluatedProjectIds: resolvedRows.map(item => item.project.id) },
      });
      await this.events.record(tx, {
        aggregateType: 'IMPORT', aggregateId: batchId, eventType: 'MASS_IMPORT_COMPLETED',
        description: `Importação de comitê concluída: uma reunião e ${rows.length} avaliações processadas.`,
        userId: req.user.id, actorName: req.user.name,
        metadata: { source: 'IMPORT', batchId, type: 'committee', meetingId: meeting.id, count: rows.length },
      });
      const afterDate = simulation.simulation.portfolioEndDate;
      await tx.engineChangeLog.create({ data: {
        changeType: 'COMMITTEE_MEETING_IMPORT', userId: req.user.id,
        portfolioEndDateBefore, portfolioEndDateAfter: afterDate,
        differenceDays: Math.round(((afterDate?.getTime() || 0) - (portfolioEndDateBefore?.getTime() || 0)) / 86400000),
        mainCause: `Importação da reunião do comitê de ${formatCivilDatePtBr(meetingDate)}`,
        details: `${rows.length} avaliações processadas. Projetos afetados na fila: ${simulation.comparison.affectedProjectsCount}.`,
      } });
      return { success: true, count: rows.length, batchId, meetingId: meeting.id, updated: Boolean(existingMeeting), comparison: simulation.comparison };
    }, { timeout: 120000 });
  }

  @Roles('ADMIN', 'PROJECT_MANAGER')
  @Post('imports/:type/confirm')
  async confirmImport(@Param('type') rawType: string, @Req() req: any, @Body() body: any) {
    const type = rawType as ImportType; const mode: ImportMode = body.mode === 'upsert' ? 'upsert' : 'create_only';
    const validation = await this.validateImport(type, body);
    if (!validation.valid) throw new BadRequestException({ message: 'A importação foi interrompida porque o arquivo possui erros.', errors: validation.errors });
    const rows = this.parseRows(type, body.csvText || '').rows; const batchId = randomUUID();
    if (type === 'committee') return this.confirmCommitteeImport(rows as CommitteeImportRow[], mode, req, body.stateHash);
    const [catalogs, departments, systems, activePhases, resources] = await Promise.all([
      this.prisma.catalogItem.findMany(), this.prisma.department.findMany(), this.prisma.catalogItem.findMany({ where: { type: CatalogType.SYSTEM } }),
      this.prisma.catalogItem.findMany({ where: { type: CatalogType.PHASE, status: UserStatus.ACTIVE }, orderBy: { order: 'asc' } }), this.prisma.resource.findMany(),
    ]);
    return this.prisma.$transaction(async tx => {
      let count = 0; let changedFields = 0;
      if (type === 'projects') for (const row of rows) {
        const existing = await tx.project.findUnique({ where: { sdNumber: row.sd }, include: { classification: true, flowType: true, businessPriority: true, class: true, departments: { include: { department: true } }, systems: { include: { system: true } } } });
        if (existing && mode === 'create_only') throw new BadRequestException(`A SD ${row.sd} já existe.`);
        const classification = resolveCatalogItem(catalogs.filter(c => c.type === CatalogType.CLASSIFICATION), row.classification)!;
        const flow = resolveCatalogItem(catalogs.filter(c => c.type === CatalogType.FLOW_TYPE), row.flow)!;
        const priority = resolveCatalogItem(catalogs.filter(c => c.type === CatalogType.BUSINESS_PRIORITY), row.priority)!;
        const projectClass = resolveCatalogItem(catalogs.filter(c => c.type === CatalogType.CLASS), row.projectClass)!;
        const departmentItems = splitMultiValues(row.departments).map(value => resolveCatalogItem(departments, value)!).filter(Boolean);
        const systemItems = splitMultiValues(row.systems).map(value => resolveCatalogItem(systems, value)!).filter(Boolean);
        const monthlyGain = Number(row.gain || 0); const monthlyLoss = Number(row.loss || 0);
        const data = {
          title: row.title, requester: row.requester, openingDate: parseCivilDate(row.openingDate), requestedDeadline: row.deadline ? parseCivilDate(row.deadline) : null,
          status: parseProjectStatus(row.status), classificationId: classification.id, flowTypeId: flow.id, businessPriorityId: priority.id,
          classId: projectClass.id, totalHours: Number(projectClass.value || 0), isLegalRequirement: this.yes(row.legal),
          estimatedMonthlyGain: monthlyGain, estimatedMonthlyLossAvoided: monthlyLoss, roiMonthly: monthlyGain + monthlyLoss,
          problemDescription: row.problem || null, objective: row.objective || null, currentProcess: row.currentProcess || null, desiredProcess: row.desiredProcess || null,
        };
        const project = existing ? await tx.project.update({ where: { id: existing.id }, data }) : await tx.project.create({ data: { sdNumber: row.sd, ...data } });
        await tx.projectDepartment.deleteMany({ where: { projectId: project.id } }); await tx.projectSystem.deleteMany({ where: { projectId: project.id } });
        for (const department of departmentItems) await tx.projectDepartment.create({ data: { projectId: project.id, departmentId: department.id } });
        for (const system of systemItems) await tx.projectSystem.create({ data: { projectId: project.id, systemId: system.id } });
        if (!existing) {
          for (const phase of calculatePhaseMinutes(project.totalHours, activePhases)) await tx.projectPhase.create({ data: { projectId: project.id, ...phase } });
          await this.events.record(tx, { aggregateType: 'PROJECT', aggregateId: project.id, eventType: 'PROJECT_IMPORTED', description: `Projeto ${row.sd} criado por importação.`, userId: req.user.id, actorName: req.user.name, metadata: { source: 'IMPORT', batchId, mode } });
        } else {
          const effortReconciliation = await reconcileProjectEffort(tx, project.id, project.totalHours);
          if (effortReconciliation.changed) await this.events.record(tx,{aggregateType:'PROJECT',aggregateId:project.id,eventType:'PROJECT_EFFORT_RECONCILED',description:'Horas das fases e dos recursos reconciliadas por importação.',userId:req.user.id,actorName:req.user.name,metadata:{source:'IMPORT',batchId,...effortReconciliation}});
          const changes: Array<[string,string,string,any,any]> = [
            ['PROJECT_FIELD_CHANGED','title','Título',{ value: existing.title },{ value: data.title }],
            ['PROJECT_FIELD_CHANGED','requester','Solicitante',{ value: existing.requester },{ value: data.requester }],
            ['PROJECT_FIELD_CHANGED','openingDate','Data de abertura',{ value: formatCivilDatePtBr(existing.openingDate) },{ value: formatCivilDatePtBr(data.openingDate) }],
            ['PROJECT_STATUS_CHANGED','status','Status',{ status: existing.status },{ status: data.status }],
            ['PROJECT_FIELD_CHANGED','classification','Classificação',{ value: existing.classification.name },{ value: classification.name }],
            ['PROJECT_FIELD_CHANGED','flow','Fluxo',{ value: existing.flowType.name },{ value: flow.name }],
            ['PROJECT_PRIORITY_CHANGED','priority','Prioridade',{ businessPriorityName: existing.businessPriority.name },{ businessPriorityName: priority.name }],
            ['PROJECT_FIELD_CHANGED','class','Classe',{ value: existing.class.name },{ value: projectClass.name }],
            ['PROJECT_FIELD_CHANGED','totalHours','Horas estimadas',{ value: existing.totalHours },{ value: data.totalHours }],
            ['PROJECT_FIELD_CHANGED','legal','Requisito legal',{ value: existing.isLegalRequirement },{ value: data.isLegalRequirement }],
            ['PROJECT_FIELD_CHANGED','gain','Ganho mensal estimado',{ value: existing.estimatedMonthlyGain || 0 },{ value: monthlyGain }],
            ['PROJECT_FIELD_CHANGED','loss','Prejuízo mensal evitado',{ value: existing.estimatedMonthlyLossAvoided || 0 },{ value: monthlyLoss }],
            ['PROJECT_FIELD_CHANGED','problem','Descrição do problema',{ value: existing.problemDescription || '' },{ value: data.problemDescription || '' }],
            ['PROJECT_FIELD_CHANGED','objective','Objetivo',{ value: existing.objective || '' },{ value: data.objective || '' }],
            ['PROJECT_FIELD_CHANGED','currentProcess','Processo atual',{ value: existing.currentProcess || '' },{ value: data.currentProcess || '' }],
            ['PROJECT_FIELD_CHANGED','desiredProcess','Processo desejado',{ value: existing.desiredProcess || '' },{ value: data.desiredProcess || '' }],
          ];
          if (dateOnlyKey(existing.requestedDeadline) !== dateOnlyKey(data.requestedDeadline)) changes.push(['PROJECT_DEADLINE_CHANGED','deadline','Prazo solicitado',{ requestedDeadline: formatCivilDatePtBr(existing.requestedDeadline) },{ requestedDeadline: formatCivilDatePtBr(data.requestedDeadline) }]);
          const beforeDepartments = existing.departments.map((item: any) => item.department.code).sort(); const afterDepartments = departmentItems.map(item => item.code).sort();
          if (!sameStringSet(beforeDepartments, afterDepartments)) changes.push(['PROJECT_DEPARTMENTS_CHANGED','departments','Departamentos',{ value: beforeDepartments },{ value: afterDepartments }]);
          const beforeSystems = existing.systems.map((item: any) => item.system.code).sort(); const afterSystems = systemItems.map(item => item.code).sort();
          if (!sameStringSet(beforeSystems, afterSystems)) changes.push(['PROJECT_SYSTEMS_CHANGED','systems','Sistemas',{ value: beforeSystems },{ value: afterSystems }]);
          for (const [eventType, field, label, before, after] of changes) {
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            await this.recordProjectChange(tx, req, project.id, batchId, eventType, field, label, before, after); changedFields++;
          }
        }
        count++;
      } else if (type === 'allocations') {
        const grouped = new Map<string, { phase: any; resources: any[]; mode: string }>();
        for (const row of rows) {
          const phase = await tx.projectPhase.findFirst({ where: { project: { sdNumber: row.sd }, name: { equals: row.phase, mode: 'insensitive' } }, include: { project: true, allocations: { include: { resource: true } } } });
          const resource = resources.find(item => normalizeText(item.name) === normalizeText(row.resource)); const executionMode = resolveFriendlyEnum(row.executionMode, EXECUTION_MODE_LABELS);
          if (!phase || !resource || !executionMode) continue;
          const entry = grouped.get(phase.id) || { phase, resources: [], mode: executionMode };
          if (entry.mode !== executionMode) throw new BadRequestException(`A fase ${phase.name} possui modos de execução diferentes no mesmo arquivo.`);
          if (!entry.resources.some(item => item.id === resource.id)) entry.resources.push(resource); grouped.set(phase.id, entry);
        }
        for (const entry of grouped.values()) {
          const beforeMode = entry.phase.executionMode; const beforeResources = entry.phase.allocations.map((item: any) => item.resource.name).sort();
          await tx.projectPhase.update({ where: { id: entry.phase.id }, data: { executionMode: entry.mode } }); await tx.projectPhaseAllocation.deleteMany({ where: { projectPhaseId: entry.phase.id } });
          for (const allocation of calculateResourceSplit(entry.phase.totalMinutes,entry.resources.map(item=>item.id),entry.mode)) await tx.projectPhaseAllocation.create({data:{projectPhaseId:entry.phase.id,...allocation}});
          const afterResources = entry.resources.map(item => item.name).sort();
          if (beforeMode !== entry.mode) { await this.recordProjectChange(tx, req, entry.phase.projectId, batchId, 'PHASE_EXECUTION_MODE_CHANGED', 'executionMode', 'Modo de execução', { value: EXECUTION_MODE_LABELS[beforeMode] || beforeMode }, { value: EXECUTION_MODE_LABELS[entry.mode] }); changedFields++; }
          if (!sameStringSet(beforeResources, afterResources)) { await this.recordProjectChange(tx, req, entry.phase.projectId, batchId, 'PHASE_RESOURCES_CHANGED', 'resources', 'Recursos da fase', { value: beforeResources }, { value: afterResources }); changedFields++; }
          count += entry.resources.length;
        }
      } else {
        for (const row of rows) {
          const global = this.yes(row.global) || normalizeText(row.resource) === 'global'; const resource = resources.find(item => normalizeText(item.name) === normalizeText(row.resource));
          const typeValue = resolveFriendlyEnum(row.type, UNAVAILABILITY_TYPE_LABELS) as UnavailabilityType;
          const created = await tx.resourceUnavailability.create({ data: { type: typeValue, startDate: parseCivilDate(row.start), endDate: parseCivilDate(row.end), unavailableMinutesPerDay: row.hours ? Math.round(Number(row.hours) * 60) : null, resourceId: global ? null : resource?.id, global, annualRecurrence: this.yes(row.recurring), notes: row.notes || null } });
          await this.events.record(tx, { aggregateType: 'UNAVAILABILITY', aggregateId: created.id, eventType: 'UNAVAILABILITY_CREATED', description: `${global ? 'Indisponibilidade global' : `Indisponibilidade de ${resource?.name}`} criada por importação, de ${formatCivilDatePtBr(created.startDate)} a ${formatCivilDatePtBr(created.endDate)}.`, userId: req.user.id, actorName: req.user.name, metadata: { source: 'IMPORT', batchId, type: UNAVAILABILITY_TYPE_LABELS[typeValue], resource: global ? 'Global' : resource?.name, startDate: formatCivilDatePtBr(created.startDate), endDate: formatCivilDatePtBr(created.endDate) } }); count++;
        }
      }
      const simulation = await this.engineService.runProposedSimulation(tx, {}); await this.engineService.persistSchedule(tx, simulation.simulation, { triggerType: `IMPORT_${type.toUpperCase()}`, triggeredById: req.user.id, inputHash: simulation.stateHash });
      await this.events.record(tx, { aggregateType: 'IMPORT', aggregateId: batchId, eventType: 'MASS_IMPORT_COMPLETED', description: `Importação de ${IMPORT_TYPE_LABELS[type]} concluída: ${count} registro${count === 1 ? '' : 's'} processado${count === 1 ? '' : 's'}${changedFields ? ` e ${changedFields} alteração${changedFields === 1 ? '' : 'ões'} registrada${changedFields === 1 ? '' : 's'}` : ''}.`, userId: req.user.id, actorName: req.user.name, metadata: { source: 'IMPORT', batchId, type, count, changedFields, mode } });
      return { success: true, count, changedFields, batchId, mode, comparison: simulation.comparison };
    });
  }

  private card(sheet: ExcelJS.Worksheet, range: string, label: string, value: any, accent: string, numberFormat?: string) {
    sheet.mergeCells(range); const start = range.split(':')[0]; const cell = sheet.getCell(start);
    cell.value = `${label}\n${value ?? '—'}`; cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.font = { name: 'Aptos Display', size: 14, bold: true, color: { argb: 'FF212A57' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.border = { left: { style: 'thick', color: { argb: accent } }, bottom: { style: 'thin', color: { argb: 'FFDDE5EF' } }, right: { style: 'thin', color: { argb: 'FFDDE5EF' } }, top: { style: 'thin', color: { argb: 'FFDDE5EF' } } };
    if (numberFormat) cell.numFmt = numberFormat;
  }

  private barChart(sheet: ExcelJS.Worksheet, title: string, startRow: number, startColumn: number, data: Array<[string, number]>, color: string, numberFormat = '#,##0') {
    sheet.mergeCells(startRow, startColumn, startRow, startColumn + 10); const titleCell = sheet.getCell(startRow, startColumn); titleCell.value = title;
    titleCell.font = { name: 'Aptos Display', bold: true, size: 13, color: { argb: 'FF212A57' } }; titleCell.alignment = { vertical: 'middle' };
    const max = Math.max(1, ...data.map(([, value]) => value));
    data.forEach(([label, value], index) => {
      const decimalValues = numberFormat !== '#,##0';
      const row = startRow + index + 2; sheet.mergeCells(row, startColumn, row, startColumn + (decimalValues ? 3 : 4));
      if (decimalValues) sheet.mergeCells(row, startColumn + 4, row, startColumn + 5);
      sheet.getCell(row, startColumn).value = label;
      sheet.getCell(row, startColumn).alignment = { vertical: 'middle', wrapText: true };
      sheet.getCell(row, startColumn).font = { name: 'Aptos', size: 8.5, color: { argb: 'FF46516B' } };
      const numericCell = sheet.getCell(row, startColumn + (decimalValues ? 4 : 5));
      numericCell.value = value; numericCell.numFmt = numberFormat; numericCell.alignment = { horizontal: 'right', vertical: 'middle' };
      const filled = value === 0 ? 0 : Math.max(1, Math.round((value / max) * 5));
      for (let cellIndex = 0; cellIndex < 5; cellIndex++) {
        const cell = sheet.getCell(row, startColumn + 6 + cellIndex);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cellIndex < filled ? color : 'FFEDF2F7' } };
      }
      sheet.getRow(row).height = Math.max(sheet.getRow(row).height || 22, Math.ceil(label.length / 26) * 14);
    });
  }

  private addDashboard(workbook: ExcelJS.Workbook, projects: any[], resources: any[], allocations: any[], catalogs: any[]) {
    const sheet = workbook.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
    for (let column = 1; column <= 24; column++) sheet.getColumn(column).width = 5;
    sheet.mergeCells('A1:X2'); sheet.getCell('A1').value = 'Dashboard Executivo do Portfólio de TIC';
    sheet.getCell('A1').font = { name: 'Aptos Display', size: 22, bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getCell('A1').alignment = { vertical: 'middle' };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF212A57' } };
    sheet.mergeCells('A3:X3'); sheet.getCell('A3').value = `Visão consolidada em ${formatCivilDatePtBr(new Date())}`; sheet.getCell('A3').font = { italic: true, color: { argb: 'FF667085' } };
    const statusCounts = Object.keys(PROJECT_STATUS_LABELS).reduce((result, key) => ({ ...result, [key]: projects.filter(project => project.status === Number(key)).length }), {} as Record<string, number>);
    const portfolioEnd = projects.map(project => project.currentSchedule?.endDate).filter(Boolean).sort((a: any, b: any) => b.getTime() - a.getTime())[0];
    const cards: Array<[string,string,any,string]> = [
      ['A5:F7','Total de projetos',projects.length,'FF079AE1'], ['G5:L7','Em andamento',[0,1,2,4,5].reduce((sum,status)=>sum+(statusCounts[status]||0),0),'FF079AE1'],
      ['M5:R7','Em homologação',statusCounts[6]||0,'FFF36229'], ['S5:X7','Concluídos',statusCounts[7]||0,'FF22A06B'],
      ['A9:F11','Cancelados',statusCounts[9]||0,'FF8A94A6'], ['G9:L11','Devolvidos',statusCounts[8]||0,'FFF2A93B'],
      ['M9:R11','Recursos ativos',resources.filter(resource=>resource.status===UserStatus.ACTIVE).length,'FF079AE1'], ['S9:X11','Previsão do portfólio',portfolioEnd ? formatCivilDatePtBr(portfolioEnd) : 'Sem previsão','FFF36229'],
    ];
    cards.forEach(([range,label,value,color]) => this.card(sheet, range, label, value, color));
    const statusData = Object.entries(PROJECT_STATUS_LABELS).map(([status,label]) => [label.replace(/^\d+\.\s*/, ''), statusCounts[status] || 0] as [string,number]);
    const deadlineData = Object.entries(SCHEDULE_STATUS_LABELS).slice(0,3).map(([status,label]) => [label, projects.filter(project => project.currentSchedule?.status === status).length] as [string,number]);
    deadlineData.push(['Sem prazo solicitado', projects.filter(project => !project.requestedDeadline).length]);
    deadlineData.push(['Fora da simulação', projects.filter(project => !project.currentSchedule && ![7,8,9].includes(project.status)).length]);
    const dept = new Map<string,number>(); projects.forEach(project => project.departments.forEach(item => dept.set(item.department.code, (dept.get(item.department.code)||0)+1)));
    const activeProjectIds = new Set(projects.filter(project => ![7, 8, 9].includes(project.status)).map(project => project.id));
    const activeAllocations = allocations.filter(item => activeProjectIds.has(item.phase.projectId));
    const resourceHours = new Map<string,number>(); activeAllocations.forEach(item => resourceHours.set(item.resource.name,(resourceHours.get(item.resource.name)||0)+item.minutesAllocated/60));
    this.barChart(sheet, 'Distribuição dos projetos por estágio', 13, 1, statusData, 'FF079AE1');
    this.barChart(sheet, 'Situação perante o prazo solicitado', 13, 13, deadlineData, 'FFF36229');
    this.barChart(sheet, 'Departamentos com mais projetos', 26, 1, [...dept.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10), 'FF212A57');
    this.barChart(sheet, 'Horas planejadas por recurso em projetos ativos', 26, 13, [...resourceHours.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10), 'FF079AE1', '#,##0.00');
    const active = financialSummary(projects.filter(project => ![7, 8, 9].includes(project.status)));
    const concluded = financialSummary(projects.filter(project => project.status === 7));
    const currency = '"R$" #,##0.00';
    const financeHeaders = ['Situação', 'Ganho mensal estimado', 'Prejuízo mensal evitado', 'Benefício mensal total'];
    const financeRanges = [[1, 6], [7, 12], [13, 18], [19, 24]];
    financeHeaders.forEach((label, index) => {
      const [from, to] = financeRanges[index]; sheet.mergeCells(39, from, 39, to);
      const cell = sheet.getCell(39, from); cell.value = label;
      cell.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF212A57' } };
      cell.alignment = { wrapText: true, vertical: 'middle' };
    });
    sheet.getRow(39).height = 32;
    [['Ativos — potencial', active], ['Concluídos — estimativas cadastradas', concluded]].forEach(([label, summary], index) => {
      const values = [label, (summary as any).gain, (summary as any).loss, (summary as any).benefit];
      values.forEach((value, column) => {
        const [from, to] = financeRanges[column]; sheet.mergeCells(40 + index, from, 40 + index, to);
        const cell = sheet.getCell(40 + index, from); cell.value = value as any;
        cell.font = { name: 'Aptos', size: 11, color: { argb: 'FF212A57' } };
        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: column ? 'right' : 'left' };
        if (column) cell.numFmt = currency;
      });
      sheet.getRow(40 + index).height = 32;
    });
    sheet.mergeCells('A43:X44'); sheet.getCell('A43').value = `Benefício mensal = ganho + prejuízo evitado. Concluídos: estimativas cadastradas. Cancelados e devolvidos excluídos. Sem informação financeira (ambos os campos vazios): ${active.missing} ativos e ${concluded.missing} concluídos. Campos vazios não contribuem para a soma.`;
    sheet.getCell('A43').alignment = { wrapText: true, vertical: 'middle' };
    sheet.getCell('A43').font = { name: 'Aptos', size: 10, italic: true, color: { argb: 'FF667085' } };
    const distributions = reportDistributions(projects, catalogs);
    this.barChart(sheet, 'Projetos por classe de horas', 46, 1, distributions.classes, 'FF079AE1');
    this.barChart(sheet, 'Projetos por sistema', 46, 13, distributions.systems, 'FFF36229');
    const nextRow = 46 + Math.max(distributions.classes.length, distributions.systems.length) + 4;
    sheet.mergeCells(nextRow - 1, 1, nextRow - 1, 24);
    sheet.getCell(nextRow - 1, 1).value = 'Cada projeto conta uma vez por sistema vinculado. Distribuições incluem toda a carteira.';
    sheet.getCell(nextRow - 1, 1).font = { name: 'Aptos', size: 10, italic: true, color: { argb: 'FF667085' } };
    this.barChart(sheet, 'Projetos por nota da diretoria', nextRow, 1, distributions.scores, 'FF212A57');
    this.barChart(sheet, 'Projetos por tipo de fluxo', nextRow, 13, distributions.flows, 'FF079AE1');
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.1, footer: 0.1 } };

    const sourceRows: any[][] = [];
    statusData.forEach(([label,value]) => sourceRows.push(['Projetos por estágio',label,value]));
    deadlineData.forEach(([label,value]) => sourceRows.push(['Situação perante o prazo',label,value]));
    [...dept.entries()].sort((a,b)=>b[1]-a[1]).forEach(([label,value]) => sourceRows.push(['Projetos por departamento',label,value]));
    [...resourceHours.entries()].sort((a,b)=>b[1]-a[1]).forEach(([label,value]) => sourceRows.push(['Horas planejadas por recurso em projetos ativos',label,Number(value.toFixed(2))]));
    [['Ativos', active], ['Concluídos', concluded]].forEach(([label, summary]) => {
      const values = summary as ReturnType<typeof financialSummary>;
      sourceRows.push(['Ganho mensal estimado', label, values.gain], ['Prejuízo mensal evitado', label, values.loss],
        ['Benefício mensal total', label, values.benefit], ['Sem informação financeira', label, values.missing]);
    });
    distributions.classes.forEach(([label, value]) => sourceRows.push(['Projetos por classe de horas', label, value]));
    distributions.systems.forEach(([label, value]) => sourceRows.push(['Projetos por sistema', label, value]));
    distributions.scores.forEach(([label, value]) => sourceRows.push(['Projetos por nota da diretoria', label, value]));
    distributions.flows.forEach(([label, value]) => sourceRows.push(['Projetos por tipo de fluxo', label, value]));
    return sourceRows;
  }

  private addManagementReport(workbook: ExcelJS.Workbook, projects: any[], queueIds: string[], allocations: any[]) {
    const rows = managementRows(projects, queueIds, allocations);
    const sheet = this.addWorksheet(workbook, 'Relatório Gerencial', MANAGEMENT_HEADERS, rows);
    const widths = [9, 16, 60, 38, 18, 24, 18, 28, 18, 48];
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2, showGridLines: false }];
    sheet.getRow(1).height = 40;
    sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: 10 } };
    sheet.getColumn(2).numFmt = '@'; sheet.getColumn(6).numFmt = 'General'; sheet.getColumn(7).numFmt = '#,##0.00';
    this.styleDateColumns(sheet, [9]);
    rows.forEach((values, index) => {
      const row = sheet.getRow(index + 2); row.font = { name: 'Aptos', size: 11 };
      row.alignment = { wrapText: true, vertical: 'middle' };
      row.height = Math.max(24, ...[2, 3, 7, 9].map(column => Math.ceil(String(values[column] ?? '').length / (widths[column] - 4)) * 16));
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
      [1, 6, 7].forEach(column => { row.getCell(column).alignment = { vertical: 'middle', horizontal: 'right' }; });
    });
    const legendRow = rows.length + 4;
    sheet.mergeCells(legendRow, 1, legendRow + 1, 10);
    sheet.getCell(legendRow, 1).value = 'Ordem vazia: projeto fora da fila atual. Data Conclusão: real para concluídos e estimada no cronograma oficial para ativos. Data vazia: ausência de data real ou previsão, exclusão da simulação ou impedimento. Devolvidos e cancelados não exibem previsão.';
    sheet.getCell(legendRow, 1).alignment = { wrapText: true, vertical: 'middle' };
    sheet.getCell(legendRow, 1).font = { name: 'Aptos', size: 10, italic: true, color: { argb: 'FF667085' } };
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  }

  @Get('exports/:type')
  async exportData(@Param('type') type: string, @Res() res: Response) {
    const allowed = ['projects','schedule','resources','allocations','unavailabilities','committee','complete'];
    if (!allowed.includes(type)) throw new BadRequestException('Tipo de exportação inválido.');
    const workbook = type === 'complete'
      ? await this.prisma.$transaction(tx => this.buildExportWorkbook(type, tx), { isolationLevel: 'RepeatableRead', timeout: 60000 })
      : await this.buildExportWorkbook(type, this.prisma);
    await this.sendWorkbook(res, workbook, `relatorio_${type}_${dateOnlyKey(new Date())}.xlsx`);
  }

  private async buildExportWorkbook(type: string, client: any) {
    const workbook = new ExcelJS.Workbook(); workbook.creator = 'TIC - Gestão de Projetos'; workbook.created = new Date(); const include = (name: string) => type === name || type === 'complete';
    let completeProjects: any[] | undefined;
    if (type === 'complete') {
      const [projects, resources, allocations, catalogs, queue] = await Promise.all([
        client.project.findMany({ include: { classification: true, flowType: true, businessPriority: true, class: true, departments: { include: { department: true } }, systems: { include: { system: true } }, currentSchedule: true } }),
        client.resource.findMany(),
        client.projectPhaseAllocation.findMany({ include: { resource: true, phase: { select: { projectId: true } } } }),
        client.catalogItem.findMany({ where: { type: { in: ['CLASS', 'SYSTEM', 'FLOW_TYPE'] } } }),
        this.engineService.getEffectivePriorityQueue(client),
      ]);
      completeProjects = projects;
      const sourceRows = this.addDashboard(workbook, projects, resources, allocations, catalogs);
      this.addManagementReport(workbook, projects, queue.projects.map(project => project.id), allocations);
      const sourceSheet = this.addWorksheet(workbook, 'Dados do Dashboard', ['Indicador', 'Categoria', 'Valor'], sourceRows);
      sourceSheet.eachRow((row, index) => {
        if (index > 1 && /^(Ganho mensal|Prejuízo mensal|Benefício mensal)/.test(String(row.getCell(1).value))) row.getCell(3).numFmt = '"R$" #,##0.00';
        if (index > 1 && row.getCell(1).value === 'Horas planejadas por recurso em projetos ativos') row.getCell(3).numFmt = '#,##0.00';
      });
    }
    if (include('projects')) {
      const projects: any[] = completeProjects ?? await client.project.findMany({ include: { classification: true, flowType: true, businessPriority: true, class: true, departments: { include: { department: true } }, systems: { include: { system: true } }, currentSchedule: true } });
      const sheet = this.addWorksheet(workbook, 'Projetos', ['SD','Título','Solicitante','Departamentos','Sistemas','Abertura','Prazo Solicitado','Início Simulado','Fim Simulado','Data Real Conclusão','Status','Classificação','Fluxo','Prioridade','Classe','Legal','Horas','Ganho Mensal','Prejuízo Evitado','ROI'], projects.map(project => [project.sdNumber,project.title,project.requester,project.departments.map(item=>item.department.code).join(','),project.systems.map(item=>item.system.code).join(','),project.openingDate,project.requestedDeadline,project.currentSchedule?.startDate,project.currentSchedule?.endDate,project.realCompletionDate,PROJECT_STATUS_LABELS[project.status]||`Status ${project.status}`,project.classification.name,project.flowType.name,project.businessPriority.name,project.class.name,project.isLegalRequirement?'Sim':'Não',project.totalHours,project.estimatedMonthlyGain||0,project.estimatedMonthlyLossAvoided||0,project.roiMonthly||0]));
      this.styleDateColumns(sheet,[6,7,8,9,10]); [18,19,20].forEach(column=>sheet.getColumn(column).numFmt='R$ #,##0.00');
    }
    if (include('schedule')) {
      const schedules: any[] = await client.currentProjectSchedule.findMany({ include: { project: true } });
      const sheet = this.addWorksheet(workbook, 'Cronograma', ['SD','Título','Início Previsto','Fim Previsto','Prazo Solicitado','Variação em Dias','Situação do Prazo','Impedido','Motivo'], schedules.map(item => { const variance = item.endDate && item.project.requestedDeadline ? Math.ceil((item.endDate.getTime()-item.project.requestedDeadline.getTime())/86400000) : ''; return [item.project.sdNumber,item.project.title,item.startDate,item.endDate,item.project.requestedDeadline,variance,SCHEDULE_STATUS_LABELS[item.status]||'Situação não informada',item.isImpeded?'Sim':'Não',sanitizeNaturalLanguage(item.impediments||'')]; }));
      this.styleDateColumns(sheet,[3,4,5]);
    }
    if (include('resources')) {
      const resources: any[] = await client.resource.findMany({ include: { modality: true, role: true } });
      const sheet = this.addWorksheet(workbook, 'Recursos', ['Nome','Modalidade','Função','Horas Semanais','Overhead %','Desenvolvimento %','Horas Líquidas Semanais','Limite de Projetos Simultâneos','Situação'], resources.map(resource => [resource.name,resource.modality.name,resource.role.name,resource.weeklyHours,resource.overheadPercentage,resource.developmentPercentage,Number((resource.weeklyHours*(1-resource.overheadPercentage)*resource.developmentPercentage).toFixed(2)),resource.recommendedWipLimit,USER_STATUS_LABELS[resource.status]||'Não informada']));
      sheet.getColumn(5).numFmt='0.0%'; sheet.getColumn(6).numFmt='0.0%';
    }
    if (include('allocations')) {
      const allocations: any[] = await client.projectPhaseAllocation.findMany({ include: { resource: true, phase: { include: { project: true } } }, orderBy: [{ phase: { project: { sdNumber: 'asc' } } },{ phase: { order: 'asc' } },{ order: 'asc' }] });
      this.addWorksheet(workbook, 'Alocações', ['SD','Projeto','Fase','Recurso','Modo de Execução','Ordem','Horas Alocadas'], allocations.map(item => [item.phase.project.sdNumber,item.phase.project.title,item.phase.name,item.resource.name,EXECUTION_MODE_LABELS[item.phase.executionMode]||'Não informado',item.order,Number((item.minutesAllocated/60).toFixed(2))]));
    }
    if (include('unavailabilities')) {
      const rows: any[] = await client.resourceUnavailability.findMany({ include: { resource: true }, orderBy: { startDate: 'desc' } });
      const sheet = this.addWorksheet(workbook, 'Indisponibilidades', ['Recurso','Tipo','Início','Fim','Horas por Dia','Global','Recorrente','Observação','Situação'], rows.map(item => [item.resource?.name||'Global',UNAVAILABILITY_TYPE_LABELS[item.type]||'Outro',item.startDate,item.endDate,item.unavailableMinutesPerDay==null?'':Number((item.unavailableMinutesPerDay/60).toFixed(2)),item.global?'Sim':'Não',item.annualRecurrence?'Sim':'Não',item.notes||'',USER_STATUS_LABELS[item.status]||'Não informada']));
      this.styleDateColumns(sheet,[3,4]);
    }
    if (include('committee')) {
      const meetings: any[] = await client.committeeMeeting.findMany({ where: { status: 'FINAL' }, include: { createdBy: true, evaluations: { include: { project: true } } }, orderBy: { meetingDate: 'desc' } });
      const sheet = this.addWorksheet(workbook, 'Comitê', ['Data','Versão','Criado por','SD','Projeto','Decisão','Nota','Ganho Mensal Atual','Prejuízo Evitado Atual','Parecer'], meetings.flatMap(meeting => meeting.evaluations.map((evaluation: any) => [meeting.meetingDate,meeting.version,meeting.createdBy.name,evaluation.project.sdNumber,evaluation.project.title,COMMITTEE_DECISION_LABELS[evaluation.decision]||'Não informada',evaluation.score||'',evaluation.project.estimatedMonthlyGain||0,evaluation.project.estimatedMonthlyLossAvoided||0,evaluation.notes||''])));
      this.styleDateColumns(sheet,[1]); sheet.getColumn(8).numFmt='R$ #,##0.00'; sheet.getColumn(9).numFmt='R$ #,##0.00';
    }
    return workbook;
  }
}
