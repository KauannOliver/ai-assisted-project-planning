'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import {
  CalendarRange, BarChart3, AlertOctagon, ChevronLeft, ChevronRight, Loader2, User, Briefcase, Clock, Search
} from 'lucide-react';
import { PROJECT_STATUS_LABELS as STATUS_LABELS } from '@/lib/project-status';

interface ScheduleProject {
  id: string;
  sdNumber: string;
  title: string;
  departments: string[];
  status: number;
  openingDate: string;
  simulatedEndDate: string | null;
  realCompletionDate: string | null;
  inSchedule: boolean;
}

interface HeatmapResource {
  resourceId: string;
  resourceName: string;
  days: {
    date: string;
    percentage: number;
    busyMinutes: number;
    totalMinutes: number;
    managementMinutes: number;
    isWorkingDay: boolean;
    unavailabilities: {
      id: string;
      type: 'FERIADO' | 'FERIAS' | 'ATESTADO' | 'TREINAMENTO' | 'LICENCA' | 'OUTRO';
      notes: string | null;
      global: boolean;
      unavailableMinutesPerDay: number | null;
    }[];
    projects: { projectId: string; sdNumber: string; title: string; minutes: number; phaseId: string; phaseName: string }[];
  }[];
}

const formatUtcDate = (value: string | Date, options: Intl.DateTimeFormatOptions = {}) => {
  const date = value instanceof Date ? value : new Date(value.includes('T') ? value : `${value}T00:00:00Z`);
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC', ...options });
};

const UNAVAILABILITY_LABELS: Record<string, string> = {
  FERIADO: 'Feriado',
  FERIAS: 'Férias',
  ATESTADO: 'Atestado',
  TREINAMENTO: 'Treinamento',
  LICENCA: 'Licença',
  OUTRO: 'Indisponível',
};

