export const PROJECT_STATUS_LABELS: Record<number, string> = {
  0: 'Análise Diretoria',
  1: 'Ideia Registrada',
  2: 'Agendar Reunião',
  4: 'Análise TAP',
  5: 'Processo de Software',
  6: 'Homologação',
  7: 'Concluído',
  8: 'Devolvido para o Solicitante',
  9: 'Cancelado',
};

export const PROJECT_STATUS_FULL_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_LABELS).map(([code, label]) => [Number(code), `${code}. ${label}`]),
);

export const PROJECT_STATUS_CODES = Object.freeze(
  Object.keys(PROJECT_STATUS_LABELS).map(Number),
);

export const PROJECT_STATUS_COLORS: Record<number, string> = {
  0: '#212a57',
  1: '#3b5998',
  2: '#7c3aed',
  4: '#c2410c',
  5: '#079ae1',
  6: '#a21caf',
  7: '#10b981',
  8: '#f59e0b',
  9: '#64748b',
};
