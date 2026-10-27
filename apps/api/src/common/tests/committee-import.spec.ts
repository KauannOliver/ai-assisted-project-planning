import { describe, expect, it } from 'vitest';
import {
  committeeFileIdentity, dedupeLogicalMeetings, parseCommitteeDecision,
  parseImportNumber, resolveCommitteeProject,
} from '../../committee/committee-import.utils';

describe('committee import helpers', () => {
  const projects = [
    { id: 'p1', sdNumber: '433034', title: 'CONTROLE_DE_ACESSOS' },
    { id: 'p2', sdNumber: '429412', title: 'Projeto dois' },
  ];

  it('accepts natural and legacy committee decisions', () => {
    expect(parseCommitteeDecision('Priorizado')).toBe('PRIORIZADO');
    expect(parseCommitteeDecision('Segunda fase')).toBe('SEGUNDA_FASE');
    expect(parseCommitteeDecision('CANCELADO')).toBe('CANCELADO');
    expect(parseCommitteeDecision('Não avaliado')).toBeUndefined();
  });

  it('resolves projects by SD, title or combined list label', () => {
    expect(resolveCommitteeProject(projects, '433034')?.id).toBe('p1');
    expect(resolveCommitteeProject(projects, 'CONTROLE_DE_ACESSOS')?.id).toBe('p1');
    expect(resolveCommitteeProject(projects, '433034 — CONTROLE_DE_ACESSOS')?.id).toBe('p1');
  });

  it('validates the one-file-one-meeting identity', () => {
    const rows: any[] = [
      { __line: 2, meetingDate: '14/08/2026', meetingNotes: 'Reunião mensal', sd: '433034', decision: 'Priorizado', score: '8', projectNotes: '', gain: '', loss: '' },
      { __line: 3, meetingDate: '14/08/2026', meetingNotes: '', sd: '429412', decision: 'Segunda fase', score: '7', projectNotes: '', gain: '', loss: '' },
    ];
    expect(committeeFileIdentity(rows)).toMatchObject({ meetingDateKey: '2026-08-14', hasMultipleDates: false, hasConflictingNotes: false, notes: 'Reunião mensal' });
    rows[1].meetingDate = '15/08/2026';
    expect(committeeFileIdentity(rows).hasMultipleDates).toBe(true);
  });

  it('parses pt-BR monetary values', () => {
    expect(parseImportNumber('R$ 1.234,56')).toBe(1234.56);
    expect(parseImportNumber('2500')).toBe(2500);
    expect(parseImportNumber('')).toBeNull();
    expect(Number.isNaN(parseImportNumber('valor'))).toBe(true);
  });

  it('keeps one active item for legacy sibling revisions', () => {
    const meetings = [
      { id: 'newer', supersedesMeetingId: 'original', updatedAt: '2026-08-14T12:00:00Z' },
      { id: 'sibling', supersedesMeetingId: 'original', updatedAt: '2026-08-14T10:00:00Z' },
      { id: 'independent', supersedesMeetingId: null, updatedAt: '2026-08-13T10:00:00Z' },
    ];
    expect(dedupeLogicalMeetings(meetings).map(item => item.id)).toEqual(['newer', 'independent']);
  });
});
