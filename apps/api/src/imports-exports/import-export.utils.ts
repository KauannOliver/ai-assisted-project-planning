export { PROJECT_STATUS_LABELS } from '../common/project-status';
import { PROJECT_STATUS_LABELS } from '../common/project-status';

export const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  ON_TIME: 'Dentro do prazo solicitado',
  AT_RISK: 'Próximo do prazo solicitado',
  DELAYED: 'Após o prazo solicitado',
  NEW_FORECAST: 'Passou a ter previsão',
  REMOVED_FROM_SCHEDULE: 'Saiu da simulação',
};

export const EXECUTION_MODE_LABELS: Record<string, string> = {
  SIMULTANEOUS: 'Simultâneo',
  SEQUENTIAL: 'Sequencial',
};

export const UNAVAILABILITY_TYPE_LABELS: Record<string, string> = {
  FERIADO: 'Feriado ou recesso',
  FERIAS: 'Férias',
  ATESTADO: 'Atestado',
  TREINAMENTO: 'Treinamento',
  LICENCA: 'Licença',
  OUTRO: 'Outro',
};

export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
};

export const COMMITTEE_DECISION_LABELS: Record<string, string> = {
  PRIORIZADO: 'Priorizado',
  SEGUNDA_FASE: 'Segunda fase',
  CANCELADO: 'Cancelado',
  NAO_AVALIADO: 'Não avaliado',
  // Aliases retained for old exports and integrations.
  PRIORITIZED: 'Priorizado',
  SECOND_PHASE: 'Segunda fase',
  CANCELLED: 'Cancelado',
  PENDING: 'Não avaliado',
};

export const IMPORT_TYPE_LABELS: Record<string, string> = {
  projects: 'projetos',
  allocations: 'alocações de recursos',
  unavailabilities: 'indisponibilidades',
  committee: 'reuniões e avaliações do comitê',
};

const TECHNICAL_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bREMOVED_FROM_SCHEDULE\b/gi, 'saiu da simulação'],
  [/\bNEW_FORECAST\b/gi, 'passou a ter previsão'],
  [/\bAT_RISK\b/gi, 'próximo do prazo solicitado'],
  [/\bON[_ ]?TIME\b/gi, 'dentro do prazo solicitado'],
  [/\bDELAYED\b/gi, 'após o prazo solicitado'],
  [/\bSIMULTANEOUS\b/gi, 'simultâneo'],
  [/\bSEQUENTIAL\b/gi, 'sequencial'],
];

export const FORBIDDEN_PRESENTATION_TERMS = [
  'DELAYED', 'ON_TIME', 'ONTIME', 'AT_RISK', 'NEW_FORECAST',
  'REMOVED_FROM_SCHEDULE', 'SIMULTANEOUS', 'SEQUENTIAL',
];

export function sanitizeNaturalLanguage(value: unknown): string {
  let result = String(value ?? '');
  TECHNICAL_TERM_REPLACEMENTS.forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });
  return result;
}

export function containsForbiddenPresentationTerm(value: unknown): boolean {
  const normalized = String(value ?? '').toUpperCase().replace(/\s+/g, '_');
  return FORBIDDEN_PRESENTATION_TERMS.some(term => normalized.includes(term));
}

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

export function normalizeHeader(value: unknown): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

export function parseCivilDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const raw = String(value ?? '').trim();
  let match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (match) {
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
  } else {
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!match) return new Date(Number.NaN);
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return new Date(Number.NaN);
  }
  return date;
}

export function formatCivilDatePtBr(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : parseCivilDate(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

export function dateOnlyKey(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseCivilDate(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function parseProjectStatus(value: unknown): number {
  const raw = String(value ?? '').trim();
  const numeric = Number(raw.match(/^\s*(\d+)/)?.[1] ?? raw);
  if (Object.prototype.hasOwnProperty.call(PROJECT_STATUS_LABELS, numeric)) return numeric;
  const normalized = normalizeText(raw);
  const found = Object.entries(PROJECT_STATUS_LABELS).find(([, label]) => normalizeText(label.replace(/^\d+\.\s*/, '')) === normalized);
  return found ? Number(found[0]) : Number.NaN;
}

export function resolveFriendlyEnum(value: unknown, labels: Record<string, string>): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const technical = Object.keys(labels).find(key => normalizeText(key) === normalizeText(raw));
  if (technical) return technical;
  return Object.entries(labels).find(([, label]) => normalizeText(label) === normalizeText(raw))?.[0];
}

export function catalogDisplayValue(item: { code: string; name: string }): string {
  return `${item.code} — ${item.name}`;
}

export function resolveCatalogItem<T extends { code: string; name: string }>(items: T[], value: unknown): T | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  return items.find(item => {
    const code = normalizeText(item.code);
    const name = normalizeText(item.name);
    return normalized === code || normalized === name || normalized === normalizeText(catalogDisplayValue(item)) || normalized.startsWith(`${code} - `);
  });
}

export function splitMultiValues(value: unknown): string[] {
  return String(value ?? '').split(/[,\n]+/).map(item => item.trim()).filter(Boolean);
}

export function sameStringSet(left: string[], right: string[]): boolean {
  const a = [...left].map(normalizeText).sort();
  const b = [...right].map(normalizeText).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
