'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { formatDateOnlyPtBr, todayDateOnly } from '@/lib/date-only';
import {
  Sliders, HelpCircle, Eye, AlertTriangle, Loader2, CheckCircle2, ShieldAlert, FileText, Settings, ShieldCheck, BellRing, Cpu
} from 'lucide-react';
import { ImpactSimulationModal } from '@/components/ImpactSimulationModal';

interface GlobalParameter {
  key: string; value: string; description: string | null;
  category: 'ELIGIBILITY' | 'QUEUE' | 'ENGINE' | 'ALERTS';
}

interface PreviewResult {
  key: string; proposedValue: string; currentValue: string; impactDetected: boolean;
  affectedProjectsCount: number;
  details: { projectName: string; daysShifted: number; direction: 'POSTPONED' | 'ANTICIPATED' }[];
  message: string;
  stateHash: string;
}

const READABLE_KEY_NAMES: Record<string, string> = {
  eligibility_mode: 'Modo de Elegibilidade para Entrada em Fila',
  queue_mode: 'Modo de Ordenação da Fila',
  queue_rules_order: 'Critérios Sequenciais de Priorização',
  engine_start_date_mode: 'Marco Inicial para Cálculo de Capacidade',
  engine_calc_unit: 'Unidade Base para Estimativa de Esforço',
  engine_working_days: 'Dias Úteis Produtivos por Semana',
  engine_summary_impact_limit: 'Limite Visual para Exibição de Impactos',
  engine_wip_limit: 'Limite Padrão de Projetos Simultâneos por Recurso (WIP)',
  engine_wip_mode: 'Comportamento do Limite de Trabalho Simultâneo',
  engine_max_schedule_days: 'Horizonte Máximo de Simulação em Dias',
  engine_delay_risk_tolerance_days: 'Margem para Alerta de Atraso em Dias',
  engine_delay_risk_tolerance: 'Tolerância de Margem para Riscos de Atraso (Dias)',
  engine_holiday_behavior: 'Consideração de Feriados Nacionais',
  alerts_overload_limit: 'Gatilho de Alerta para Sobrecarga da Equipe (%)',
  alerts_pending_devolutiva_days: 'Prazo Máximo de Tolerância para Devolutiva (Dias)',
};

const READABLE_DESCRIPTIONS: Record<string, string> = {
  eligibility_mode: 'Define quais projetos em estágio inicial são qualificados para simulação de capacidade.',
  queue_mode: 'Exibe o modo vigente. A alteração é feita na tela Fila de Prioridades para passar pela prévia e confirmação seguras.',
  queue_rules_order: 'Ordem efetivamente aplicada pelo motor no modo automático. Esta regra é informativa e versionada no código.',
  engine_start_date_mode: 'Define a partir de qual data o motor realiza as simulações e projeções de datas finais.',
  engine_calc_unit: 'Formato padrão para mensurar esforço de desenvolvimento (horas orçadas).',
  engine_working_days: 'Quantidade de dias por semana contabilizados para a jornada produtiva da equipe.',
  engine_summary_impact_limit: 'Número máximo de alterações exibidas no resumo executivo de simulação.',
  engine_wip_limit: 'Quantidade máxima recomendada de projetos simultâneos em paralelo por recurso técnico.',
  engine_wip_mode: 'No modo orientativo o sistema alerta; no modo rígido ele só inicia um novo projeto quando houver espaço.',
  engine_max_schedule_days: 'Proteção para impedir simulações sem fim quando um projeto não encontra capacidade disponível.',
  engine_delay_risk_tolerance_days: 'Quantidade de dias de margem antes de considerar que a previsão está em risco em relação ao prazo solicitado.',
  engine_delay_risk_tolerance: 'Dias de margem de segurança antes de disparar alerta de risco no cronograma.',
  engine_holiday_behavior: 'Indica se feriados devem pausar a contagem de prazo dos projetos.',
  alerts_overload_limit: 'Percentual de alocação que ativa a notificação visual de sobrecarga na equipe.',
  alerts_pending_devolutiva_days: 'Prazo em dias corridos para cobrança de parecer nas devoluções enviadas aos solicitantes.',
};

const READABLE_VALUES: Record<string, string> = {
  only_prioritized: 'Somente projetos priorizados',
  prioritized_and_second_phase: 'Priorizados e projetos em segunda fase',
  all_eligible: 'Todos os projetos elegíveis',
  automatic: 'Ordenação automática',
  manual: 'Ordenação manual',
  soft: 'Orientativo — alerta sem bloquear',
  hard: 'Rígido — respeita o limite',
  true: 'Ativado',
  false: 'Desativado',
  minutes: 'Horas de esforço (com precisão de minutos)',
  skip: 'Feriados reduzem a capacidade disponível',
  include: 'Feriados são considerados dias produtivos',
  current_date: 'Data atual — recalculada automaticamente',
};

