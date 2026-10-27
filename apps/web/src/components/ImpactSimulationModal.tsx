'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarRange, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { apiRequest } from '@/lib/api';

type Props = {
  open: boolean;
  data: any;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  title?: string;
  context?: string;
  isConfirming?: boolean;
};

const formatDate = (value: unknown) => {
  if (!value || value === 'Sem data') return 'Sem previsão';
  const dateOnly = String(value).split('T')[0];
  const [year, month, day] = dateOnly.split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
};

const sanitizeAnalysis = (value: unknown) => String(value || '')
  .replace(/\bREMOVED_FROM_SCHEDULE\b/gi, 'saiu da simulação')
  .replace(/\bNEW_FORECAST\b/gi, 'passou a ter previsão')
  .replace(/\bAT_RISK\b/gi, 'próximo do prazo solicitado')
  .replace(/\bON[_ ]?TIME\b/gi, 'dentro do prazo solicitado')
  .replace(/\bDELAYED\b/gi, 'após o prazo solicitado');

const localAnalysis = (data: any) => {
  const difference = Number(data?.portfolioDifferenceDays || 0);
  const movement = data?.portfolioDirection === 'NEW_FORECAST'
    ? `A alteração cria uma nova previsão final para o portfólio em ${formatDate(data?.portfolioEndDateAfter)}.`
    : data?.portfolioDirection === 'NO_FORECAST'
      ? 'Depois da alteração, o cenário não terá uma data final calculada.'
      : difference > 0
        ? `A previsão final do portfólio será postergada em ${difference} dia${difference === 1 ? '' : 's'}.`
        : difference < 0
          ? `A previsão final do portfólio será antecipada em ${Math.abs(difference)} dia${Math.abs(difference) === 1 ? '' : 's'}.`
        : data?.portfolioEndUnchangedReason || 'A data final prevista do portfólio permanecerá inalterada.';
  const affected = Number(data?.affectedProjectsCount || 0);
  const newDelays = Number(data?.novosAtrasos || 0);
  const risk = newDelays > 0
    ? `Atenção para ${newDelays} novo${newDelays === 1 ? '' : 's'} atraso${newDelays === 1 ? '' : 's'} no cenário.`
    : 'A alteração não cria novos atrasos na simulação.';
  return `${movement} ${affected} projeto${affected === 1 ? '' : 's'} serão afetados. ${risk}`;
};

