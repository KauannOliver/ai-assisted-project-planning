import {
  COMMITTEE_DECISION_LABELS,
  dateOnlyKey,
  normalizeText,
  parseCivilDate,
  resolveFriendlyEnum,
} from '../imports-exports/import-export.utils';

export type CommitteeImportRow = {
  __line: number;
  meetingDate: string;
  meetingNotes: string;
  sd: string;
  decision: string;
  score: string;
  projectNotes: string;
  gain: string;
  loss: string;
};

export function parseCommitteeDecision(value: unknown) {
  const decision = resolveFriendlyEnum(value, COMMITTEE_DECISION_LABELS);
  return ['PRIORIZADO', 'SEGUNDA_FASE', 'CANCELADO'].includes(decision || '') ? decision : undefined;
}

export function parseImportNumber(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/R\$/gi, '').replace(/\s/g, '');
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function resolveCommitteeProject<T extends { sdNumber: string; title: string }>(projects: T[], value: unknown): T | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  return projects.find(project => {
    const sd = normalizeText(project.sdNumber);
    const title = normalizeText(project.title);
    return normalized === sd
      || normalized === title
      || normalized === normalizeText(`${project.sdNumber} — ${project.title}`)
      || normalized.startsWith(`${sd} - `);
  });
}

export function committeeFileIdentity(rows: CommitteeImportRow[]) {
  const dateKeys = new Set(rows.map(row => dateOnlyKey(parseCivilDate(row.meetingDate))).filter(Boolean));
  const notes = Array.from(new Set(rows.map(row => normalizeText(row.meetingNotes)).filter(Boolean)));
  return {
    meetingDateKey: dateKeys.size === 1 ? Array.from(dateKeys)[0]! : null,
    hasMultipleDates: dateKeys.size > 1,
    notes: rows.find(row => row.meetingNotes.trim())?.meetingNotes.trim() || '',
    hasConflictingNotes: notes.length > 1,
  };
}

export function dedupeLogicalMeetings<T extends { id: string; supersedesMeetingId?: string | null; updatedAt?: Date | string }>(meetings: T[]) {
  const referenced = new Set(meetings.map(item => item.supersedesMeetingId).filter((value): value is string => Boolean(value)));
  const latestByKey = new Map<string, T>();
  for (const meeting of meetings) {
    if (referenced.has(meeting.id)) continue;
    const key = meeting.supersedesMeetingId ? `revision:${meeting.supersedesMeetingId}` : `meeting:${meeting.id}`;
    const current = latestByKey.get(key);
    const currentTime = current?.updatedAt ? new Date(current.updatedAt).getTime() : 0;
    const meetingTime = meeting.updatedAt ? new Date(meeting.updatedAt).getTime() : 0;
    if (!current || meetingTime >= currentTime) latestByKey.set(key, meeting);
  }
  return Array.from(latestByKey.values());
}