export default function SchedulePage() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'heatmap'>('schedule');
  const [heatmapTimeframe, setHeatmapTimeframe] = useState<'7d' | '28d'>('28d');
  const [selectedWeekDetail, setSelectedWeekDetail] = useState<{ label: string; startDate: string; endDate: string; dates: string[] } | null>(null);
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [schedulePage, setSchedulePage] = useState(1);
  const schedulePageSize = 15;

  // Queries
  const { data: scheduleData = [], isLoading: loadingSchedule } = useQuery<ScheduleProject[]>({
    queryKey: ['schedule-official'],
    queryFn: () => apiRequest('/schedule/official'),
  });

  const { data: heatmapData = [], isLoading: loadingHeatmap } = useQuery<HeatmapResource[]>({
    queryKey: ['capacity-heatmap', heatmapTimeframe],
    queryFn: () => apiRequest(`/capacity/heatmap?days=${heatmapTimeframe === '7d' ? 7 : 28}`),
  });

  // Heatmap helper colors
  const getHeatmapColor = (pct: number) => {
    if (pct === 0) return '#f1f5f9';
    if (pct <= 50) return '#dcfce7';
    if (pct <= 80) return '#86efac';
    if (pct <= 100) return '#10b981';
    return '#ef4444';
  };

  // Distinct dates for Heatmap
  const heatmapDates = useMemo(() => {
    const datesSet = new Set<string>();
    heatmapData.forEach(r => r.days.forEach(d => datesSet.add(d.date)));
    return Array.from(datesSet).sort();
  }, [heatmapData]);

  // Group heatmap dates by week (7 days)
  const heatmapWeeks = useMemo(() => {
    const weeks: { label: string; startDate: string; endDate: string; dates: string[] }[] = [];
    for (let i = 0; i < heatmapDates.length; i += 7) {
      const chunk = heatmapDates.slice(i, i + 7);
      if (chunk.length > 0) {
        const start = chunk[0];
        const end = chunk[chunk.length - 1];
        weeks.push({
          label: `Semana ${weeks.length + 1} (${formatUtcDate(start, { day: '2-digit', month: '2-digit' })} a ${formatUtcDate(end, { day: '2-digit', month: '2-digit' })})`,
          startDate: start,
          endDate: end,
          dates: chunk,
        });
      }
    }
    return weeks;
  }, [heatmapDates]);

  const selectedWeekResources = useMemo(() => {
    if (!selectedWeekDetail) return [];
    return heatmapData.map(resource => {
      const days = resource.days.filter(day => selectedWeekDetail.dates.includes(day.date));
      const projectMap = new Map<string, { sdNumber: string; title: string; minutes: number }>();
      const unavailabilityMap = new Map<string, { label: string; notes: string | null; dates: string[]; global: boolean }>();
      days.flatMap(day => day.projects || []).forEach(project => {
        const current = projectMap.get(project.projectId) || { sdNumber: project.sdNumber, title: project.title, minutes: 0 };
        current.minutes += project.minutes;
        projectMap.set(project.projectId, current);
      });
      days.forEach(day => (day.unavailabilities || []).forEach(item => {
        const current = unavailabilityMap.get(item.id) || {
          label: UNAVAILABILITY_LABELS[item.type] || 'Indisponível',
          notes: item.notes,
          dates: [],
          global: item.global,
        };
        current.dates.push(day.date);
        unavailabilityMap.set(item.id, current);
      }));
      return {
        resourceId: resource.resourceId,
        resourceName: resource.resourceName,
        busyMinutes: days.reduce((sum, day) => sum + day.busyMinutes, 0),
        totalMinutes: days.reduce((sum, day) => sum + day.totalMinutes, 0),
        projects: Array.from(projectMap.values()),
        unavailabilities: Array.from(unavailabilityMap.values()),
      };
    }).filter(resource => resource.busyMinutes > 0 || resource.projects.length > 0 || resource.unavailabilities.length > 0);
  }, [heatmapData, selectedWeekDetail]);

  const filteredSchedule = useMemo(() => {
    const term = scheduleSearch.trim().toLocaleLowerCase('pt-BR');
    if (!term) return scheduleData;
    return scheduleData.filter(project =>
      project.sdNumber.toLocaleLowerCase('pt-BR').includes(term)
      || project.title.toLocaleLowerCase('pt-BR').includes(term)
      || project.departments.some(code => code.toLocaleLowerCase('pt-BR').includes(term))
      || (STATUS_LABELS[project.status] || '').toLocaleLowerCase('pt-BR').includes(term),
    );
  }, [scheduleData, scheduleSearch]);

  const scheduleTotalPages = Math.max(1, Math.ceil(filteredSchedule.length / schedulePageSize));
  const paginatedSchedule = filteredSchedule.slice((schedulePage - 1) * schedulePageSize, schedulePage * schedulePageSize);

  const scheduleMetrics = useMemo(() => {
    const simulatedDates = scheduleData
      .filter(project => project.inSchedule && project.simulatedEndDate)
      .map(project => project.simulatedEndDate as string)
      .sort();
    return {
      total: scheduleData.length,
      scheduled: scheduleData.filter(project => project.inSchedule).length,
      outsideSchedule: scheduleData.filter(project => !project.inSchedule).length,
      endDate: simulatedDates.at(-1) || null,
    };
  }, [scheduleData]);

  const heatmapMetrics = useMemo(() => {
    const visibleDates = selectedWeekDetail?.dates || heatmapDates.slice(0, 28);
    const visibleDays = heatmapData.flatMap(resource => resource.days.filter(day => visibleDates.includes(day.date)));
    const busyMinutes = visibleDays.reduce((sum, day) => sum + day.busyMinutes, 0);
    const totalMinutes = visibleDays.reduce((sum, day) => sum + day.totalMinutes, 0);
    return {
      resources: heatmapData.filter(resource => resource.days.some(day => visibleDates.includes(day.date) && day.busyMinutes > 0)).length,
      busyHours: busyMinutes / 60,
      utilization: totalMinutes > 0 ? Math.round((busyMinutes / totalMinutes) * 100) : 0,
      overloadedDays: visibleDays.filter(day => day.percentage > 100).length,
    };
  }, [heatmapData, heatmapDates, selectedWeekDetail]);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Cronograma Oficial e Capacidade</h1>
          <p className="page-subtitle">Previsões de entrega do portfólio e matriz de ocupação de recursos</p>
        </div>
        {activeTab === 'heatmap' && (
          <div className="page-actions">
            <button className={`btn btn-sm ${heatmapTimeframe === '7d' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setHeatmapTimeframe('7d')}>
              1 semana
            </button>
            <button className={`btn btn-sm ${heatmapTimeframe === '28d' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setHeatmapTimeframe('28d')}>
              4 semanas
            </button>
          </div>
        )}
      </div>

      {/* Explanation Banner */}
      <div className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <Clock size={18} style={{ flexShrink: 0 }} />
        <div>
          <strong>Como interpretar as datas:</strong>
          <p className="text-xs mt-1">
            A data prevista é calculada somente para projetos presentes no cronograma oficial. A conclusão real aparece apenas quando o projeto está concluído.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-container">
        <button className={`tab-button ${activeTab === 'schedule' ? 'active' : ''}`} onClick={() => setActiveTab('schedule')}>
          <CalendarRange size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Cronograma de Projetos
        </button>
        <button className={`tab-button ${activeTab === 'heatmap' ? 'active' : ''}`} onClick={() => setActiveTab('heatmap')}>
          <BarChart3 size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Matriz de Ocupação (Heatmap)
        </button>
      </div>

      <div className="schedule-summary-grid">
        {activeTab === 'schedule' ? (
          <>
            <div className="schedule-summary"><Briefcase size={17} /><span><strong>{scheduleMetrics.total}</strong><small>Projetos na carteira</small></span></div>
            <div className="schedule-summary"><CalendarRange size={17} /><span><strong>{scheduleMetrics.scheduled}</strong><small>Com previsão simulada</small></span></div>
            <div className={`schedule-summary ${scheduleMetrics.outsideSchedule > 0 ? 'danger' : ''}`}><AlertOctagon size={17} /><span><strong>{scheduleMetrics.outsideSchedule}</strong><small>Sem data simulada</small></span></div>
            <div className="schedule-summary"><Clock size={17} /><span><strong>{scheduleMetrics.endDate ? formatUtcDate(scheduleMetrics.endDate, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}</strong><small>Término do cenário</small></span></div>
          </>
        ) : (
          <>
            <div className="schedule-summary"><User size={17} /><span><strong>{heatmapMetrics.resources}</strong><small>Recursos no período</small></span></div>
            <div className="schedule-summary"><Clock size={17} /><span><strong>{heatmapMetrics.busyHours.toFixed(1)}h</strong><small>Horas alocadas</small></span></div>
            <div className="schedule-summary"><BarChart3 size={17} /><span><strong>{heatmapMetrics.utilization}%</strong><small>Ocupação média</small></span></div>
            <div className={`schedule-summary ${heatmapMetrics.overloadedDays > 0 ? 'danger' : ''}`}><AlertOctagon size={17} /><span><strong>{heatmapMetrics.overloadedDays}</strong><small>Células acima de 100%</small></span></div>
          </>
        )}
      </div>

      {/* TAB 1: OFFICIAL SCHEDULE TABLE */}
      {activeTab === 'schedule' && (
        <div className="card official-schedule-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="official-schedule-toolbar">
            <div>
              <h3 className="card-title">Previsão de Entrega dos Projetos</h3>
              <p className="text-xs text-muted">Datas produzidas pelo motor oficial de capacidade.</p>
            </div>
            <div className="input-group official-schedule-search">
              <span className="input-icon"><Search size={15} /></span>
              <input
                className="input"
                value={scheduleSearch}
                onChange={event => { setScheduleSearch(event.target.value); setSchedulePage(1); }}
                placeholder="Buscar solicitação, título, departamento ou status..."
                aria-label="Buscar no cronograma"
              />
            </div>
          </div>

          {loadingSchedule ? (
            <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando cronograma...</div>
          ) : filteredSchedule.length === 0 ? (
            <div className="empty-state"><div className="empty-state-title">Nenhum projeto encontrado</div></div>
          ) : (
            <>
              <div className="table-container official-schedule-table-container">
                <table className="table official-schedule-table">
                  <thead>
                    <tr>
                      <th>Nº Solicitação</th>
                      <th>Título</th>
                      <th>Departamento</th>
                      <th>Status</th>
                      <th>Data de Abertura</th>
                      <th>Data Prevista de Fim</th>
                      <th>Conclusão Real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSchedule.map(project => (
                      <tr key={project.id}>
                        <td><span className="official-sd-number">{project.sdNumber}</span></td>
                        <td className="official-project-title">{project.title}</td>
                        <td>{project.departments.length > 0 ? project.departments.join(', ') : '—'}</td>
                        <td><span className={`status-badge status-${project.status}`}>{project.status}. {STATUS_LABELS[project.status] || 'Desconhecido'}</span></td>
                        <td className="official-date-cell">{formatUtcDate(project.openingDate)}</td>
                        <td className="official-date-cell">
                          {project.inSchedule && project.simulatedEndDate ? formatUtcDate(project.simulatedEndDate) : '—'}
                        </td>
                        <td className="official-date-cell">
                          {project.status === 7 && project.realCompletionDate ? formatUtcDate(project.realCompletionDate) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination-wrapper">
                <div className="pagination-info">
                  Exibindo {(schedulePage - 1) * schedulePageSize + 1}–{Math.min(schedulePage * schedulePageSize, filteredSchedule.length)} de {filteredSchedule.length} projetos
                </div>
                <div className="pagination-controls">
                  <button className="pagination-btn" disabled={schedulePage <= 1} onClick={() => setSchedulePage(page => page - 1)} aria-label="Página anterior">
                    <ChevronLeft size={15} />
                  </button>
                  <span className="official-page-indicator">Página {schedulePage} de {scheduleTotalPages}</span>
                  <button className="pagination-btn" disabled={schedulePage >= scheduleTotalPages} onClick={() => setSchedulePage(page => page + 1)} aria-label="Próxima página">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: HEATMAP */}
      {activeTab === 'heatmap' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Week selector buttons */}
          <div className="card" style={{ padding: '0.875rem 1.25rem' }}>
            <span className="text-xs font-semibold text-muted" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Selecione uma semana para inspecionar alocações:
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {heatmapWeeks.map((wk, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedWeekDetail(wk)}
                  className={`btn btn-xs ${selectedWeekDetail?.startDate === wk.startDate ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {wk.label}
                </button>
              ))}
              {selectedWeekDetail && (
                <button className="btn btn-ghost btn-xs" onClick={() => setSelectedWeekDetail(null)}>Limpar Seleção</button>
              )}
            </div>
          </div>

          <div className="table-container heatmap-table-container">
            {loadingHeatmap ? (
              <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando matriz de capacidade...</div>
            ) : heatmapData.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">Nenhum dado de capacidade disponível</div>
              </div>
            ) : (
              <table className="table heatmap-table">
                <thead>
                  <tr>
                    <th>Recurso</th>
                    {(selectedWeekDetail ? selectedWeekDetail.dates : heatmapDates.slice(0, 28)).map(d => (
                      <th key={d} style={{ textAlign: 'center', fontSize: '0.625rem' }}>
                        <span className="heatmap-weekday">{formatUtcDate(d, { weekday: 'short' }).replace('.', '')}</span>
                        <span className="heatmap-date">{formatUtcDate(d, { day: '2-digit', month: '2-digit' })}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapData.map(r => (
                    <tr key={r.resourceId}>
                      <td style={{ fontWeight: '600' }}>{r.resourceName}</td>
                      {(selectedWeekDetail ? selectedWeekDetail.dates : heatmapDates.slice(0, 28)).map(d => {
                        const dayData = r.days.find(day => day.date === d);
                        const pct = dayData?.percentage || 0;
                        const unavailable = dayData?.unavailabilities || [];
                        const unavailableLabels = unavailable.map(item => `${UNAVAILABILITY_LABELS[item.type] || 'Indisponível'}${item.notes ? `: ${item.notes}` : ''}`);
                        const cellTitle = dayData
                          ? [
                              `${(dayData.busyMinutes / 60).toFixed(1)}h alocadas de ${(dayData.totalMinutes / 60).toFixed(1)}h disponíveis`,
                              dayData.managementMinutes > 0 ? `${(dayData.managementMinutes / 60).toFixed(1)}h em Gestão de Projetos` : '',
                              ...unavailableLabels,
                            ].filter(Boolean).join(' · ')
                          : '';
                        return (
                          <td
                            key={d}
                            className={`${!dayData?.isWorkingDay ? 'heatmap-non-working' : ''} ${unavailable.length > 0 ? 'heatmap-unavailable' : ''}`.trim()}
                            title={cellTitle}
                            style={{ textAlign: 'center', background: unavailable.length > 0 ? '#fff7ed' : !dayData?.isWorkingDay ? '#eef1f5' : getHeatmapColor(pct), color: pct > 80 && unavailable.length === 0 ? '#fff' : '#0f172a', fontWeight: '700', fontSize: '0.6875rem' }}
                          >
                            <span className="heatmap-cell-value">{pct > 0 ? `${pct}%` : !dayData?.isWorkingDay && unavailable.length === 0 ? 'Folga' : unavailable.length === 0 ? '—' : ''}</span>
                            {unavailable.length > 0 && (
                              <span className="heatmap-cell-reason">{UNAVAILABILITY_LABELS[unavailable[0].type] || 'Indisponível'}{unavailable.length > 1 ? ` +${unavailable.length - 1}` : ''}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selectedWeekDetail && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Detalhamento da {selectedWeekDetail.label}</h3>
                  <p className="text-xs text-muted">Horas líquidas disponíveis, consumo e projetos por recurso.</p>
                </div>
              </div>
              {selectedWeekResources.length === 0 ? (
                <div className="empty-state"><div className="empty-state-title">Nenhuma alocação nesta semana</div></div>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {selectedWeekResources.map(resource => (
                    <div key={resource.resourceId} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem', background: 'var(--primary-lighter)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem' }}>
                        <strong>{resource.resourceName}</strong>
                        <span className="badge badge-info">{(resource.busyMinutes / 60).toFixed(1)}h de {(resource.totalMinutes / 60).toFixed(1)}h</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {resource.projects.map(project => (
                          <span key={project.sdNumber} className="badge badge-navy" title={project.title}>{project.sdNumber} · {(project.minutes / 60).toFixed(1)}h</span>
                        ))}
                        {resource.unavailabilities.map((item, index) => (
                          <span key={`${item.label}-${index}`} className="badge heatmap-unavailability-badge" title={item.notes || item.label}>
                            {item.global ? 'Global: ' : ''}{item.label} · {formatUtcDate(item.dates[0], { day: '2-digit', month: '2-digit' })}{item.dates.length > 1 ? `–${formatUtcDate(item.dates[item.dates.length - 1], { day: '2-digit', month: '2-digit' })}` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