const WEEKDAY_LABELS: Record<string, string> = {
  mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta', fri: 'Sexta', sat: 'Sábado', sun: 'Domingo',
};
const QUEUE_RULE_LABELS: Record<string, string> = {
  legal_requirement: 'Requisito Legal',
  decisions: 'Decisão mais recente do Comitê',
  status: 'Etapa atual do projeto',
  committee_score: 'Nota do Comitê',
  business_priority: 'Prioridade definida pelo negócio',
  opening_date: 'Data de abertura',
  sd: 'Número SD',
};
const EFFECTIVE_QUEUE_RULES = ['legal_requirement', 'decisions', 'status', 'committee_score', 'business_priority', 'opening_date', 'sd'];
const parseArrayValue = (value: string) => {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
};
const formatParameterValue = (key: string, value: string) => {
  if (key === 'engine_working_days') {
    const days = parseArrayValue(value);
    return days.length ? days.map(day => WEEKDAY_LABELS[day] || day).join(', ') : 'Nenhum dia selecionado';
  }
  if (key === 'queue_rules_order') {
    return EFFECTIVE_QUEUE_RULES.map((rule, index) => `${index + 1}. ${QUEUE_RULE_LABELS[rule]}`).join('  •  ');
  }
  if (key === 'engine_start_date_mode' && value !== 'current_date') {
    return `Data específica: ${formatDateOnlyPtBr(value)}`;
  }
  return READABLE_VALUES[value] || value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
};

