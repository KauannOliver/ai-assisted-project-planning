import { describe, expect, it } from 'vitest';
import {
  containsForbiddenPresentationTerm,
  formatCivilDatePtBr,
  parseCivilDate,
  parseProjectStatus,
  resolveCatalogItem,
  resolveFriendlyEnum,
  sanitizeNaturalLanguage,
  splitMultiValues,
  EXECUTION_MODE_LABELS,
} from '../../imports-exports/import-export.utils';

describe('import and export presentation helpers', () => {
  it('parses pt-BR and legacy ISO dates as the same civil day', () => {
    expect(parseCivilDate('14/05/2026').toISOString()).toBe('2026-05-14T00:00:00.000Z');
    expect(parseCivilDate('2026-05-14').toISOString()).toBe('2026-05-14T00:00:00.000Z');
    expect(formatCivilDatePtBr(parseCivilDate('2026-05-14'))).toBe('14/05/2026');
    expect(Number.isNaN(parseCivilDate('31/02/2026').getTime())).toBe(true);
  });

  it('accepts friendly labels while preserving legacy technical inputs', () => {
    expect(parseProjectStatus('0. Análise Diretoria')).toBe(0);
    expect(parseProjectStatus('Análise Diretoria')).toBe(0);
    expect(parseProjectStatus('6. Homologação')).toBe(6);
    expect(parseProjectStatus('Concluído')).toBe(7);
    expect(resolveFriendlyEnum('Simultâneo', EXECUTION_MODE_LABELS)).toBe('SIMULTANEOUS');
    expect(resolveFriendlyEnum('SEQUENTIAL', EXECUTION_MODE_LABELS)).toBe('SEQUENTIAL');
  });

  it('resolves catalog values by code, name or combined display value', () => {
    const items = [{ code: 'TIC', name: 'Tecnologia da Informação e Comunicação' }];
    expect(resolveCatalogItem(items, 'TIC')).toEqual(items[0]);
    expect(resolveCatalogItem(items, 'Tecnologia da Informação e Comunicação')).toEqual(items[0]);
    expect(resolveCatalogItem(items, 'TIC — Tecnologia da Informação e Comunicação')).toEqual(items[0]);
    expect(splitMultiValues('TIC, COM\nDHO')).toEqual(['TIC', 'COM', 'DHO']);
  });

  it('removes internal terms from user-facing narratives', () => {
    const result = sanitizeNaturalLanguage('Projeto DELAYED, antes ON_TIME, mudou de SIMULTANEOUS para SEQUENTIAL.');
    expect(result).toContain('após o prazo solicitado');
    expect(result).toContain('dentro do prazo solicitado');
    expect(result).toContain('simultâneo');
    expect(containsForbiddenPresentationTerm(result)).toBe(false);
  });
});