export function ImpactSimulationModal({
  open,
  data,
  onClose,
  onConfirm,
  confirmLabel = 'Confirmar Alteração',
  title = 'Simulação de Impacto',
  context = 'Alteração no cenário de alocação e capacidade',
  isConfirming = false,
}: Props) {
  const fallbackAnalysis = useMemo(() => localAnalysis(data), [data]);
  const [analysis, setAnalysis] = useState(fallbackAnalysis);
  const [aiStatus, setAiStatus] = useState<'LOADING' | 'AI_GENERATED' | 'LOCAL' | 'RATE_LIMITED'>('LOCAL');
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [detailPage, setDetailPage] = useState(1);

  useEffect(() => {
    if (!open || !data) return;
    let active = true;
    setAnalysis(fallbackAnalysis);
    setAiStatus('LOADING');
    setRetryAfterSeconds(null);
    setDetailPage(1);
    apiRequest('/ai/impact-analysis', {
      method: 'POST',
      body: JSON.stringify({
        portfolioEndDateBefore: data.portfolioEndDateBefore,
        portfolioEndDateAfter: data.portfolioEndDateAfter,
        portfolioDifferenceDays: data.portfolioDifferenceDays,
        affectedProjectsCount: data.affectedProjectsCount,
        antecipadosCount: data.antecipadosCount,
        postergadosCount: data.postergadosCount,
        novosAtrasos: data.novosAtrasos,
        atrasosResolvidos: data.atrasosResolvidos,
        portfolioEndUnchangedReason: data.portfolioEndUnchangedReason,
        criticalPathBefore: data.criticalPathBefore,
        criticalPathAfter: data.criticalPathAfter,
        topAffectedResources: data.topAffectedResources,
        context,
        projects: (data.fullDetails || data.details || []).slice(0, 8),
      }),
    }).then(result => {
      if (!active) return;
      setAnalysis(sanitizeAnalysis(result?.analysis || fallbackAnalysis));
      setAiStatus(result?.status === 'AI_GENERATED' ? 'AI_GENERATED' : 'LOCAL');
    }).catch(error => {
      if (!active) return;
      setAnalysis(fallbackAnalysis);
      if (error?.code === 'AI_RATE_LIMITED') {
        setAiStatus('RATE_LIMITED');
        setRetryAfterSeconds(Number(error?.details?.retryAfterSeconds || 0) || null);
      } else {
        setAiStatus('LOCAL');
      }
    });
    return () => { active = false; };
  }, [open, data, context, fallbackAnalysis]);

  if (!open || !data) return null;

  const difference = Number(data.portfolioDifferenceDays || 0);
  const allDetails = data.fullDetails || data.details || [];
  const sortedDetails = [...allDetails]
    .sort((a: any, b: any) => {
      const specialA = ['NEW_FORECAST', 'REMOVED_FROM_SCHEDULE'].includes(a.changeType) ? 10_000 : 0;
      const specialB = ['NEW_FORECAST', 'REMOVED_FROM_SCHEDULE'].includes(b.changeType) ? 10_000 : 0;
      return specialB + Math.abs(Number(b.diffDays ?? b.daysShifted ?? 0)) - specialA - Math.abs(Number(a.diffDays ?? a.daysShifted ?? 0));
    });
  const detailPageSize = 12;
  const detailPages = Math.max(1, Math.ceil(sortedDetails.length / detailPageSize));
  const details = sortedDetails.slice((detailPage - 1) * detailPageSize, detailPage * detailPageSize);
  const directionLabel = data.portfolioDirection === 'NEW_FORECAST'
    ? 'Nova previsão calculada'
    : data.portfolioDirection === 'NO_FORECAST'
      ? 'Cenário sem data final'
      : difference > 0
        ? `${difference} dia${difference === 1 ? '' : 's'} mais tarde`
        : difference < 0
          ? `${Math.abs(difference)} dia${Math.abs(difference) === 1 ? '' : 's'} mais cedo`
          : 'Data final da carteira mantida';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-xl impact-simulation-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3><AlertTriangle size={18} /> {title}</h3>
            <p>Compare o cenário oficial com o resultado previsto antes de confirmar.</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar simulação">✕</button>
        </div>

        <div className="modal-body">
          <div className="impact-date-comparison">
            <div className="impact-date-card">
              <span><CalendarRange size={15} /> Cenário atual</span>
              <strong>{formatDate(data.portfolioEndDateBefore)}</strong>
              <small>Data final antes da alteração</small>
            </div>
            <div className="impact-date-arrow"><ArrowRight size={22} /></div>
            <div className="impact-date-card proposed">
              <span><CalendarRange size={15} /> Nova simulação</span>
              <strong>{formatDate(data.portfolioEndDateAfter)}</strong>
              <small>Data final depois da alteração</small>
            </div>
            <div className={`impact-shift ${difference > 0 ? 'negative' : difference < 0 ? 'positive' : 'neutral'}`}>
              {directionLabel}
            </div>
          </div>

          {(data.criticalPathBefore || data.criticalPathAfter || data.portfolioEndUnchangedReason) && (
            <div className="impact-critical-path">
              <div>
                <span>Projeto determinante atual</span>
                <strong>{data.criticalPathBefore ? `${data.criticalPathBefore.sdNumber} — ${data.criticalPathBefore.title}` : 'Sem projeto determinante'}</strong>
                {data.criticalPathBefore?.phaseName && <small>{data.criticalPathBefore.phaseName}{data.criticalPathBefore.resources?.length ? ` · ${data.criticalPathBefore.resources.map((item: any) => item.name).join(', ')}` : ''}</small>}
              </div>
              <ArrowRight size={18} />
              <div>
                <span>Projeto determinante proposto</span>
                <strong>{data.criticalPathAfter ? `${data.criticalPathAfter.sdNumber} — ${data.criticalPathAfter.title}` : 'Sem projeto determinante'}</strong>
                {data.criticalPathAfter?.phaseName && <small>{data.criticalPathAfter.phaseName}{data.criticalPathAfter.resources?.length ? ` · ${data.criticalPathAfter.resources.map((item: any) => item.name).join(', ')}` : ''}</small>}
              </div>
              {data.portfolioEndUnchangedReason && <p>{data.portfolioEndUnchangedReason}</p>}
            </div>
          )}

          <div className="impact-summary-grid">
            <div><strong>{data.affectedProjectsCount || 0}</strong><span>Projetos afetados</span></div>
            <div><strong>{data.postergadosCount || 0}</strong><span>Postergados</span></div>
            <div><strong>{data.antecipadosCount || 0}</strong><span>Antecipados</span></div>
            <div><strong>{data.novosAtrasos || 0}</strong><span>Novos atrasos</span></div>
            <div><strong>{data.atrasosResolvidos || 0}</strong><span>Atrasos resolvidos</span></div>
          </div>

          {data.topAffectedResources?.length > 0 && (
            <div className="impact-resource-summary">
              <strong>Recursos mais envolvidos nas mudanças</strong>
              <div>{data.topAffectedResources.slice(0, 5).map((resource: any) => (
                <span key={resource.resourceId}>{resource.name}<small>{resource.affectedProjects} projeto{resource.affectedProjects === 1 ? '' : 's'}</small></span>
              ))}</div>
            </div>
          )}

          <div className="impact-ai-analysis">
            <div className="impact-ai-heading">
              <span><Sparkles size={16} /> Análise executiva</span>
              <small className={`impact-ai-status status-${aiStatus.toLowerCase()}`}>
                {aiStatus === 'LOADING' && <><Loader2 size={12} className="spin" /> Consultando IA</>}
                {aiStatus === 'AI_GENERATED' && <><CheckCircle2 size={12} /> Gerada pela IA</>}
                {aiStatus === 'LOCAL' && 'Análise local segura'}
                {aiStatus === 'RATE_LIMITED' && `Limite da IA atingido${retryAfterSeconds ? ` • tente em ${retryAfterSeconds}s` : ''}`}
              </small>
            </div>
            <p>{analysis}</p>
            {aiStatus !== 'AI_GENERATED' && (
              <small>A análise local mantém a simulação disponível mesmo sem chave, em falhas externas ou no erro 429.</small>
            )}
          </div>

          {details.length > 0 && (
            <div className="impact-projects">
              <div className="impact-projects-heading">
                <strong>Principais mudanças por projeto</strong>
                <span>Exibindo {sortedDetails.length ? (detailPage - 1) * detailPageSize + 1 : 0}–{Math.min(detailPage * detailPageSize, sortedDetails.length)} de {sortedDetails.length}</span>
              </div>
              <div className="table-container impact-projects-table-wrap">
                <table className="impact-projects-table">
                  <colgroup><col className="impact-project-col" /><col className="impact-date-col" /><col className="impact-date-col" /><col className="impact-variation-col" /></colgroup>
                  <thead><tr><th>Projeto</th><th>Cenário atual</th><th>Nova simulação</th><th>Impacto</th></tr></thead>
                  <tbody>
                    {details.map((detail: any, index: number) => {
                      const hasComparableDates = detail.oldDate && detail.oldDate !== 'Sem data' && detail.newDate && detail.newDate !== 'Sem data';
                      const diff = hasComparableDates ? Number(detail.diffDays ?? detail.daysShifted ?? 0) : null;
                      const impactLabel = detail.changeType === 'NEW_FORECAST'
                        ? 'Nova previsão'
                        : detail.changeType === 'REMOVED_FROM_SCHEDULE'
                          ? 'Sai do cronograma'
                          : diff !== null && diff !== 0
                            ? `${diff > 0 ? '+' : ''}${diff} dia${Math.abs(diff) === 1 ? '' : 's'}`
                            : detail.positionChanged
                              ? `Posição ${detail.oldPosition ?? '—'} → ${detail.newPosition ?? '—'}`
                              : detail.startDateChanged
                                ? 'Início alterado'
                                : 'Situação alterada';
                      const impactTone = detail.changeType === 'NEW_FORECAST'
                        ? 'neutral'
                        : detail.changeType === 'REMOVED_FROM_SCHEDULE'
                          ? 'positive'
                          : diff !== null && diff > 0 ? 'negative' : diff !== null && diff < 0 ? 'positive' : 'neutral';
                      return (
                        <tr key={detail.projectId || index}>
                          <td className="impact-project-identity"><span>{detail.sdNumber || 'Projeto'}</span><strong>{detail.title || detail.projectName || 'Projeto sem título'}</strong></td>
                          <td><span className="impact-project-date old">{formatDate(detail.oldDate)}</span></td>
                          <td><span className="impact-project-date new">{formatDate(detail.newDate)}</span></td>
                          <td><span className={`impact-diff ${impactTone}`}>{impactLabel}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {detailPages > 1 && (
                <div className="pagination-controls" style={{ justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                  <button className="pagination-btn" disabled={detailPage === 1} onClick={() => setDetailPage(page => page - 1)}>Anterior</button>
                  <span className="text-xs text-muted">Página {detailPage} de {detailPages}</span>
                  <button className="pagination-btn" disabled={detailPage === detailPages} onClick={() => setDetailPage(page => page + 1)}>Próxima</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Voltar sem Alterar</button>
          <button className="btn btn-accent btn-sm" onClick={onConfirm} disabled={isConfirming}>
            {isConfirming && <Loader2 size={14} className="spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
