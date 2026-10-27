'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { dateOnlyKey, dateOnlyUtcTimestamp, formatDateOnlyPtBr, todayDateOnly } from '@/lib/date-only';
import {
  BarChart3, Building2, CheckCircle, ChevronLeft, ChevronRight, Clock,
  Edit2, LayoutGrid, List, Loader2, MessageSquare, RotateCcw, Search, Trash2, X,
} from 'lucide-react';
import { ConfirmationModal } from '@/components/ConfirmationModal';

interface Delivery {
  id: string; projectId: string; deliveryDate: string; notes?: string | null;
  project: { id: string; sdNumber: string; title: string };
  recipientDept: { id: string; code: string; name: string };
  feedback?: { id: string; feedbackDate: string; notes?: string | null } | null;
}
interface Department { id: string; code: string; name: string }
interface DeptMetric {
  departmentId: string; departmentCode: string; departmentName: string;
  totalDeliveries: number; totalWithFeedback: number; totalPending: number;
  avgResponseDays: number; minResponseDays: number; maxResponseDays: number;
}

const dateInput = (value: string) => dateOnlyKey(value);
const dateLabel = (value: string) => formatDateOnlyPtBr(value);
const elapsedDays = (value: string) => Math.max(0, Math.floor((dateOnlyUtcTimestamp(todayDateOnly()) - dateOnlyUtcTimestamp(value)) / 86400000));
const waitingLabel = (value: string) => { const days = elapsedDays(value); return `Aguardando há ${days} ${days === 1 ? 'dia' : 'dias'}`; };

