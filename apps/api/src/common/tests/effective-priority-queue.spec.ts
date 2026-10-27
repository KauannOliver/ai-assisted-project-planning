import { describe, expect, it, vi } from 'vitest';
import { EngineService } from '../../engine/engine.service';

const project = (id: string, legal = false) => ({
  id,
  sdNumber: `SD-${id}`,
  title: id,
  requester: 'TIC',
  totalHours: 1,
  status: id === 'director' ? 0 : 1,
  isLegalRequirement: legal,
  businessPriorityCode: 'media',
  committeeDecision: null,
  committeeScore: 0,
  openingDate: new Date('2026-08-01T00:00:00.000Z'),
  requestedDeadline: null,
  phases: [],
});

describe('fila efetiva compartilhada', () => {
  it('mantém a ordenação automática calculada pelo motor', async () => {
    const prisma: any = { priorityQueueState: { findUnique: vi.fn().mockResolvedValue({ mode: 'automatic', manualOrder: '[]' }) } };
    const engine = new EngineService(prisma);
    const ordered = [project('first'), project('director')];
    vi.spyOn(engine, 'fetchEngineInput').mockResolvedValue({ projects: [...ordered] } as any);
    vi.spyOn(engine, 'sortFilaAutomatic').mockResolvedValue(ordered as any);

    const result = await engine.getEffectivePriorityQueue(prisma);

    expect(result.mode).toBe('automatic');
    expect(result.projects.map(item => item.id)).toEqual(['first', 'director']);
  });

  it('respeita integralmente a ordem manual e acrescenta projetos ausentes ao final', async () => {
    const prisma: any = {
      priorityQueueState: { findUnique: vi.fn().mockResolvedValue({ mode: 'manual', manualOrder: '["second","legal"]' }) },
    };
    const engine = new EngineService(prisma);
    const automatic = [project('legal', true), project('unlisted'), project('second'), project('director')];
    vi.spyOn(engine, 'fetchEngineInput').mockResolvedValue({ projects: [...automatic] } as any);
    vi.spyOn(engine, 'sortFilaAutomatic').mockResolvedValue(automatic as any);

    const result = await engine.getEffectivePriorityQueue(prisma);

    expect(result.mode).toBe('manual');
    expect(result.manualOrder).toEqual(['second', 'legal']);
    expect(result.projects.map(item => item.id)).toEqual(['second', 'legal', 'unlisted', 'director']);
  });

  it('normaliza ids repetidos de uma ordem manual legada', async () => {
    const prisma: any = {
      priorityQueueState: { findUnique: vi.fn().mockResolvedValue({ mode: 'manual', manualOrder: '["second","second","legal"]' }) },
    };
    const engine = new EngineService(prisma);
    const automatic = [project('legal', true), project('second')];
    vi.spyOn(engine, 'fetchEngineInput').mockResolvedValue({ projects: [...automatic] } as any);
    vi.spyOn(engine, 'sortFilaAutomatic').mockResolvedValue(automatic as any);
    const result = await engine.getEffectivePriorityQueue(prisma);
    expect(result.manualOrder).toEqual(['second', 'legal']);
    expect(result.projects.map(item => item.id)).toEqual(['second', 'legal']);
  });

  it('trata uma ordenação manual inválida como lista vazia sem interromper a leitura', async () => {
    const prisma: any = {
      priorityQueueState: { findUnique: vi.fn().mockResolvedValue({ mode: 'manual', manualOrder: 'inválido' }) },
    };
    const engine = new EngineService(prisma);
    const automatic = [project('legal', true), project('director')];
    vi.spyOn(engine, 'fetchEngineInput').mockResolvedValue({ projects: [...automatic] } as any);
    vi.spyOn(engine, 'sortFilaAutomatic').mockResolvedValue(automatic as any);

    const result = await engine.getEffectivePriorityQueue(prisma);

    expect(result.manualOrder).toEqual([]);
    expect(result.projects.map(item => item.id)).toEqual(['legal', 'director']);
  });
});
