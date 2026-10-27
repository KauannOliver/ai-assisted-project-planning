'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, authenticatedFetch } from '@/lib/api';
import { formatHistoryDescription } from '@/lib/history';
import { formatDateOnlyPtBr, todayDateOnly } from '@/lib/date-only';
import {
  Briefcase,
  TrendingUp,
  Clock,
  Users,
  Upload,
  Download,
  Activity,
  AlertTriangle,
  CheckCircle,
  Loader2,
  BarChart3,
  ArrowRight,
  Calendar,
  Target,
  Zap,
  FileText,
  Filter,
  Gauge
} from 'lucide-react';
import Link from 'next/link';
import { ImportDataModal } from '@/components/ImportDataModal';
import { PROJECT_STATUS_LABELS as STATUS_LABELS, PROJECT_STATUS_COLORS as STATUS_COLORS } from '@/lib/project-status';

// Friendly event type titles for history timeline
const EVENT_LABELS: Record<string, { label: string; badgeClass: string }> = {
  DELIVERY_FEEDBACK_CREATED: { label: 'Devolutiva de Entrega Registrada', badgeClass: 'badge-info' },
  DELIVERY_FEEDBACK_UPDATED: { label: 'Devolutiva Atualizada', badgeClass: 'badge-info' },
  PROJECT_CREATED: { label: 'Novo Projeto Registrado', badgeClass: 'badge-active' },
  PROJECT_STATUS_CHANGED: { label: 'Alteração de Status do Projeto', badgeClass: 'badge-navy' },
  PRIORITY_CHANGED: { label: 'Prioridade Alterada pela Diretoria', badgeClass: 'badge-accent' },
  PROJECT_DELETED: { label: 'Projeto Excluído', badgeClass: 'badge-inactive' },
  COMMITTEE_MEETING_CREATED: { label: 'Nova Reunião de Comitê Agendada', badgeClass: 'badge-navy' },
  COMMITTEE_MEETING_REVISED: { label: 'Ata do Comitê Atualizada', badgeClass: 'badge-info' },
  COMMITTEE_MEETING_DELETED: { label: 'Reunião de Comitê Removida', badgeClass: 'badge-inactive' },
  PARAMETER_CHANGED: { label: 'Parâmetro do Sistema Ajustado', badgeClass: 'badge-warning' },
  DELIVERY_CREATED: { label: 'Entrega Criada', badgeClass: 'badge-active' },
  DELIVERY_UPDATED: { label: 'Entrega Atualizada', badgeClass: 'badge-info' },
  DELIVERY_DELETED: { label: 'Entrega Removida', badgeClass: 'badge-inactive' },
  QUEUE_MANUAL_REORDER: { label: 'Fila de Prioridades Reorganizada', badgeClass: 'badge-accent' },
  UNAVAILABILITY_CREATED: { label: 'Indisponibilidade Registrada', badgeClass: 'badge-warning' },
  UNAVAILABILITY_UPDATED: { label: 'Indisponibilidade Atualizada', badgeClass: 'badge-info' },
  RESOURCE_CREATED: { label: 'Novo Recurso Cadastrado', badgeClass: 'badge-active' },
  RESOURCE_UPDATED: { label: 'Cadastro de Recurso Atualizado', badgeClass: 'badge-info' },
  PROJECT_IMPORTED: { label: 'Projeto Criado por Importação', badgeClass: 'badge-active' },
  PROJECT_FIELD_CHANGED: { label: 'Informação do Projeto Alterada', badgeClass: 'badge-info' },
  PROJECT_DEPARTMENTS_CHANGED: { label: 'Departamentos do Projeto Alterados', badgeClass: 'badge-info' },
  PROJECT_SYSTEMS_CHANGED: { label: 'Sistemas do Projeto Alterados', badgeClass: 'badge-info' },
  PROJECT_PRIORITY_CHANGED: { label: 'Prioridade do Projeto Alterada', badgeClass: 'badge-accent' },
  PROJECT_DEADLINE_CHANGED: { label: 'Prazo Solicitado Alterado', badgeClass: 'badge-warning' },
  PHASE_RESOURCES_CHANGED: { label: 'Recursos da Fase Alterados', badgeClass: 'badge-info' },
  PHASE_EXECUTION_MODE_CHANGED: { label: 'Modo de Execução Alterado', badgeClass: 'badge-info' },
  MASS_IMPORT_COMPLETED: { label: 'Importação Concluída', badgeClass: 'badge-active' },
};

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const [user] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      return u ? JSON.parse(u) : null;
    }
    return null;
  });

  const isAdminOrPm = user?.role === 'ADMIN' || user?.role === 'PROJECT_MANAGER';
  const isDirector = user?.role === 'ADMIN' || user?.role === 'DIRECTOR';

  // Import Dialog State
  const [importOpen, setImportOpen] = useState(false);

  // Queries
  const { data: metrics, isLoading: loadingMetrics } = useQuery<any>({
    queryKey: ['dashboard-metrics'],
    queryFn: () => {
      const endpoint = user?.role === 'DIRECTOR'
        ? '/dashboards/director'
        : user?.role === 'MANAGER'
        ? '/dashboards/manager'
        : '/dashboards/overview';
      return apiRequest(endpoint);
    },
  });

  const { data: alerts = [] } = useQuery<any[]>({
    queryKey: ['dashboard-alerts'],
    queryFn: () => apiRequest('/alerts'),
  });

  const { data: recentHistory = [] } = useQuery<any[]>({
    queryKey: ['dashboard-history'],
    queryFn: () => apiRequest('/history/recent'),
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ['projects-all'],
    queryFn: () => apiRequest('/projects'),
  });

  const downloadXlsx = async (path: string, filename: string) => {
    const response = await authenticatedFetch(path);
    if (!response.ok) throw new Error('Não foi possível gerar a planilha.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportXLSX = async () => {
    try {
      await downloadXlsx('/exports/complete', `Relatorio_Completo_${todayDateOnly()}.xlsx`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loadingMetrics || !metrics) {
    return (
      <div className="loading-center" style={{ minHeight: '60vh' }}>
        <Loader2 className="spinner" size={24} />
        <span>Carregando painel executivo...</span>
      </div>
    );
  }

  const sc = metrics.statusCounts || {};
  const totalActive = (sc[0]||0) + (sc[1]||0) + (sc[2]||0) + (sc[4]||0) + (sc[5]||0) + (sc[6]||0);
  const totalCompleted = sc[7] || 0;
  const totalCancelled = (sc[8]||0) + (sc[9]||0);

  // Status distribution
  const statusEntries = [0,1,2,4,5,6,7,8,9]
    .filter(s => s === 0 || (sc[s] || 0) > 0)
    .map(s => ({ status: s, label: STATUS_LABELS[s], count: sc[s] || 0, color: STATUS_COLORS[s] }));

  const totalPortfolio = Math.max(1, statusEntries.reduce((sum, entry) => sum + entry.count, 0));
  let donutCursor = 0;
  const donutGradient = statusEntries.length > 0
    ? `conic-gradient(${statusEntries.map(entry => {
        const start = donutCursor;
        donutCursor += (entry.count / totalPortfolio) * 100;
        return `${entry.color} ${start}% ${donutCursor}%`;
      }).join(', ')})`
    : '#e8edf4';
  const deadlineAlerts = alerts.filter((alert: any) => String(alert.type).includes('DEADLINE'));
  const governanceAlerts = alerts.filter((alert: any) => alert.type === 'NO_COMMITTEE_APPROVAL');
  const capacityAlerts = alerts.filter((alert: any) => alert.type === 'RESOURCE_OVERLOAD');
  const criticalAlerts = alerts.filter((alert: any) => alert.severity === 'CRITICAL');

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard Executivo</h1>
          <p className="page-subtitle">Acompanhamento unificado do portfólio de TIC, governança e alocação de recursos</p>
        </div>
        <div className="page-actions">
          {isAdminOrPm && (
            <button onClick={() => setImportOpen(true)} className="btn btn-secondary btn-sm">
              <Upload size={14} />
              Importar Dados
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleExportXLSX}>
            <Download size={14} />
            Exportar Relatório (XLSX)
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-blue">
          <div className="kpi-icon"><Briefcase size={36} /></div>
          <div className="kpi-label">Total de Projetos</div>
          <div className="kpi-value">{totalActive + totalCompleted + totalCancelled}</div>
          <div className="kpi-sub">{totalActive} projetos ativos em andamento</div>
        </div>

        <div className="kpi-card kpi-orange">
          <div className="kpi-icon"><Zap size={36} /></div>
          <div className="kpi-label">Em Execução Ativa</div>
          <div className="kpi-value">{(sc[5]||0) + (sc[6]||0)}</div>
          <div className="kpi-sub">Processo de Software e Homologação</div>
        </div>

        <div className="kpi-card kpi-green">
          <div className="kpi-icon"><CheckCircle size={36} /></div>
          <div className="kpi-label">Concluídos com Sucesso</div>
          <div className="kpi-value">{totalCompleted}</div>
          <div className="kpi-sub">Entregas homologadas e em produção</div>
        </div>

        <div className="kpi-card kpi-navy">
          <div className="kpi-icon"><Calendar size={36} /></div>
          <div className="kpi-label">Previsão do Portfólio</div>
          <div className="kpi-value kpi-date-value">
            {metrics.portfolioEndDate
              ? formatDateOnlyPtBr(metrics.portfolioEndDate)
              : '—'}
          </div>
          <div className="kpi-sub">Data estimada de término geral</div>
        </div>

        {isDirector && metrics.financials && (
          <div className="kpi-card kpi-green">
            <div className="kpi-icon"><TrendingUp size={36} /></div>
            <div className="kpi-label">Retorno Financeiro Mensal</div>
            <div className="kpi-value" style={{ fontSize: '1.2rem' }}>
              R$ {(metrics.financials.roiMonthly || 0).toLocaleString('pt-BR')}
            </div>
            <div className="kpi-sub">
              Ganhos: R$ {(metrics.financials.estimatedMonthlyGain || 0).toLocaleString('pt-BR')}
            </div>
          </div>
        )}

        <div className="kpi-card kpi-warning">
          <div className="kpi-icon"><Target size={36} /></div>
          <div className="kpi-label">Comprometimento de Equipe</div>
          <div className="kpi-value">{metrics.capacityCommitmentPercentage || 0}%</div>
          <div className="kpi-sub">Capacidade produtiva alocada</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="dashboard-analysis-grid">

        {/* Status Distribution */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart3 size={16} />
              Distribuição por Estágio
            </h3>
            <Link href="/dashboard/projects" className="btn btn-ghost btn-xs">
              Ver Projetos <ArrowRight size={12} />
            </Link>
          </div>

          <div className="portfolio-health-body">
            <div className="status-donut" style={{ background: donutGradient }} aria-label={`${totalPortfolio} projetos distribuídos por estágio`}>
              <div className="status-donut-center"><strong>{totalPortfolio}</strong><span>projetos</span></div>
            </div>
            <div className="status-legend">
              {statusEntries.map(entry => (
                <div className="status-legend-item" key={entry.status}>
                  <span className="status-legend-dot" style={{ background: entry.color }} />
                  <span className="status-legend-label">{entry.label}</span>
                  <strong>{entry.count}</strong>
                  <small>{Math.round((entry.count / totalPortfolio) * 100)}%</small>
                </div>
              ))}
            </div>
          </div>
          <div className="portfolio-insight">
            <TrendingUp size={15} />
            <span><strong>{Math.round((((sc[5] || 0) + (sc[6] || 0)) / totalPortfolio) * 100)}%</strong> do portfólio está em execução ou homologação.</span>
          </div>
        </div>

        {/* Alerts */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={16} style={{ color: alerts.length > 0 ? 'var(--accent)' : 'var(--success)' }} />
              Alertas e Riscos
            </h3>
            {alerts.length > 0 && (
              <span className="badge badge-accent">{alerts.length}</span>
            )}
          </div>

          <div className="risk-summary-grid">
            <div className="risk-summary risk-critical"><AlertTriangle size={17} /><span><strong>{criticalAlerts.length}</strong><small>Críticos</small></span></div>
            <div className="risk-summary risk-deadline"><Clock size={17} /><span><strong>{deadlineAlerts.length}</strong><small>Prazo</small></span></div>
            <div className="risk-summary risk-governance"><FileText size={17} /><span><strong>{governanceAlerts.length}</strong><small>Governança</small></span></div>
            <div className="risk-summary risk-capacity"><Users size={17} /><span><strong>{capacityAlerts.length}</strong><small>Capacidade</small></span></div>
          </div>

          {alerts.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <div className="empty-state-icon">
                <CheckCircle size={20} />
              </div>
              <div className="empty-state-title">Tudo em conformidade!</div>
              <p className="text-xs text-muted">Nenhum risco de prazo ou sobrecarga pendente.</p>
            </div>
          ) : (
            <div className="risk-feed">
              {alerts.slice(0, 8).map((a: any, idx: number) => (
                <div key={idx} className={`risk-feed-item ${a.severity === 'CRITICAL' ? 'critical' : 'warning'}`}>
                  <span className="risk-feed-icon"><AlertTriangle size={14} /></span>
                  <div className="risk-feed-copy">
                    <span className="risk-feed-title">
                      {a.type === 'NO_COMMITTEE_APPROVAL' ? 'Sem Avaliação do Comitê' :
                       a.type === 'DEADLINE_DELAYED' ? 'Prazo Excedido' :
                       a.type === 'DEADLINE_AT_RISK' ? 'Alerta de Prazo' :
                       a.type === 'DELIVERY_PENDING_FEEDBACK' ? 'Devolutiva Pendente' :
                       a.type === 'RESOURCE_OVERLOAD' ? 'Sobrecarga de Recurso' : a.type}
                    </span>
                    <p>{a.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Resource Bottleneck Analysis */}
      <div className="card bottleneck-card">
        <div className="card-header">
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Gauge size={17} /> Recursos com maior pressão no portfólio
            </h3>
            <p className="text-xs text-muted">Ranking composto por projetos simultâneos, horas atribuídas e pico de utilização no cenário atual.</p>
          </div>
          <Link href="/dashboard/resources" className="btn btn-ghost btn-xs">
            Ver Recursos <ArrowRight size={12} />
          </Link>
        </div>

        {(metrics.resourceBottlenecks || []).length === 0 ? (
          <div className="empty-state" style={{ padding: '1.75rem 1rem' }}>
            <div className="empty-state-icon"><CheckCircle size={20} /></div>
            <div className="empty-state-title">Nenhum gargalo identificado</div>
            <p className="text-xs text-muted">Não há recursos com projetos ou horas ativas no cenário.</p>
          </div>
        ) : (
          <div className="bottleneck-ranking">
            {(metrics.resourceBottlenecks || []).slice(0, 8).map((resource: any, index: number) => {
              const factorLabel = resource.primaryFactor === 'PROJETOS' ? 'Projetos simultâneos' : resource.primaryFactor === 'HORAS' ? 'Volume de horas' : 'Pico de utilização';
              return (
                <div className="bottleneck-row" key={resource.id}>
                  <div className="bottleneck-rank">{index + 1}</div>
                  <div className="bottleneck-resource">
                    <strong>{resource.name}</strong>
                    <span>{resource.role}</span>
                  </div>
                  <div className="bottleneck-pressure">
                    <div className="bottleneck-pressure-heading">
                      <span>Pressão {resource.riskScore}/100</span>
                      <span className={`bottleneck-level level-${String(resource.riskLevel).toLowerCase()}`}>{resource.riskLevel === 'CRITICO' ? 'Crítico' : resource.riskLevel === 'ATENCAO' ? 'Atenção' : 'Controlado'}</span>
                    </div>
                    <div className="bottleneck-meter"><span style={{ width: `${Math.max(4, resource.riskScore)}%` }} /></div>
                    <small>Principal fator: {factorLabel}</small>
                  </div>
                  <div className="bottleneck-metrics">
                    <span><strong>{resource.activeProjectsCount}</strong> projetos <small>limite {resource.wipLimit}</small></span>
                    <span><strong>{resource.allocatedHours}h</strong> atribuídas <small>{resource.scheduledHours}h simuladas</small></span>
                    <span><strong>{resource.maxDailyUtilization}%</strong> pico diário <small>no cronograma atual</small></span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Activity Timeline (Humanized) */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={16} />
            Histórico de Atividades Recentes
          </h3>
        </div>

        {recentHistory.length === 0 ? (
          <p className="text-sm text-muted" style={{ padding: '1rem 0', textAlign: 'center' }}>
            Nenhuma atividade registrada recentemente no sistema.
          </p>
        ) : (
          <div className="timeline" style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {recentHistory.slice(0, 12).map((h: any) => {
              const eventInfo = EVENT_LABELS[h.eventType] || {
                label: h.displayLabel || h.eventType.replace(/_/g, ' '),
                badgeClass: 'badge-navy'
              };
              return (
                <div key={h.id} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-date">
                    {new Date(h.createdAt).toLocaleDateString('pt-BR', {
                      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </div>
                  <div className="timeline-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>{eventInfo.label}</span>
                    <span className={`badge ${eventInfo.badgeClass}`} style={{ fontSize: '0.625rem' }}>
                      {h.user?.name || 'Sistema'}
                    </span>
                  </div>
                  <div className="timeline-desc">{formatHistoryDescription(h)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ImportDataModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard-alerts'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard-history'] });
          queryClient.invalidateQueries({ queryKey: ['projects-all'] });
          queryClient.invalidateQueries({ queryKey: ['committee-meetings'] });
          queryClient.invalidateQueries({ queryKey: ['committee-eligible'] });
        }}
      />
    </div>
  );
}
