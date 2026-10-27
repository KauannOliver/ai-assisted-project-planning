import { PROJECT_STATUS_FULL_LABELS as PROJECT_STATUS_LABELS } from './project-status';
export { PROJECT_STATUS_FULL_LABELS as PROJECT_STATUS_LABELS } from './project-status';

const PHASE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Não iniciada', IN_PROGRESS: 'Em andamento', COMPLETED: 'Concluída',
};

const EXECUTION_MODE_LABELS: Record<string, string> = {
  SIMULTANEOUS: 'Simultâneo', SEQUENTIAL: 'Sequencial',
};

const PARAMETER_LABELS: Record<string, string> = {
  eligibility_mode: 'Entrada de projetos na simulação',
  queue_mode: 'Modo de ordenação da fila',
  queue_rules: 'Critérios de priorização da fila',
  engine_working_days: 'Dias úteis produtivos',
  engine_calculation_unit_minutes: 'Unidade de estimativa de esforço',
  engine_holiday_behavior: 'Consideração de feriados',
  engine_start_calc_date: 'Marco inicial da simulação',
  engine_wip_mode: 'Limite de projetos simultâneos',
  engine_default_wip_limit: 'Quantidade recomendada de projetos simultâneos',
  engine_max_schedule_days: 'Horizonte máximo da simulação',
};

const formatDate = (value: unknown) => {
  if (!value) return 'sem data definida';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
};

const resourceNames = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) return 'nenhum recurso';
  return value.map((item: any) => item?.resource?.name || item?.name || item?.resourceId || 'recurso').join(', ');
};

const sanitizeNaturalLanguage = (value: unknown) => String(value || '')
  .replace(/\bREMOVED_FROM_SCHEDULE\b/gi, 'saiu da simulação')
  .replace(/\bNEW_FORECAST\b/gi, 'passou a ter previsão')
  .replace(/\bAT_RISK\b/gi, 'próximo do prazo solicitado')
  .replace(/\bON[_ ]?TIME\b/gi, 'dentro do prazo solicitado')
  .replace(/\bDELAYED\b/gi, 'após o prazo solicitado')
  .replace(/\bSIMULTANEOUS\b/gi, 'simultâneo')
  .replace(/\bSEQUENTIAL\b/gi, 'sequencial');

const displayChangedValue = (value: any) => {
  const raw = value?.value ?? value;
  if (Array.isArray(raw)) return raw.length ? raw.join(', ') : 'nenhum';
  if (raw === null || raw === undefined || raw === '') return 'não informado';
  if (raw === true) return 'Sim';
  if (raw === false) return 'Não';
  return sanitizeNaturalLanguage(raw);
};

