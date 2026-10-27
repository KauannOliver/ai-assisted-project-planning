import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { BiApiKeyGuard } from '../../bi/bi-api-key.guard';
import { BiController } from '../../bi/bi.controller';
import { PriorityQueueController } from '../../priority-queue/priority-queue.controller';

const context = (header?: string) => ({
  switchToHttp: () => ({ getRequest: () => ({ headers: header === undefined ? {} : { 'x-api-key': header } }) }),
}) as any;

describe('API exclusiva para BI', () => {
  it('aceita somente a chave configurada no cabeçalho X-API-Key', () => {
    const guard = new BiApiKeyGuard({ get: () => 'segredo-forte-de-teste' } as any);
    expect(guard.canActivate(context('segredo-forte-de-teste'))).toBe(true);
    expect(() => guard.canActivate(context('outra-chave'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
  });

  it('informa indisponibilidade quando a integração não foi configurada', () => {
    const guard = new BiApiKeyGuard({ get: () => '' } as any);
    expect(() => guard.canActivate(context('qualquer-chave'))).toThrow(ServiceUnavailableException);
  });

  it('retorna o portfólio com status zero e datas civis sem deslocamento', async () => {
    const prisma: any = {
      project: { findMany: async () => [{
        id: 'p0', sdNumber: 'SD-0', title: 'Diretoria', requester: 'TIC', status: 0,
        openingDate: new Date('2026-08-20T00:00:00.000Z'), requestedDeadline: null,
        realCompletionDate: null, currentSchedule: null, departments: [], systems: [],
        classification: { code: 'A', name: 'A' }, flowType: { code: 'F', name: 'F' },
        businessPriority: { code: 'P', name: 'P' }, class: { code: 'C', name: 'C' },
        totalHours: 4, isLegalRequirement: false, committeeEvaluations: [],
        createdAt: new Date('2026-08-20T12:00:00.000Z'), updatedAt: new Date('2026-08-20T12:00:00.000Z'),
      }] },
    };
    const response: any = await new BiController(prisma, {} as any).portfolio();
    expect(response.schemaVersion).toBe('1.0');
    expect(response.total).toBe(1);
    expect(response.data[0]).toMatchObject({ statusCode: 0, statusName: '0. Análise Diretoria', openingDate: '2026-08-20' });
    expect(JSON.stringify(response.data[0])).not.toMatch(/password|token|apiKey/i);
  });

  it('retorna a fila efetiva na mesma ordem da tela, com rótulos naturais e dados do cronograma', async () => {
    const queueProjects = [
      {
        id: 'legal', sdNumber: 'SD-LEGAL', title: 'Obrigação legal', requester: 'Jurídico', status: 1,
        committeeDecision: 'PRIORIZADO', committeeScore: 10, isLegalRequirement: true,
        businessPriorityCode: 'alta', openingDate: new Date('2026-08-01T00:00:00.000Z'), requestedDeadline: null,
      },
      {
        id: 'director', sdNumber: 'SD-0', title: 'Análise da diretoria', requester: 'TIC', status: 0,
        committeeDecision: null, committeeScore: 0, isLegalRequirement: false,
        businessPriorityCode: 'media', openingDate: new Date('2026-08-02T00:00:00.000Z'), requestedDeadline: new Date('2026-09-30T00:00:00.000Z'),
      },
    ] as any[];
    const engine: any = {
      getEffectivePriorityQueue: vi.fn().mockResolvedValue({ mode: 'manual', manualOrder: ['director'], projects: queueProjects }),
      getDatabaseStateHash: vi.fn().mockResolvedValue('hash'),
    };
    const prisma: any = {
      projectPhaseAllocation: { findMany: vi.fn().mockResolvedValue([
        { phase: { projectId: 'legal' }, resource: { name: 'Willian Almeida' } },
        { phase: { projectId: 'legal' }, resource: { name: 'Ana Souza' } },
        { phase: { projectId: 'legal' }, resource: { name: 'Willian Almeida' } },
      ]) },
      project: { findMany: vi.fn().mockResolvedValue([
        {
          id: 'director', sdNumber: 'SD-0', title: 'Análise da diretoria', requester: 'TIC', status: 0,
          committeeDecision: null, committeeScore: null, isLegalRequirement: false,
          businessPriority: { code: 'media', name: 'Média' },
          openingDate: new Date('2026-08-02T00:00:00.000Z'), requestedDeadline: new Date('2026-09-30T00:00:00.000Z'),
          currentSchedule: null,
        },
        {
          id: 'legal', sdNumber: 'SD-LEGAL', title: 'Obrigação legal', requester: 'Jurídico', status: 1,
          committeeDecision: 'PRIORIZADO', committeeScore: 10, isLegalRequirement: true,
          businessPriority: { code: 'alta', name: 'Alta' },
          openingDate: new Date('2026-08-01T00:00:00.000Z'), requestedDeadline: null,
          currentSchedule: {
            startDate: new Date('2026-08-03T00:00:00.000Z'), endDate: new Date('2026-08-10T00:00:00.000Z'),
            status: 'ON_TIME', isImpeded: false, impediments: null,
          },
        },
      ]) },
    };

    const internal = await new PriorityQueueController(prisma, engine, {} as any).getQueue();
    const response: any = await new BiController(prisma, engine).priorityQueue();

    expect(internal.projects.map(project => project.id)).toEqual(['legal', 'director']);
    expect(internal.projects[0].allocatedResourceNames).toEqual(['Ana Souza', 'Willian Almeida']);
    expect(internal.projects[1].allocatedResourceNames).toEqual([]);
    expect(response).toMatchObject({ schemaVersion: '1.0', total: 2, queueModeCode: 'manual', queueModeName: 'Manual' });
    expect(response.data.map((project: any) => project.projectId)).toEqual(['legal', 'director']);
    expect(response.data[0]).toMatchObject({
      queuePosition: 1,
      statusName: '1. Ideia Registrada',
      committeeDecisionName: 'Priorizado',
      businessPriorityName: 'Alta',
      simulatedEndDate: '2026-08-10',
      scheduleSituationName: 'Dentro do prazo solicitado',
      scheduleImpeded: false,
    });
    expect(response.data[1]).toMatchObject({
      queuePosition: 2,
      statusName: '0. Análise Diretoria',
      committeeDecisionCode: 'NAO_AVALIADO',
      committeeDecisionName: 'Não avaliado',
      committeeScore: null,
      simulatedEndDate: null,
      scheduleSituationName: null,
    });
    expect(JSON.stringify(response.data)).not.toMatch(/password|token|apiKey/i);
  });

  it('inclui a nova rota no manifesto do BI', async () => {
    const prisma: any = { scheduleRun: { findFirst: vi.fn().mockResolvedValue(null) } };
    const response: any = await new BiController(prisma, {} as any).manifest();
    expect(response.data).toContainEqual({ name: 'priority-queue', url: '/bi/v1/priority-queue' });
  });
});
