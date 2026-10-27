/**
 * Helpers for civil dates. Values such as vacation start/end dates are not
 * instants in time, so they must never be shifted by the browser timezone.
 */
export function dateOnlyKey(value: string | Date): string {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateOnly(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateOnlyUtcTimestamp(value: string | Date): number {
  const [year, month, day] = dateOnlyKey(value).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function formatDateOnlyPtBr(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const key = dateOnlyKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : key;
}

export function dateOnlyMonthDay(value: string | Date): string {
  return dateOnlyKey(value).slice(5);
}
