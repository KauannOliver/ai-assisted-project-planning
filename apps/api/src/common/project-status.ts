export const PROJECT_STATUS_LABELS: Record<number, string> = {
  0: '0. Análise Diretoria',
  1: '1. Ideia Registrada',
  2: '2. Agendar Reunião',
  4: '4. Análise TAP',
  5: '5. Processo de Software',
  6: '6. Homologação',
  7: '7. Concluído',
  8: '8. Devolvido para o Solicitante',
  9: '9. Cancelado',
};

export const PROJECT_STATUS_CODES = Object.freeze(
  Object.keys(PROJECT_STATUS_LABELS).map(Number),
);

export const ACTIVE_PROJECT_STATUS_CODES = Object.freeze([0, 1, 2, 4, 5, 6]);
export const TERMINAL_PROJECT_STATUS_CODES = Object.freeze([7, 8, 9]);

export function projectStatusLabel(status: number): string {
  return PROJECT_STATUS_LABELS[status] ?? `Status ${status}`;
}