export default function ParametersPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'ELIGIBILITY' | 'QUEUE' | 'ENGINE' | 'ALERTS'>('ELIGIBILITY');
  const [editingParam, setEditingParam] = useState<GlobalParameter | null>(null);
  const [editValue, setEditValue] = useState('');
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: parameters = [], isLoading } = useQuery<GlobalParameter[]>({
    queryKey: ['parameters'], queryFn: () => apiRequest('/parameters'),
  });

  const previewMutation = useMutation({
    mutationFn: (body: { key: string; value: string }) => apiRequest('/parameters/preview', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (data) => { setPreviewData(data); setShowPreviewModal(true); },
    onError: (err: any) => alert(err.message || 'Erro ao simular alteração de parâmetro.'),
  });

  const confirmMutation = useMutation({
    mutationFn: (body: { key: string; value: string; stateHash: string }) => apiRequest('/parameters/confirm', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parameters'] });
      setShowPreviewModal(false); setEditingParam(null); setPreviewData(null);
    },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const handlePreviewClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingParam) return;
    setErrorMsg(null);
    previewMutation.mutate({ key: editingParam.key, value: editValue });
  };

  const handleConfirmApply = () => {
    if (!editingParam || !previewData) return;
    confirmMutation.mutate({ key: editingParam.key, value: previewData.proposedValue, stateHash: previewData.stateHash });
  };

  const currentTabParams = parameters.filter(p => p.category === activeTab);

  const toggleWorkingDay = (day: string) => {
    const selected = parseArrayValue(editValue);
    const weekOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const next = selected.includes(day) ? selected.filter(item => item !== day) : [...selected, day];
    setEditValue(JSON.stringify(next.sort((a, b) => weekOrder.indexOf(a) - weekOrder.indexOf(b))));
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Parâmetros de Governança</h1>
          <p className="page-subtitle">Ajuste as regras de negócio, limites de capacidade e comportamento das simulações</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="tabs-container">
        <button className={`tab-button ${activeTab === 'ELIGIBILITY' ? 'active' : ''}`} onClick={() => setActiveTab('ELIGIBILITY')}>
          <ShieldCheck size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Elegibilidade de Projetos
        </button>
        <button className={`tab-button ${activeTab === 'QUEUE' ? 'active' : ''}`} onClick={() => setActiveTab('QUEUE')}>
          <Sliders size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Regras de Fila e Prioridade
        </button>
        <button className={`tab-button ${activeTab === 'ENGINE' ? 'active' : ''}`} onClick={() => setActiveTab('ENGINE')}>
          <Cpu size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Capacidade e Calendário
        </button>
        <button className={`tab-button ${activeTab === 'ALERTS' ? 'active' : ''}`} onClick={() => setActiveTab('ALERTS')}>
          <BellRing size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Alertas e Limiares
        </button>
      </div>

      {/* Main Parameters Content */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings size={16} />
            Configurações — {
              activeTab === 'ELIGIBILITY' ? 'Elegibilidade' :
              activeTab === 'QUEUE' ? 'Fila e Priorização' :
              activeTab === 'ENGINE' ? 'Capacidade e Calendário' : 'Alertas e Limiares'
            }
          </h3>
        </div>

        {isLoading ? (
          <div className="loading-center" style={{ padding: '2rem' }}>
            <Loader2 className="spinner" size={20} />
            <span>Carregando parâmetros...</span>
          </div>
        ) : currentTabParams.length === 0 ? (
          <p className="text-muted text-xs text-center" style={{ padding: '2rem' }}>Nenhum parâmetro nesta categoria.</p>
        ) : (
          <div className="parameter-list">
            {currentTabParams.map((param) => {
              const isEditing = editingParam?.key === param.key;
              const displayName = READABLE_KEY_NAMES[param.key] || param.key;
              const displayDesc = READABLE_DESCRIPTIONS[param.key] || param.description;

              return (
                <div key={param.key} className={`parameter-card ${isEditing ? 'editing' : ''}`}>
                  <div className="parameter-card-heading">
                    <div>
                      <span className="font-semibold" style={{ fontSize: '0.875rem', color: 'var(--foreground)' }}>
                        {displayName}
                      </span>
                      <p className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.125rem' }}>
                        <HelpCircle size={12} />
                        <span>{displayDesc}</span>
                      </p>
                    </div>
                    {!isEditing && !['queue_mode', 'queue_rules_order'].includes(param.key) && (
                      <button className="btn btn-secondary btn-xs" onClick={() => { setEditingParam(param); setEditValue(param.value); }}>
                        Alterar
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <form onSubmit={handlePreviewClick} className="parameter-edit-form">
                      <div className="parameter-editor">
                        {param.key === 'eligibility_mode' ? (
                          <select className="input" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ maxWidth: '320px' }}>
                            <option value="only_prioritized">Somente projetos priorizados</option>
                            <option value="prioritized_and_second_phase">Priorizados e 2ª fase</option>
                            <option value="all_eligible">Todos os projetos elegíveis</option>
                          </select>
                        ) : param.key === 'queue_mode' ? (
                          <select className="input" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ maxWidth: '320px' }}>
                            <option value="automatic">Ordenação Automática por Score</option>
                            <option value="manual">Ordenação Manual da Diretoria</option>
                          </select>
                        ) : param.key === 'engine_wip_mode' ? (
                          <select className="input" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ maxWidth: '320px' }}>
                            <option value="soft">Orientativo — alerta sem bloquear</option>
                            <option value="hard">Rígido — respeita o limite</option>
                          </select>
                        ) : param.key === 'queue_rules_order' ? (
                          <div className="parameter-order-editor">
                            <p className="text-xs text-muted">Critérios fixos aplicados pelo motor automático.</p>
                            {EFFECTIVE_QUEUE_RULES.map((rule, index) => (
                              <div className="parameter-order-item" key={rule}>
                                <span className="parameter-order-number">{index + 1}</span>
                                <strong>{QUEUE_RULE_LABELS[rule] || 'Critério de priorização'}</strong>
                              </div>
                            ))}
                          </div>
                        ) : param.key === 'engine_working_days' ? (
                          <div className="weekday-editor">
                            <p className="text-xs text-muted">Marque os dias em que o motor pode consumir a capacidade dos recursos.</p>
                            <div className="weekday-options">
                              {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => (
                                <label className={`weekday-option ${parseArrayValue(editValue).includes(day) ? 'selected' : ''}`} key={day}>
                                  <input type="checkbox" checked={parseArrayValue(editValue).includes(day)} onChange={() => toggleWorkingDay(day)} />
                                  <span>{WEEKDAY_LABELS[day]}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : param.key === 'engine_calc_unit' ? (
                          <select className="input" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ maxWidth: '420px' }}>
                            <option value="minutes">Horas de esforço — cálculo preciso por minutos</option>
                          </select>
                        ) : param.key === 'engine_holiday_behavior' ? (
                          <select className="input" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ maxWidth: '420px' }}>
                            <option value="skip">Feriados reduzem a capacidade disponível</option>
                            <option value="include">Feriados são considerados dias produtivos</option>
                          </select>
                        ) : param.key === 'engine_start_date_mode' ? (
                          <div className="start-date-editor">
                          <select className="input" value={editValue === 'current_date' ? 'current_date' : 'specific_date'} onChange={e => setEditValue(e.target.value === 'current_date' ? 'current_date' : todayDateOnly())}>
                              <option value="current_date">Começar sempre na data atual</option>
                              <option value="specific_date">Começar em uma data específica</option>
                            </select>
                            {editValue !== 'current_date' && <input type="date" className="input" required value={editValue} onChange={e => setEditValue(e.target.value)} />}
                          </div>
                        ) : (
                          <input className="input" required value={editValue} onChange={e => setEditValue(e.target.value)} style={{ maxWidth: '320px' }} />
                        )}
                      </div>
                      <div className="parameter-edit-actions">
                        <button type="submit" className="btn btn-primary btn-sm" disabled={previewMutation.isPending}>
                          <Eye size={14} /> Simular Impacto
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingParam(null)}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="parameter-current-value">
                      <CheckCircle2 size={14} />
                      {formatParameterValue(param.key, param.value)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ImpactSimulationModal
        open={showPreviewModal}
        data={previewData}
        onClose={() => setShowPreviewModal(false)}
        onConfirm={handleConfirmApply}
        confirmLabel="Confirmar e Salvar"
        context={`Alteração do parâmetro ${previewData?.key || 'de governança'}`}
        isConfirming={confirmMutation.isPending}
      />
    </div>
  );
}
