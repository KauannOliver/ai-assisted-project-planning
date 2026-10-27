'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Filter, Trash2, AlertTriangle, Loader2, CheckCircle2, ShieldAlert, List, LayoutGrid, Search
} from 'lucide-react';
import { ImpactSimulationModal } from '@/components/ImpactSimulationModal';
import { dateOnlyKey, dateOnlyMonthDay, formatDateOnlyPtBr } from '@/lib/date-only';

interface Resource { id: string; name: string; }
interface Unavailability {
  id: string; type: 'FERIADO' | 'FERIAS' | 'ATESTADO' | 'TREINAMENTO' | 'LICENCA' | 'OUTRO';
  startDate: string; endDate: string; unavailableMinutesPerDay: number | null;
  resourceId: string | null; global: boolean; annualRecurrence: boolean; notes: string | null;
  resource: { id: string; name: string } | null;
}
interface PreviewResult {
  impactDetected: boolean; affectedProjectsCount: number;
  details: { projectName: string; daysShifted: number; direction: 'POSTPONED' | 'ANTICIPATED' }[];
  message: string;
}

const RESOURCE_CALENDAR_COLORS = [
  '#079ae1', '#f36229', '#7c3aed', '#059669', '#c026d3', '#ca8a04', '#2563eb', '#dc2626',
  '#0f766e', '#9333ea', '#ea580c', '#4f46e5', '#16a34a', '#be123c', '#0369a1', '#a16207',
  '#6d28d9', '#15803d', '#b91c1c', '#0e7490', '#9f1239', '#4338ca', '#047857', '#c2410c',
];

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'calendar' | 'table'>('table');
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewActionType, setPreviewActionType] = useState<'create' | 'delete'>('create');

  // Form states (partialHours in hours)
  const [type, setType] = useState<'FERIADO' | 'FERIAS' | 'ATESTADO' | 'TREINAMENTO' | 'LICENCA' | 'OUTRO'>('FERIAS');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [partialHours, setPartialHours] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [global, setGlobal] = useState(false);
  const [annualRecurrence, setAnnualRecurrence] = useState(false);
  const [notes, setNotes] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);

  // Filters
  const [filterResource, setFilterResource] = useState('');
  const [filterType, setFilterType] = useState('');
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Queries
  const { data: unavailabilities = [], isLoading: loadingUnavail } = useQuery<Unavailability[]>({
    queryKey: ['unavailabilities'], queryFn: () => apiRequest('/unavailabilities'),
  });
  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ['resources'], queryFn: () => apiRequest('/resources'),
  });

  // Mutations
  const previewMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/unavailabilities/preview', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (data) => { setPreviewResult(data); setPreviewActionType('create'); setShowPreviewModal(true); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const deletePreviewMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/unavailabilities/${id}/preview`, { method: 'DELETE' }),
    onSuccess: (data) => { setPreviewResult(data); setPreviewActionType('delete'); setShowPreviewModal(true); },
    onError: (err: any) => alert(err.message),
  });

  const confirmCreateMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/unavailabilities/confirm', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['unavailabilities'] }); setShowPreviewModal(false); setShowCreateModal(false); resetForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const confirmDeleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/unavailabilities/${id}/confirm`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['unavailabilities'] }); setShowPreviewModal(false); setTargetId(null); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const resetForm = () => {
    setType('FERIAS'); setStartDate(''); setEndDate(''); setPartialHours('');
    setResourceId(''); setGlobal(false); setAnnualRecurrence(false); setNotes('');
    setTargetId(null); setErrorMsg(null);
  };

  const handleCreatePreviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const minutes = partialHours ? Math.round(parseFloat(partialHours) * 60) : undefined;
    const body = {
      type, startDate, endDate,
      unavailableMinutesPerDay: minutes,
      resourceId: global ? undefined : (resourceId || undefined),
      global, annualRecurrence, notes,
    };

    if (type === 'FERIADO' && !global) { setErrorMsg('Feriados devem ser marcados como globais.'); return; }
    if (!global && !resourceId) { setErrorMsg('Selecione um recurso técnico.'); return; }

    previewMutation.mutate(body);
  };

  const handleConfirmAction = () => {
    const minutes = partialHours ? Math.round(parseFloat(partialHours) * 60) : undefined;
    if (previewActionType === 'create') {
      confirmCreateMutation.mutate({
        type, startDate, endDate, unavailableMinutesPerDay: minutes,
        resourceId: global ? undefined : (resourceId || undefined),
        global, annualRecurrence, notes,
      });
    } else if (previewActionType === 'delete' && targetId) {
      confirmDeleteMutation.mutate(targetId);
    }
  };

  const handleDeleteClick = (id: string) => {
    setTargetId(id);
    deletePreviewMutation.mutate(id);
  };

  // Filtered unavailabilities
  const filteredUnavailabilities = useMemo(() => {
    return unavailabilities.filter((u) => {
      const matchSearch = searchTerm === '' ||
        (u.resource?.name || 'Feriado Global').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.notes || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchResource = !filterResource || u.resourceId === filterResource || u.global;
      const matchType = !filterType || u.type === filterType;
      return matchSearch && matchResource && matchType;
    });
  }, [unavailabilities, searchTerm, filterResource, filterType]);

  const totalPages = Math.ceil(filteredUnavailabilities.length / pageSize);
  const paginatedUnavailabilities = filteredUnavailabilities.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Interval coloring guarantees that overlapping resources never share the
  // same color, while each unavailability keeps one stable color end-to-end.
  const calendarEventColors = useMemo(() => {
    const colors: Record<string, string> = {};
    const preferredByResource = new Map<string, number>();
    const assigned: { start: string; end: string; resourceId: string; colorIndex: number }[] = [];
    const events = unavailabilities
      .filter(item => !item.global && item.resourceId)
      .map(item => ({ ...item, start: dateOnlyKey(item.startDate), end: dateOnlyKey(item.endDate) }))
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    for (const event of events) {
      const resourceId = event.resourceId as string;
      const overlapping = assigned.filter(item => item.start <= event.end && item.end >= event.start && item.resourceId !== resourceId);
      const usedColors = new Set(overlapping.map(item => item.colorIndex));
      const preferred = preferredByResource.get(resourceId);
      let colorIndex = preferred !== undefined && !usedColors.has(preferred) ? preferred : 0;
      while (usedColors.has(colorIndex)) colorIndex++;
      if (!preferredByResource.has(resourceId)) preferredByResource.set(resourceId, colorIndex);
      assigned.push({ start: event.start, end: event.end, resourceId, colorIndex });
      colors[event.id] = RESOURCE_CALENDAR_COLORS[colorIndex] || `hsl(${Math.round((colorIndex * 137.508) % 360)} 68% 43%)`;
    }

    return colors;
  }, [unavailabilities]);

  // Calendar calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarCells = [];
  // Calendar follows the conventional Sunday-to-Saturday sequence.
  const startOffset = firstDayOfMonth;
  for (let i = 0; i < startOffset; i++) calendarCells.push(null);
  for (let i = 1; i <= totalDaysInMonth; i++) calendarCells.push(new Date(year, month, i));

  const getUnavailabilitiesForDate = (date: Date) => {
    const cellKey = dateOnlyKey(date);
    return filteredUnavailabilities.filter((u) => {
      if (u.annualRecurrence) return dateOnlyMonthDay(cellKey) === dateOnlyMonthDay(u.startDate);
      return cellKey >= dateOnlyKey(u.startDate) && cellKey <= dateOnlyKey(u.endDate);
    });
  };

  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const typeColors: Record<string, string> = { FERIADO: '#ef4444', FERIAS: '#079ae1', ATESTADO: '#f59e0b', TREINAMENTO: '#10b981', LICENCA: '#8b5cf6', OUTRO: '#64748b' };
  const typeLabels: Record<string, string> = { FERIADO: 'Feriado', FERIAS: 'Férias', ATESTADO: 'Atestado', TREINAMENTO: 'Treinamento', LICENCA: 'Licença', OUTRO: 'Outro' };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Indisponibilidades</h1>
          <p className="page-subtitle">Gerencie feriados, férias, folgas e licenças que afetam a capacidade da equipe</p>
        </div>
        <div className="page-actions">
          <button className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setViewMode('table')}>
            <List size={14} /> Tabela
          </button>
          <button className={`btn btn-sm ${viewMode === 'calendar' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setViewMode('calendar')}>
            <LayoutGrid size={14} /> Calendário
          </button>
          <button className="btn btn-accent btn-sm" onClick={() => { resetForm(); setShowCreateModal(true); }}>
            <CalendarIcon size={14} /> Nova Indisponibilidade
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="input-group" style={{ flex: 1, maxWidth: '280px' }}>
          <span className="input-icon"><Search size={14} /></span>
          <input className="input" placeholder="Buscar..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }} />
        </div>
        <select className="input" style={{ maxWidth: '180px' }} value={filterResource} onChange={e => setFilterResource(e.target.value)}>
          <option value="">Todos os Recursos</option>
          {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="input" style={{ maxWidth: '160px' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">Todos os Tipos</option>
          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* TABLE VIEW */}
      {viewMode === 'table' && (
        <div className="table-container">
          {loadingUnavail ? (
            <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando...</div>
          ) : filteredUnavailabilities.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">Nenhuma indisponibilidade cadastrada</div>
            </div>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Recurso / Escopo</th>
                    <th>Tipo</th>
                    <th>Início</th>
                    <th>Término</th>
                    <th>Duração Parcial (Horas/Dia)</th>
                    <th>Observações</th>
                    <th style={{ textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUnavailabilities.map(u => {
                    const hrs = u.unavailableMinutesPerDay ? (u.unavailableMinutesPerDay / 60).toFixed(1) + 'h/dia' : 'Dia Integral';
                    return (
                      <tr key={u.id}>
                        <td className="font-semibold" style={{ color: u.global ? 'var(--accent)' : 'var(--foreground)' }}>
                          {u.global ? 'GLOBAL (Feriado Corporativo)' : u.resource?.name || 'Recurso Desconhecido'}
                        </td>
                        <td>
                          <span className="badge" style={{ background: `${typeColors[u.type]}20`, color: typeColors[u.type], border: `1px solid ${typeColors[u.type]}40` }}>
                            {typeLabels[u.type]}
                          </span>
                        </td>
                        <td>{formatDateOnlyPtBr(u.startDate)}</td>
                        <td>{formatDateOnlyPtBr(u.endDate)}</td>
                        <td><span className="badge badge-navy">{hrs}</span></td>
                        <td className="text-xs text-muted">{u.notes || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn-icon" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteClick(u.id)} title="Excluir">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="pagination-wrapper">
                <div className="pagination-info">
                  Mostrando {Math.min((currentPage - 1) * pageSize + 1, filteredUnavailabilities.length)} a {Math.min(currentPage * pageSize, filteredUnavailabilities.length)} de {filteredUnavailabilities.length} itens
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div className="pagination-size">
                    <span>Itens por página:</span>
                    <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                      <option value={10}>10</option>
                      <option value={15}>15</option>
                      <option value={20}>20</option>
                      <option value={25}>25</option>
                    </select>
                  </div>
                  <div className="pagination-controls">
                    <button className="pagination-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(pg => (
                      <button key={pg} className={`pagination-btn ${currentPage === pg ? 'active' : ''}`} onClick={() => setCurrentPage(pg)}>
                        {pg}
                      </button>
                    ))}
                    <button className="pagination-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* CALENDAR VIEW */}
      {viewMode === 'calendar' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
            <div>
              <h3 className="card-title" style={{ fontSize: '1.125rem' }}>{monthNames[month]} {year}</h3>
              <p className="text-xs text-muted">Recursos simultâneos recebem cores diferentes e cada afastamento mantém sua cor.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button className="btn btn-secondary btn-icon" onClick={handlePrevMonth}><ChevronLeft size={16} /></button>
              <button className="btn btn-secondary btn-icon" onClick={handleNextMonth}><ChevronRight size={16} /></button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontWeight: '600', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            <div style={{ color: 'var(--danger)' }}>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div>
            <div style={{ color: 'var(--danger)' }}>Sáb</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '105px', gap: '2px', background: 'var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {calendarCells.map((date, idx) => {
              if (!date) return <div key={`empty-${idx}`} style={{ background: 'var(--background)' }} />;
              const isToday = date.toDateString() === new Date().toDateString();
              const unavails = getUnavailabilitiesForDate(date);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;

              return (
                <div key={date.toISOString()} style={{
                  background: isToday ? 'var(--primary-light)' : isWeekend ? '#f8fafc' : '#ffffff',
                  padding: '0.375rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', overflow: 'hidden'
                }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: isToday ? '700' : '500', color: isToday ? 'var(--primary)' : isWeekend ? 'var(--text-muted)' : 'var(--foreground)' }}>
                    {date.getDate()}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', overflowY: 'auto', flex: 1 }}>
                    {unavails.map(u => {
                      const eventColor = u.global ? '#ef4444' : (calendarEventColors[u.id] || '#079ae1');
                      return (
                      <div key={u.id} data-unavailability-id={u.id} data-resource-id={u.resourceId || 'GLOBAL'} data-event-color={eventColor} title={u.global ? (u.notes || 'Feriado global') : `${u.resource?.name || 'Recurso'} — ${typeLabels[u.type]}`} style={{
                        fontSize: '0.625rem', background: `${eventColor}18`, color: eventColor,
                        border: `1px solid ${eventColor}55`, borderLeft: `3px solid ${eventColor}`, padding: '0.125rem 0.25rem', borderRadius: 'var(--radius-sm)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}>
                        <span className="truncate">{u.global ? 'Feriado' : u.resource?.name.split(' ')[0]}</span>
                        <button onClick={e => { e.stopPropagation(); handleDeleteClick(u.id); }} style={{ border: 'none', background: 'none', color: eventColor, cursor: 'pointer' }}>
                          <Trash2 size={10} />
                        </button>
                      </div>
                    );})}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Modal (Hours input) */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>Registrar Indisponibilidade</h3>
              <button className="btn-icon" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreatePreviewSubmit}>
              <div className="modal-body">
                {errorMsg && (
                  <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
                    <ShieldAlert size={16} /> <span>{errorMsg}</span>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Tipo *</label>
                  <select className="input" value={type} onChange={e => setType(e.target.value as any)}>
                    {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>

                <label className="checkbox-wrapper" style={{ marginBottom: '1rem', fontSize: '0.8125rem' }}>
                  <input type="checkbox" checked={global} onChange={e => { setGlobal(e.target.checked); if (e.target.checked) setResourceId(''); }} />
                  <span>Indisponibilidade Global (Feriados corporativos)</span>
                </label>

                {!global && (
                  <div className="form-group">
                    <label className="form-label">Recurso Técnico *</label>
                    <select className="input" required={!global} value={resourceId} onChange={e => setResourceId(e.target.value)}>
                      <option value="">Selecione...</option>
                      {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Data Inicial *</label>
                    <input type="date" className="input" required value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Data Final *</label>
                    <input type="date" className="input" required value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Horas Indisponíveis por Dia (Parcial em Horas)</label>
                  <input type="number" step="0.5" className="input" placeholder="Ex: 2.5 (Em branco = dia integral)" value={partialHours} onChange={e => setPartialHours(e.target.value)} />
                </div>

                {global && (
                  <label className="checkbox-wrapper" style={{ marginBottom: '1rem', fontSize: '0.8125rem' }}>
                    <input type="checkbox" checked={annualRecurrence} onChange={e => setAnnualRecurrence(e.target.checked)} />
                    <span>Recorrência Anual (ex: Natal, Ano Novo)</span>
                  </label>
                )}

                <div className="form-group">
                  <label className="form-label">Observações</label>
                  <textarea className="input" style={{ minHeight: '60px' }} placeholder="Motivo/justificativa..." value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={previewMutation.isPending}>
                  Simular Impacto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ImpactSimulationModal
        open={showPreviewModal}
        data={previewResult}
        onClose={() => setShowPreviewModal(false)}
        onConfirm={handleConfirmAction}
        confirmLabel="Confirmar e Salvar"
        context={previewActionType === 'delete' ? 'Remoção de uma indisponibilidade' : 'Cadastro de uma nova indisponibilidade'}
        isConfirming={confirmCreateMutation.isPending || confirmDeleteMutation.isPending}
      />
    </div>
  );
}