export function formatHistoryDescription(event: any): string {
  const before = event?.metadata?.before;
  const after = event?.metadata?.after;
  const beforeStatus = before?.status !== undefined ? Number(before.status) : undefined;
  const afterStatus = after?.status !== undefined ? Number(after.status) : undefined;

  if (event?.eventType === 'PARAMETER_CHANGED') {
    const label = PARAMETER_LABELS[event?.aggregateId] || 'Configuração de governança';
    return `${label} atualizada com sucesso.`;
  }
  if (event?.eventType === 'COMMITTEE_MEETING_DELETED') {
    return 'A reunião de comitê foi removida da visualização, mantendo seu registro para auditoria.';
  }
  if (event?.eventType === 'COMMITTEE_MEETING_REVISED') {
    return 'A reunião de comitê foi editada e uma nova versão da ata foi registrada.';
  }
  if (event?.eventType === 'QUEUE_MANUAL_REORDER') {
    return 'A ordem de execução dos projetos foi reorganizada manualmente.';
  }

  if (event?.eventType === 'PROJECT_STATUS_CHANGED') {
    if (beforeStatus !== undefined && afterStatus !== undefined) {
      return `O projeto saiu de ${PROJECT_STATUS_LABELS[beforeStatus] || beforeStatus} e foi para ${PROJECT_STATUS_LABELS[afterStatus] || afterStatus}${event?.metadata?.source === 'IMPORT' ? ' por meio de importação' : ''}.`;
    }
    // Compatibility with historical records created before structured metadata.
    const legacyStatuses = String(event?.description || '').match(/(?:alterado|mudou|saiu)\D+(\d+)\D+(?:para|foi para)\D+(\d+)/i);
    if (legacyStatuses) {
      const from = Number(legacyStatuses[1]);
      const to = Number(legacyStatuses[2]);
      return `O projeto saiu de ${PROJECT_STATUS_LABELS[from] || from} e foi para ${PROJECT_STATUS_LABELS[to] || to}.`;
    }
  }
  if (['PROJECT_FIELD_CHANGED', 'PROJECT_DEPARTMENTS_CHANGED', 'PROJECT_SYSTEMS_CHANGED'].includes(event?.eventType)) {
    return `${event?.metadata?.fieldLabel || 'Informação do projeto'}: de ${displayChangedValue(before)} para ${displayChangedValue(after)}${event?.metadata?.source === 'IMPORT' ? ' por meio de importação' : ''}.`;
  }
  if (event?.eventType === 'PROJECT_IMPORTED') {
    return 'O projeto foi criado por meio de importação.';
  }
  if (event?.eventType === 'PROJECT_REOPENED' && beforeStatus !== undefined && afterStatus !== undefined) {
    return `O projeto foi reaberto: saiu de ${PROJECT_STATUS_LABELS[beforeStatus] || beforeStatus} e voltou para ${PROJECT_STATUS_LABELS[afterStatus] || afterStatus}, retornando ao motor de simulação.`;
  }
  if (event?.eventType === 'PROJECT_COMPLETED') {
    const origin = beforeStatus !== undefined ? PROJECT_STATUS_LABELS[beforeStatus] || beforeStatus : 'seu estágio anterior';
    return `O projeto saiu de ${origin} e foi para ${PROJECT_STATUS_LABELS[7]}${after?.realCompletionDate ? `, com conclusão real em ${formatDate(after.realCompletionDate)}` : ''}.`;
  }
  if (event?.eventType === 'PROJECT_CANCELLED') {
    const origin = beforeStatus !== undefined ? PROJECT_STATUS_LABELS[beforeStatus] || beforeStatus : 'seu estágio anterior';
    return `O projeto saiu de ${origin} e foi para ${PROJECT_STATUS_LABELS[9]}.`;
  }
  if (event?.eventType === 'PROJECT_CREATED') {
    const status = afterStatus !== undefined ? PROJECT_STATUS_LABELS[afterStatus] || afterStatus : PROJECT_STATUS_LABELS[1];
    return `O projeto foi cadastrado no estágio ${status}.`;
  }
  if (event?.eventType === 'PROJECT_DEADLINE_CHANGED') {
    return `O prazo solicitado foi alterado de ${formatDate(before?.requestedDeadline ?? before)} para ${formatDate(after?.requestedDeadline ?? after)}.`;
  }
  if (event?.eventType === 'PROJECT_PRIORITY_CHANGED') {
    return `A prioridade do projeto foi alterada${before?.businessPriorityName && after?.businessPriorityName ? ` de ${before.businessPriorityName} para ${after.businessPriorityName}` : ''}.`;
  }
  if (event?.eventType === 'PHASE_EXECUTION_MODE_CHANGED') {
    return `O modo de execução da fase foi alterado de ${EXECUTION_MODE_LABELS[String(before)] || before} para ${EXECUTION_MODE_LABELS[String(after)] || after}.`;
  }
  if (event?.eventType === 'PHASE_RESOURCES_CHANGED') {
    return `A alocação da fase foi atualizada: de ${resourceNames(before)} para ${resourceNames(after)}.`;
  }
  if (event?.eventType === 'PHASE_PROGRESS_CHANGED') {
    const phaseBeforeStatus = PHASE_STATUS_LABELS[String(before?.status)] || before?.status;
    const phaseAfterStatus = PHASE_STATUS_LABELS[String(after?.status)] || after?.status;
    return `O registro histórico da fase mudou de ${phaseBeforeStatus} para ${phaseAfterStatus}.`;
  }
  if (event?.eventType === 'PROJECT_UPDATED' && before && after) {
    const changes: string[] = [];
    if (before.title !== after.title) changes.push('título');
    if (before.requester !== after.requester) changes.push('solicitante');
    if (before.totalHours !== after.totalHours) changes.push(`esforço de ${before.totalHours}h para ${after.totalHours}h`);
    if (before.requestedDeadline !== after.requestedDeadline) changes.push(`prazo de ${formatDate(before.requestedDeadline)} para ${formatDate(after.requestedDeadline)}`);
    if (before.realCompletionDate !== after.realCompletionDate) changes.push(`data real de conclusão para ${formatDate(after.realCompletionDate)}`);
    if (before.isLegalRequirement !== after.isLegalRequirement) changes.push(after.isLegalRequirement ? 'marcado como requisito legal' : 'retirado de requisito legal');
    if (before.estimatedMonthlyGain !== after.estimatedMonthlyGain) changes.push('ganho mensal estimado');
    if (before.estimatedMonthlyLossAvoided !== after.estimatedMonthlyLossAvoided) changes.push('prejuízo mensal evitado');
    return changes.length > 0 ? `Informações atualizadas: ${changes.join(', ')}.` : 'As informações cadastrais do projeto foram atualizadas.';
  }
  return sanitizeNaturalLanguage(event?.description || 'Alteração registrada no sistema.');
}
