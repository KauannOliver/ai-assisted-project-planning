import { Injectable } from '@nestjs/common';
import { sanitizeNaturalLanguage } from '../imports-exports/import-export.utils';
import { projectStatusLabel } from '../common/project-status';

export const BUSINESS_EVENT_LABELS: Record<string, string> = {
  PROJECT_CREATED: 'Projeto criado',
  PROJECT_IMPORTED: 'Projeto importado',
  PROJECT_IMPORTED_UPDATED: 'Projeto atualizado por importação',
  PROJECT_FIELD_CHANGED: 'Informação do projeto alterada',
  PROJECT_DEPARTMENTS_CHANGED: 'Departamentos do projeto alterados',
  PROJECT_SYSTEMS_CHANGED: 'Sistemas do projeto alterados',
  PROJECT_UPDATED: 'Projeto atualizado',
  PROJECT_EFFORT_RECONCILED: 'Horas do projeto reconciliadas',
  PROJECT_STATUS_CHANGED: 'Status do projeto alterado',
  PROJECT_COMPLETED: 'Projeto concluído',
  PROJECT_CANCELLED: 'Projeto cancelado',
  PROJECT_REOPENED: 'Projeto reaberto no motor',
  PROJECT_PERMANENTLY_DELETED: 'Projeto excluído permanentemente',
  PROJECT_PRIORITY_CHANGED: 'Prioridade do projeto alterada',
  PROJECT_DEADLINE_CHANGED: 'Prazo solicitado alterado',
  PHASE_PROGRESS_CHANGED: 'Progresso da fase alterado',
  PHASE_RESOURCES_CHANGED: 'Recursos da fase alterados',
  PHASE_EXECUTION_MODE_CHANGED: 'Modo de execução da fase alterado',
  RESOURCE_CREATED: 'Recurso criado',
  RESOURCE_UPDATED: 'Recurso atualizado',
  RESOURCE_STATUS_CHANGED: 'Situação do recurso alterada',
  UNAVAILABILITY_CREATED: 'Indisponibilidade criada',
  UNAVAILABILITY_UPDATED: 'Indisponibilidade atualizada',
  UNAVAILABILITY_STATUS_CHANGED: 'Situação da indisponibilidade alterada',
  COMMITTEE_MEETING_CREATED: 'Ata do comitê registrada',
  COMMITTEE_MEETING_REVISED: 'Ata do comitê revisada',
  COMMITTEE_MEETING_DELETED: 'Reunião de comitê removida',
  PROJECT_COMMITTEE_STATE_CHANGED: 'Decisão do comitê aplicada ao projeto',
  PROJECT_COMMITTEE_STATE_RESTORED: 'Situação anterior do projeto restaurada',
  QUEUE_MANUAL_REORDER: 'Fila de prioridades reordenada',
  PARAMETER_CHANGED: 'Parâmetro de governança alterado',
  DELIVERY_CREATED: 'Entrega criada',
  DELIVERY_UPDATED: 'Entrega atualizada',
  DELIVERY_DELETED: 'Entrega removida',
  DELIVERY_FEEDBACK_CREATED: 'Devolutiva criada',
  DELIVERY_FEEDBACK_UPDATED: 'Devolutiva atualizada',
  DELIVERY_FEEDBACK_DELETED: 'Devolutiva removida',
  PLANNED_DELIVERY_CREATED: 'Entrega planejada criada',
  PLANNED_DELIVERY_UPDATED: 'Entrega planejada atualizada',
  PLANNED_DELIVERY_DELETED: 'Entrega planejada removida',
  MASS_IMPORT_DATA: 'Importação em massa concluída',
  MASS_IMPORT_COMPLETED: 'Importação em massa concluída',
  PROFILE_UPDATED: 'Perfil atualizado',
};

export const GOVERNANCE_PARAMETER_LABELS: Record<string, string> = {
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
  engine_delay_risk_tolerance_days: 'Margem para alerta de atraso',
  engine_risk_tolerance_days: 'Tolerância para riscos de prazo',
  engine_summary_impact_limit: 'Quantidade de impactos exibidos',
};

export function humanizeBusinessEventLabel(eventType: string) {
  const mapped = BUSINESS_EVENT_LABELS[eventType];
  if (mapped) return mapped;
  const phrase = eventType.replace(/_/g, ' ').toLocaleLowerCase('pt-BR');
  return phrase.charAt(0).toLocaleUpperCase('pt-BR') + phrase.slice(1);
}