export default function DeliveriesPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'deliveries' | 'metrics'>('deliveries');
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [completionFilter, setCompletionFilter] = useState<'ALL' | 'COMPLETED' | 'PENDING'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [deliveryDept, setDeliveryDept] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [feedbackDelivery, setFeedbackDelivery] = useState<Delivery | null>(null);
  const [feedbackDate, setFeedbackDate] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [deliveryToDelete, setDeliveryToDelete] = useState<Delivery | null>(null);
  const [feedbackToDelete, setFeedbackToDelete] = useState<Delivery | null>(null);
  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || 'null') : null;
  const canEditDelivery = user?.role === 'ADMIN' || user?.role === 'PROJECT_MANAGER';

  const invalidPeriod = !!startDate && !!endDate && startDate > endDate;
  const { data: deliveries = [], isLoading } = useQuery<Delivery[]>({
    queryKey: ['deliveries-all', departmentFilter, completionFilter, startDate, endDate],
    enabled: !invalidPeriod,
    queryFn: () => {
      const params = new URLSearchParams();
      if (departmentFilter) params.set('departmentId', departmentFilter);
      if (completionFilter !== 'ALL') params.set('completion', completionFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const query = params.toString();
      return apiRequest(`/deliveries/all${query ? `?${query}` : ''}`);
    },
  });
  const { data: metrics = [], isLoading: loadingMetrics } = useQuery<DeptMetric[]>({ queryKey: ['deliveries-metrics'], queryFn: () => apiRequest('/deliveries/metrics') });
  const { data: departments = [] } = useQuery<Department[]>({ queryKey: ['departments'], queryFn: () => apiRequest('/departments') });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deliveries-all'] });
    queryClient.invalidateQueries({ queryKey: ['deliveries-pending'] });
    queryClient.invalidateQueries({ queryKey: ['deliveries-metrics'] });
  };
  const deliveryMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => apiRequest(`/deliveries/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: () => { refresh(); setEditingDelivery(null); },
  });
  const feedbackMutation = useMutation({
    mutationFn: ({ delivery, payload }: { delivery: Delivery; payload: any }) => apiRequest(`/deliveries/${delivery.id}/feedback`, { method: delivery.feedback ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => { refresh(); setFeedbackDelivery(null); },
  });
  const deleteDeliveryMutation = useMutation({
    mutationFn: (delivery: Delivery) => apiRequest(`/deliveries/${delivery.id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); setDeliveryToDelete(null); },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir a entrega.'),
  });
  const deleteFeedbackMutation = useMutation({
    mutationFn: (delivery: Delivery) => apiRequest(`/deliveries/${delivery.id}/feedback`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); setFeedbackToDelete(null); },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir a devolutiva.'),
  });

  const clearFilters = () => {
    setSearchTerm(''); setDepartmentFilter(''); setCompletionFilter('ALL'); setStartDate(''); setEndDate(''); setCurrentPage(1);
  };

  const openDeliveryEdit = (delivery: Delivery) => {
    setEditingDelivery(delivery); setDeliveryDept(delivery.recipientDept.id);
    setDeliveryDate(dateInput(delivery.deliveryDate)); setDeliveryNotes(delivery.notes || '');
  };
  const openFeedback = (delivery: Delivery) => {
    setFeedbackDelivery(delivery);
    setFeedbackDate(delivery.feedback ? dateInput(delivery.feedback.feedbackDate) : todayDateOnly());
    setFeedbackNotes(delivery.feedback?.notes || '');
  };
  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return deliveries.filter(item => item.project.sdNumber.toLowerCase().includes(term) || item.project.title.toLowerCase().includes(term) || item.recipientDept.code.toLowerCase().includes(term));
  }, [deliveries, searchTerm]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pendingCount = deliveries.filter(item => !item.feedback).length;

  return <div>
    <div className="page-header">
      <div><h1 className="page-title">Entregas e Devolutivas</h1><p className="page-subtitle">Consulte e corrija datas, destinatários, observações e pareceres registrados</p></div>
      {activeTab === 'deliveries' && <div className="page-actions">
        <button className={`btn btn-sm ${displayMode === 'table' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDisplayMode('table')}><List size={14}/> Tabela</button>
        <button className={`btn btn-sm ${displayMode === 'cards' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDisplayMode('cards')}><LayoutGrid size={14}/> Cards</button>
      </div>}
    </div>

    <div className="tabs-container">
      <button className={`tab-button ${activeTab === 'deliveries' ? 'active' : ''}`} onClick={() => setActiveTab('deliveries')}><Clock size={15}/> Todas as Entregas ({deliveries.length})</button>
      <button className={`tab-button ${activeTab === 'metrics' ? 'active' : ''}`} onClick={() => setActiveTab('metrics')}><BarChart3 size={15}/> Indicadores por Departamento</button>
    </div>

    {activeTab === 'deliveries' && <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="deliveries-filter-panel">
        <div className="deliveries-filter-heading">
          <div><strong>Filtros das entregas</strong><span>Refine a lista por projeto, destinatário, situação ou período</span></div>
          {!invalidPeriod && <span className="badge badge-warning">{pendingCount} pendente{pendingCount === 1 ? '' : 's'} no resultado</span>}
        </div>
        <div className="deliveries-filter-grid">
          <div className="deliveries-filter-field deliveries-filter-search"><label className="form-label">Pesquisar</label><div className="input-group"><span className="input-icon"><Search size={14}/></span><input className="input" placeholder="SD, título ou departamento..." value={searchTerm} onChange={event => { setSearchTerm(event.target.value); setCurrentPage(1); }}/></div></div>
          <div className="deliveries-filter-field deliveries-filter-department"><label className="form-label">Departamento destinatário</label><select className="input" value={departmentFilter} onChange={event => { setDepartmentFilter(event.target.value); setCurrentPage(1); }}><option value="">Todos os departamentos</option>{departments.map(department => <option key={department.id} value={department.id}>{department.code} — {department.name}</option>)}</select></div>
          <div className="deliveries-filter-field deliveries-filter-status"><label className="form-label">Situação</label><select className="input" value={completionFilter} onChange={event => { setCompletionFilter(event.target.value as any); setCurrentPage(1); }}><option value="ALL">Todas</option><option value="COMPLETED">Concluídas</option><option value="PENDING">Pendentes</option></select></div>
          <div className="deliveries-filter-period"><span className="form-label">Período da entrega</span><div><input type="date" aria-label="Data inicial da entrega" className="input" value={startDate} max={endDate || undefined} onChange={event => { setStartDate(event.target.value); setCurrentPage(1); }}/><span>até</span><input type="date" aria-label="Data final da entrega" className="input" value={endDate} min={startDate || undefined} onChange={event => { setEndDate(event.target.value); setCurrentPage(1); }}/></div></div>
          <button className="btn btn-secondary deliveries-filter-clear" onClick={clearFilters} title="Limpar todos os filtros"><RotateCcw size={14}/> Limpar</button>
        </div>
      </div>
      {invalidPeriod && <div className="alert alert-danger">A data inicial não pode ser posterior à data final.</div>}
      {isLoading ? <div className="loading-center"><Loader2 className="spinner" size={20}/> Carregando entregas...</div> : !filtered.length ? <div className="empty-state"><div className="empty-state-icon"><CheckCircle size={20}/></div><div className="empty-state-title">Nenhuma entrega encontrada</div></div> : displayMode === 'table' ?
        <div className="table-container deliveries-table-container"><table className="table deliveries-table"><thead><tr><th>SD / Projeto</th><th>Destinatário</th><th>Entrega</th><th>Devolutiva</th><th>Observações</th><th>Ações</th></tr></thead><tbody>
          {paginated.map(item => <tr key={item.id}>
            <td><div className="delivery-project-cell"><strong>{item.project.sdNumber}</strong><span title={item.project.title}>{item.project.title}</span></div></td>
            <td><span className="badge badge-navy">{item.recipientDept.code}</span></td>
            <td><strong>{dateLabel(item.deliveryDate)}</strong><div className="text-xs text-muted">{item.feedback ? 'Concluída' : waitingLabel(item.deliveryDate)}</div></td>
            <td>{item.feedback ? <><span className="badge badge-active">Recebida</span><div className="text-xs text-muted mt-1">{dateLabel(item.feedback.feedbackDate)}</div></> : <span className="badge badge-warning">Pendente</span>}</td>
            <td><div className="delivery-notes"><div><strong>Entrega:</strong> {item.notes || '—'}</div>{item.feedback && <div><strong>Devolutiva:</strong> {item.feedback.notes || '—'}</div>}</div></td>
            <td><div className="delivery-table-actions">
              <div className="delivery-action-group"><span>Entrega</span><div>{canEditDelivery && <button className="btn btn-secondary btn-xs" title="Editar esta entrega" onClick={() => openDeliveryEdit(item)}><Edit2 size={12}/> Editar</button>}{canEditDelivery && <button className="btn btn-danger-outline btn-xs" title="Excluir esta entrega" onClick={() => setDeliveryToDelete(item)}><Trash2 size={12}/> Excluir entrega</button>}</div></div>
              <div className="delivery-action-group"><span>Devolutiva</span><div><button className="btn btn-primary btn-xs" onClick={() => openFeedback(item)}><MessageSquare size={12}/> {item.feedback ? 'Editar' : 'Registrar'}</button>{item.feedback && <button className="btn btn-danger-outline btn-xs" title="Excluir somente a devolutiva" onClick={() => setFeedbackToDelete(item)}><Trash2 size={12}/> Excluir devolutiva</button>}</div></div>
            </div></td>
          </tr>)}
        </tbody></table><Pagination current={page} total={totalPages} count={filtered.length} size={pageSize} onPage={setCurrentPage} onSize={value => { setPageSize(value); setCurrentPage(1); }}/></div>
      : <div className="delivery-card-grid">{paginated.map(item => <article key={item.id} className="card delivery-card">
          <header className="delivery-card-header"><div className="delivery-card-identity"><strong>{item.project.sdNumber}</strong><h3 title={item.project.title}>{item.project.title}</h3></div><span className="badge badge-navy delivery-card-department">{item.recipientDept.code}</span></header>
          <div className="delivery-card-content">
            <section className="delivery-card-section"><span className="delivery-card-section-label">Entrega realizada</span><strong>{dateLabel(item.deliveryDate)}</strong><p>{item.notes || 'Sem observações cadastradas.'}</p></section>
            <section className="delivery-card-section"><span className="delivery-card-section-label">Devolutiva</span>{item.feedback ? <><strong>{dateLabel(item.feedback.feedbackDate)}</strong><p>{item.feedback.notes || 'Sem observações cadastradas.'}</p></> : <span className="badge badge-warning delivery-pending-badge">Aguardando devolutiva</span>}</section>
          </div>
          <footer className="delivery-card-actions">
            <div className="delivery-action-row"><span>Entrega</span><div>{canEditDelivery && <button className="btn btn-secondary btn-xs" onClick={() => openDeliveryEdit(item)}><Edit2 size={12}/> Editar</button>}{canEditDelivery && <button className="btn btn-danger-outline btn-xs" onClick={() => setDeliveryToDelete(item)}><Trash2 size={12}/> Excluir entrega</button>}</div></div>
            <div className="delivery-action-row"><span>Devolutiva</span><div><button className="btn btn-primary btn-xs" onClick={() => openFeedback(item)}><MessageSquare size={12}/> {item.feedback ? 'Editar' : 'Registrar'}</button>{item.feedback && <button className="btn btn-danger-outline btn-xs" onClick={() => setFeedbackToDelete(item)}><Trash2 size={12}/> Excluir devolutiva</button>}</div></div>
          </footer>
        </article>)}</div>}
    </div>}

    {activeTab === 'metrics' && (loadingMetrics ? <div className="loading-center"><Loader2 className="spinner" size={20}/> Carregando indicadores...</div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>{metrics.map(metric => <div key={metric.departmentId} className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '.65rem' }}><strong><Building2 size={14}/> {metric.departmentCode}</strong><span className="text-xs text-muted">{metric.departmentName}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem', textAlign: 'center', marginTop: '.8rem' }}><div><span className="text-xs text-muted">Total</span><strong style={{ display: 'block' }}>{metric.totalDeliveries}</strong></div><div><span className="text-xs text-muted">Respondidas</span><strong style={{ display: 'block', color: 'var(--success)' }}>{metric.totalWithFeedback}</strong></div><div><span className="text-xs text-muted">Pendentes</span><strong style={{ display: 'block', color: '#b45309' }}>{metric.totalPending}</strong></div></div>
      <div className="text-xs text-muted mt-2">Tempo médio de resposta: <strong>{metric.avgResponseDays} dias</strong></div>
    </div>)}</div>)}

    {editingDelivery && <div className="modal-overlay" onClick={() => setEditingDelivery(null)}><div className="modal-content" onClick={event => event.stopPropagation()} style={{ maxWidth: 480 }}><div className="modal-header"><div><h3>Editar entrega</h3><p className="text-xs text-muted mt-1">SD {editingDelivery.project.sdNumber}</p></div><button className="btn-icon" onClick={() => setEditingDelivery(null)}><X size={18}/></button></div><form onSubmit={async event => { event.preventDefault(); try { await deliveryMutation.mutateAsync({ id: editingDelivery.id, payload: { recipientDeptId: deliveryDept, deliveryDate, notes: deliveryNotes } }); } catch (error: any) { alert(error.message || 'Não foi possível atualizar a entrega.'); } }}><div className="modal-body">
      <div className="form-group"><label className="form-label">Departamento destinatário *</label><select className="input" required value={deliveryDept} onChange={event => setDeliveryDept(event.target.value)}>{departments.map(department => <option key={department.id} value={department.id}>{department.name} ({department.code})</option>)}</select></div>
      <div className="form-group"><label className="form-label">Data da entrega *</label><input type="date" className="input" required value={deliveryDate} max={editingDelivery.feedback ? dateInput(editingDelivery.feedback.feedbackDate) : undefined} onChange={event => setDeliveryDate(event.target.value)}/>{editingDelivery.feedback && <span className="text-xs text-muted">Não pode ser posterior à devolutiva de {dateLabel(editingDelivery.feedback.feedbackDate)}.</span>}</div>
      <div className="form-group"><label className="form-label">Observações</label><textarea className="input" style={{ minHeight: 90 }} value={deliveryNotes} onChange={event => setDeliveryNotes(event.target.value)}/></div>
    </div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setEditingDelivery(null)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={deliveryMutation.isPending}>{deliveryMutation.isPending ? 'Salvando...' : 'Salvar alterações'}</button></div></form></div></div>}

    {feedbackDelivery && <div className="modal-overlay" onClick={() => setFeedbackDelivery(null)}><div className="modal-content" onClick={event => event.stopPropagation()} style={{ maxWidth: 480 }}><div className="modal-header"><div><h3>{feedbackDelivery.feedback ? 'Editar devolutiva' : 'Registrar devolutiva'}</h3><p className="text-xs text-muted mt-1">SD {feedbackDelivery.project.sdNumber} · {feedbackDelivery.recipientDept.code}</p></div><button className="btn-icon" onClick={() => setFeedbackDelivery(null)}><X size={18}/></button></div><form onSubmit={async event => { event.preventDefault(); try { await feedbackMutation.mutateAsync({ delivery: feedbackDelivery, payload: { feedbackDate, notes: feedbackNotes } }); } catch (error: any) { alert(error.message || 'Não foi possível salvar a devolutiva.'); } }}><div className="modal-body">
      <div className="form-group"><label className="form-label">Data da devolutiva *</label><input type="date" className="input" required min={dateInput(feedbackDelivery.deliveryDate)} value={feedbackDate} onChange={event => setFeedbackDate(event.target.value)}/><span className="text-xs text-muted">A entrega foi registrada em {dateLabel(feedbackDelivery.deliveryDate)}.</span></div>
      <div className="form-group"><label className="form-label">Observações / parecer</label><textarea className="input" style={{ minHeight: 100 }} value={feedbackNotes} onChange={event => setFeedbackNotes(event.target.value)}/></div>
    </div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setFeedbackDelivery(null)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={feedbackMutation.isPending}>{feedbackMutation.isPending ? 'Salvando...' : feedbackDelivery.feedback ? 'Salvar alterações' : 'Registrar devolutiva'}</button></div></form></div></div>}
    <ConfirmationModal
      open={!!feedbackToDelete}
      title="Excluir devolutiva?"
      description="A devolutiva será removida e a entrega voltará a aparecer como pendente."
      detail={feedbackToDelete ? `SD ${feedbackToDelete.project.sdNumber} · ${feedbackToDelete.recipientDept.code} · devolutiva de ${dateLabel(feedbackToDelete.feedback!.feedbackDate)}` : undefined}
      confirmLabel="Excluir devolutiva"
      isPending={deleteFeedbackMutation.isPending}
      onClose={() => setFeedbackToDelete(null)}
      onConfirm={() => { if (feedbackToDelete) deleteFeedbackMutation.mutate(feedbackToDelete); }}
    />
    <ConfirmationModal
      open={!!deliveryToDelete}
      title="Excluir entrega?"
      description={deliveryToDelete?.feedback ? 'A entrega e sua devolutiva vinculada serão removidas juntas.' : 'A entrega será removida do projeto.'}
      detail={deliveryToDelete ? `SD ${deliveryToDelete.project.sdNumber} · ${deliveryToDelete.recipientDept.code} · entrega de ${dateLabel(deliveryToDelete.deliveryDate)}` : undefined}
      confirmLabel={deliveryToDelete?.feedback ? 'Excluir entrega e devolutiva' : 'Excluir entrega'}
      isPending={deleteDeliveryMutation.isPending}
      onClose={() => setDeliveryToDelete(null)}
      onConfirm={() => { if (deliveryToDelete) deleteDeliveryMutation.mutate(deliveryToDelete); }}
    />
  </div>;
}

function Pagination({ current, total, count, size, onPage, onSize }: { current: number; total: number; count: number; size: number; onPage: (page: number) => void; onSize: (size: number) => void }) {
  return <div className="pagination-wrapper"><div className="pagination-info">{count} registro{count === 1 ? '' : 's'}</div><div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}><div className="pagination-size"><span>Itens por página:</span><select value={size} onChange={event => onSize(Number(event.target.value))}>{[10, 15, 20, 25].map(value => <option key={value} value={value}>{value}</option>)}</select></div><div className="pagination-controls"><button className="pagination-btn" disabled={current <= 1} onClick={() => onPage(current - 1)}><ChevronLeft size={14}/></button><span className="pagination-current">{current} de {total}</span><button className="pagination-btn" disabled={current >= total} onClick={() => onPage(current + 1)}><ChevronRight size={14}/></button></div></div></div>;
}