export function humanizeBusinessEventDescription(event: {
  eventType: string;
  aggregateId?: string;
  description?: string;
  metadata?: any;
}) {
  const metadata = event.metadata || {};
  const sourceSuffix = metadata.source === 'IMPORT' ? ' por meio de importação' : '';
  const statusLabel = (value: any) => {
    const raw = value?.status ?? value;
    if (raw === null || raw === undefined || raw === '') return 'não informado';
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? projectStatusLabel(numeric) : String(value?.label ?? raw);
  };
  const displayValue = (value: any) => {
    const raw = value?.value ?? value;
    if (Array.isArray(raw)) return raw.length ? raw.join(', ') : 'nenhum';
    if (raw === null || raw === undefined || raw === '') return 'não informado';
    if (raw === true) return 'Sim';
    if (raw === false) return 'Não';
    return String(raw);
  };
  switch (event.eventType) {
    case 'PARAMETER_CHANGED': {
      const key = event.aggregateId || metadata.key || '';
      const label = GOVERNANCE_PARAMETER_LABELS[key] || 'Configuração de governança';
      return `${label} atualizada com sucesso.`;
    }
    case 'COMMITTEE_MEETING_CREATED': return 'Uma nova reunião de comitê foi registrada com os projetos avaliados.';
    case 'COMMITTEE_MEETING_REVISED': return 'A reunião de comitê foi editada e uma nova versão da ata foi registrada.';
    case 'COMMITTEE_MEETING_DELETED': return 'A reunião de comitê foi removida, os projetos afetados foram restaurados e o cronograma foi recalculado.';
    case 'PROJECT_COMMITTEE_STATE_CHANGED': return event.description || 'Uma decisão do comitê foi aplicada ao projeto.';
    case 'PROJECT_COMMITTEE_STATE_RESTORED': return event.description || 'A situação anterior do projeto foi restaurada após a exclusão de uma reunião.';
    case 'QUEUE_MANUAL_REORDER': return 'A ordem de execução dos projetos foi reorganizada manualmente.';
    case 'DELIVERY_CREATED': return event.description || 'Uma nova entrega foi registrada para o projeto.';
    case 'DELIVERY_FEEDBACK_CREATED': return event.description || 'A devolutiva de uma entrega foi registrada.';
    case 'DELIVERY_FEEDBACK_DELETED': return event.description || 'A devolutiva da entrega foi removida.';
    case 'PLANNED_DELIVERY_CREATED': return event.description || 'Uma entrega planejada foi criada para o projeto.';
    case 'PLANNED_DELIVERY_UPDATED': return event.description || 'Uma entrega planejada foi atualizada.';
    case 'PLANNED_DELIVERY_DELETED': return event.description || 'Uma entrega planejada foi removida.';
    case 'PROJECT_PERMANENTLY_DELETED': return event.description || 'O projeto foi excluído permanentemente.';
    case 'RESOURCE_STATUS_CHANGED': return 'A situação do recurso foi atualizada.';
    case 'UNAVAILABILITY_STATUS_CHANGED': return 'A situação da indisponibilidade foi atualizada.';
    case 'PROJECT_STATUS_CHANGED':
      return `O projeto saiu de ${statusLabel(metadata.before)} e foi para ${statusLabel(metadata.after)}${sourceSuffix}.`;
    case 'PROJECT_DEADLINE_CHANGED':
      return `O prazo solicitado foi alterado de ${displayValue(metadata.before?.requestedDeadline)} para ${displayValue(metadata.after?.requestedDeadline)}${sourceSuffix}.`;
    case 'PROJECT_PRIORITY_CHANGED':
      return `A prioridade foi alterada de ${displayValue(metadata.before?.businessPriorityName)} para ${displayValue(metadata.after?.businessPriorityName)}${sourceSuffix}.`;
    case 'PROJECT_FIELD_CHANGED':
      return `Houve alteração em ${(metadata.fieldLabel || 'informação do projeto').toLowerCase()}: de ${displayValue(metadata.before)} para ${displayValue(metadata.after)}${sourceSuffix}.`;
    case 'PROJECT_DEPARTMENTS_CHANGED':
      return `Os departamentos foram alterados de ${displayValue(metadata.before)} para ${displayValue(metadata.after)}${sourceSuffix}.`;
    case 'PROJECT_SYSTEMS_CHANGED':
      return `Os sistemas foram alterados de ${displayValue(metadata.before)} para ${displayValue(metadata.after)}${sourceSuffix}.`;
    case 'PHASE_EXECUTION_MODE_CHANGED':
      return `O modo de execução da fase ${metadata.phaseName || ''} foi alterado de ${displayValue(metadata.before)} para ${displayValue(metadata.after)}${sourceSuffix}.`.replace(/\s+/g, ' ');
    case 'PHASE_RESOURCES_CHANGED':
      return `Os recursos da fase ${metadata.phaseName || ''} foram alterados de ${displayValue(metadata.before)} para ${displayValue(metadata.after)}${sourceSuffix}.`.replace(/\s+/g, ' ');
    case 'PROJECT_IMPORTED': return event.description || 'Projeto criado por importação.';
    case 'MASS_IMPORT_COMPLETED': return event.description || 'Importação concluída com sucesso.';
    default: return sanitizeNaturalLanguage(event.description || 'Alteração registrada no sistema.');
  }
}

@Injectable()
export class BusinessEventsService {
  async record(client: any, data: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    description: string;
    userId: string;
    actorName?: string;
    metadata?: any;
  }) {
    const description = humanizeBusinessEventDescription(data);
    return client.businessEvent.create({
      data: {
        ...data,
        description,
        actorName: data.actorName || null,
        metadata: data.metadata || undefined,
      },
    });
  }

  label(eventType: string) {
    return humanizeBusinessEventLabel(eventType);
  }
}
