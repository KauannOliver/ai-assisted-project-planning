'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { formatDateOnlyPtBr, todayDateOnly } from '@/lib/date-only';
import {
  Plus, Search, Filter, Edit2, AlertTriangle, Info, CheckCircle2, XCircle, Eye, Loader2, AlertCircle, ChevronLeft, ChevronRight, RotateCcw, Trash2
} from 'lucide-react';
import Link from 'next/link';
import { ImpactSimulationModal } from '@/components/ImpactSimulationModal';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { PROJECT_STATUS_LABELS as STATUS_LABELS } from '@/lib/project-status';

interface CatalogItem { id: string; code: string; name: string; value?: string; }
interface Department { id: string; code: string; name: string; }
interface Project {
  id: string; sdNumber: string; title: string; requester: string;
  openingDate: string; requestedDeadline?: string;
  classification: CatalogItem; flowType: CatalogItem; businessPriority: CatalogItem; class: CatalogItem;
  totalHours: number; isLegalRequirement: boolean; status: number;
  problemDescription?: string; objective?: string; currentProcess?: string; desiredProcess?: string;
  estimatedMonthlyGain?: number; estimatedMonthlyLossAvoided?: number; roiMonthlyValue?: number;
  committeeDecision?: string; realCompletionDate?: string;
  projectManagerNotes?: string;
  hasAllocatedResources: boolean;
  departments: { department: Department }[]; systems: { system: CatalogItem }[];
}

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [user] = useState<any>(() => {
    if (typeof window !== 'undefined') { const u = localStorage.getItem('user'); return u ? JSON.parse(u) : null; }
    return null;
  });

  const isAdminOrPm = user?.role === 'ADMIN' || user?.role === 'PROJECT_MANAGER';

  // View & filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [kanbanBy, setKanbanBy] = useState<'status' | 'phase' | 'decision'>('status');
  const [draggedProject, setDraggedProject] = useState<any | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [modalTab, setModalTab] = useState(0);

  // Form Fields
  const [sdNumber, setSdNumber] = useState('');
  const [title, setTitle] = useState('');
  const [requester, setRequester] = useState('');
  const [openingDate, setOpeningDate] = useState(() => todayDateOnly());
  const [requestedDeadline, setRequestedDeadline] = useState('');
  const [realCompletionDateField, setRealCompletionDateField] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [currentProcess, setCurrentProcess] = useState('');
  const [desiredProcess, setDesiredProcess] = useState('');
  const [projectManagerNotes, setProjectManagerNotes] = useState('');
  const [classificationId, setClassificationId] = useState('');
  const [flowTypeId, setFlowTypeId] = useState('');
  const [businessPriorityId, setBusinessPriorityId] = useState('');
  const [classId, setClassId] = useState('');
  const [isLegalRequirement, setIsLegalRequirement] = useState(false);
  const [status, setStatus] = useState(1);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedSystems, setSelectedSystems] = useState<string[]>([]);
  const [estimatedMonthlyGain, setEstimatedMonthlyGain] = useState(0);
  const [estimatedMonthlyLossAvoided, setEstimatedMonthlyLossAvoided] = useState(0);

  // Action modals
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [completingProject, setCompletingProject] = useState<Project | null>(null);
  const [realCompletionDate, setRealCompletionDate] = useState(() => todayDateOnly());
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancellingProject, setCancellingProject] = useState<Project | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<(() => Promise<void>) | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  // Queries
  const { data: projects = [], isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ['projects'], queryFn: () => apiRequest('/projects'),
  });
  const { data: kanbanColumns = {}, isLoading: loadingKanban } = useQuery<Record<string, any[]>>({
    queryKey: ['projects-kanban', kanbanBy],
    queryFn: () => apiRequest(`/views/kanban?by=${kanbanBy}`),
    enabled: viewMode === 'kanban',
  });
  const { data: departments = [] } = useQuery<Department[]>({ queryKey: ['departments'], queryFn: () => apiRequest('/departments') });
  const { data: classifications = [] } = useQuery<CatalogItem[]>({ queryKey: ['catalogs', 'classification'], queryFn: () => apiRequest('/catalogs/classification') });
  const { data: flows = [] } = useQuery<CatalogItem[]>({ queryKey: ['catalogs', 'flow_type'], queryFn: () => apiRequest('/catalogs/flow_type') });
  const { data: priorities = [] } = useQuery<CatalogItem[]>({ queryKey: ['catalogs', 'business_priority'], queryFn: () => apiRequest('/catalogs/business_priority') });
  const { data: classes = [] } = useQuery<CatalogItem[]>({ queryKey: ['catalogs', 'class'], queryFn: () => apiRequest('/catalogs/class') });
  const { data: systems = [] } = useQuery<CatalogItem[]>({ queryKey: ['catalogs', 'system'], queryFn: () => apiRequest('/catalogs/system') });

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      if (editingProject) {
        return apiRequest(`/projects/${editingProject.id}/confirm`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        return apiRequest('/projects/confirm', { method: 'POST', body: JSON.stringify(payload) });
      }
    },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ['projects-kanban'] }), queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] })]); setDialogOpen(false); setPreviewOpen(false); setEditingProject(null); resetForm(); },
    onError: (error: any) => alert(error.message || 'Não foi possível salvar o projeto.'),
  });

  const completeMutation = useMutation({
    mutationFn: async ({ id, date }: { id: string; date: string }) =>
      apiRequest(`/projects/${id}/complete/confirm`, { method: 'POST', body: JSON.stringify({ realCompletionDate: date }) }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ['projects-kanban'] }), queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] })]); setCompleteModalOpen(false); setPreviewOpen(false); },
    onError: (error: any) => alert(error.message || 'Não foi possível concluir o projeto.'),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/projects/${id}/cancel/confirm`, { method: 'POST' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); queryClient.invalidateQueries({ queryKey: ['projects-kanban'] }); setCancelModalOpen(false); setPreviewOpen(false); },
  });

  const moveStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: number }) =>
      apiRequest(`/projects/${id}/confirm`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['projects-kanban'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] }),
      ]);
      setPreviewOpen(false);
    },
    onError: (error: any) => alert(error.message || 'Não foi possível alterar o status do projeto.'),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-kanban'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['official-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['capacity-heatmap'] });
      setProjectToDelete(null);
    },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir o projeto.'),
  });

  // Helpers
  const resetForm = () => {
    setSdNumber(''); setTitle(''); setRequester('');
    setOpeningDate(todayDateOnly()); setRequestedDeadline(''); setRealCompletionDateField('');
    setProblemDescription(''); setObjective(''); setCurrentProcess(''); setDesiredProcess(''); setProjectManagerNotes('');
    setClassificationId(''); setFlowTypeId(''); setBusinessPriorityId(''); setClassId('');
    setIsLegalRequirement(false); setStatus(1); setSelectedDepts([]); setSelectedSystems([]);
    setEstimatedMonthlyGain(0); setEstimatedMonthlyLossAvoided(0); setModalTab(0);
  };

  const handleOpenNewDialog = () => {
    setEditingProject(null); resetForm();
    if (classifications.length > 0) setClassificationId(classifications[0].id);
    if (flows.length > 0) setFlowTypeId(flows[0].id);
    if (priorities.length > 0) setBusinessPriorityId(priorities[0].id);
    if (classes.length > 0) setClassId(classes[0].id);
    setDialogOpen(true);
  };

  const handleOpenEditDialog = (proj: Project) => {
    setEditingProject(proj); setModalTab(0);
    setSdNumber(proj.sdNumber); setTitle(proj.title); setRequester(proj.requester);
    setOpeningDate(proj.openingDate.split('T')[0]);
    setRequestedDeadline(proj.requestedDeadline ? proj.requestedDeadline.split('T')[0] : '');
    setRealCompletionDateField(proj.realCompletionDate ? proj.realCompletionDate.split('T')[0] : '');
    setProblemDescription(proj.problemDescription || ''); setObjective(proj.objective || '');
    setCurrentProcess(proj.currentProcess || ''); setDesiredProcess(proj.desiredProcess || '');
    setProjectManagerNotes(proj.projectManagerNotes || '');
    setClassificationId(proj.classification.id); setFlowTypeId(proj.flowType.id);
    setBusinessPriorityId(proj.businessPriority.id); setClassId(proj.class.id);
    setIsLegalRequirement(proj.isLegalRequirement); setStatus(proj.status);
    setSelectedDepts(proj.departments.map(d => d.department.id));
    setSelectedSystems(proj.systems.map(s => s.system.id));
    setEstimatedMonthlyGain(proj.estimatedMonthlyGain || 0);
    setEstimatedMonthlyLossAvoided(proj.estimatedMonthlyLossAvoided || 0);
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProject && status === 7 && !realCompletionDateField) {
      alert('Informe a data real de conclusão para concluir o projeto.');
      setModalTab(0);
      return;
    }
    if (selectedDepts.length === 0) { alert('Selecione ao menos um departamento.'); return; }
    if (selectedSystems.length === 0) { alert('Selecione ao menos um sistema.'); return; }
    const payload: any = {
      sdNumber, title, requester, openingDate,
      requestedDeadline: requestedDeadline || undefined,
      problemDescription, objective, currentProcess, desiredProcess, projectManagerNotes,
      classificationId, flowTypeId, businessPriorityId, classId,
      isLegalRequirement, status, departmentIds: selectedDepts, systemIds: selectedSystems,
      estimatedMonthlyGain: Number(estimatedMonthlyGain),
      estimatedMonthlyLossAvoided: Number(estimatedMonthlyLossAvoided),
    };
    if (editingProject) payload.realCompletionDate = status === 7 ? realCompletionDateField : null;
    try {
      const previewUrl = editingProject ? `/projects/${editingProject.id}/preview` : `/projects/preview`;
      const preview = await apiRequest(previewUrl, { method: editingProject ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setPreviewData(preview);
      setPendingConfirmAction(() => async () => { await saveMutation.mutateAsync(payload); });
      setPreviewOpen(true);
    } catch (err: any) { alert(err.message || 'Erro ao processar.'); }
  };

  const handleCompleteFlow = (proj: Project) => { setCompletingProject(proj); setCompleteModalOpen(true); };
  const submitComplete = async () => {
    if (!completingProject) return;
    try {
      const preview = await apiRequest(`/projects/${completingProject.id}/complete/preview`, { method: 'POST', body: JSON.stringify({ realCompletionDate }) });
      setPreviewData(preview);
      setPendingConfirmAction(() => async () => { await completeMutation.mutateAsync({ id: completingProject.id, date: realCompletionDate }); });
      setCompleteModalOpen(false);
      setPreviewOpen(true);
    } catch (err: any) { alert(err.message); }
  };

  const handleCancelFlow = (proj: Project) => { setCancellingProject(proj); setCancelModalOpen(true); };
  const submitCancel = async () => {
    if (!cancellingProject) return;
    try {
      const preview = await apiRequest(`/projects/${cancellingProject.id}/cancel/preview`, { method: 'POST' });
      setPreviewData(preview);
      setPendingConfirmAction(() => async () => { await cancelMutation.mutateAsync(cancellingProject.id); });
      setCancelModalOpen(false);
      setPreviewOpen(true);
    } catch (err: any) { alert(err.message); }
  };

  const handleToggleDept = (id: string) => setSelectedDepts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const handleToggleSystem = (id: string) => setSelectedSystems(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Status badge with proper styling for ALL statuses
  const getStatusBadge = (st: number) => <span className={`status-badge status-${st}`}>{STATUS_LABELS[st] || 'Desconhecido'}</span>;

  const getPriorityBadge = (code: string, name: string) => {
    const cls = code === 'alta' ? 'priority-alta' : code === 'media' ? 'priority-media' : 'priority-baixa';
    return <span className={`badge ${cls}`}>{name}</span>;
  };

  // Filtered & paginated data
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchSearch = p.sdNumber.toLowerCase().includes(searchTerm.toLowerCase()) || p.title.toLowerCase().includes(searchTerm.toLowerCase());
      const matchDept = !filterDept || p.departments.some(d => d.department.id === filterDept);
      const matchStatus = !filterStatus || p.status.toString() === filterStatus;
      return matchSearch && matchDept && matchStatus;
    });
  }, [projects, searchTerm, filterDept, filterStatus]);

  const totalPages = Math.ceil(filteredProjects.length / pageSize);
  const paginatedProjects = filteredProjects.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Reset page when filters change
  const handleFilterChange = (setter: any) => (val: any) => { setter(val); setCurrentPage(1); };

  // Actions per status
  const getActions = (p: Project) => {
    const actions: React.ReactNode[] = [];
    // View — always available
    actions.push(
      <Link key="view" href={`/dashboard/projects/${p.id}`} className="btn-icon" title="Visualizar">
        <Eye size={15} />
      </Link>
    );
    if (!isAdminOrPm) return actions;
    // Edit — always available for admin/pm
    actions.push(
      <button key="edit" onClick={() => handleOpenEditDialog(p)} className="btn-icon" title="Editar">
        <Edit2 size={15} />
      </button>
    );
    // Complete — for non-completed, non-cancelled (also for devolvidos status=8)
    if (p.status !== 7 && p.status !== 9) {
      actions.push(
        <button key="complete" onClick={() => handleCompleteFlow(p)} className="btn-icon" title="Concluir" style={{ color: 'var(--success)' }}>
          <CheckCircle2 size={15} />
        </button>
      );
    }
    actions.push(
      <button key="delete" onClick={() => setProjectToDelete(p)} className="btn-icon" title="Excluir projeto permanentemente" style={{ color: 'var(--danger)' }}>
        <Trash2 size={15} />
      </button>
    );
    // Cancel — for non-completed, non-cancelled
    if (p.status !== 7 && p.status !== 9) {
      actions.push(
        <button key="cancel" onClick={() => handleCancelFlow(p)} className="btn-icon" title="Cancelar" style={{ color: 'var(--danger)' }}>
          <XCircle size={15} />
        </button>
      );
    }
    // Devolvido (8): also show reopen possibility via edit
    return actions;
  };

  // Kanban helper for column labels
  const getKanbanLabel = (colName: string, by: string) => {
    if (by === 'status') {
      const num = parseInt(colName);
      if (!isNaN(num) && STATUS_LABELS[num]) return `${num}. ${STATUS_LABELS[num]}`;
    }
    return colName;
  };

  const handleKanbanStatusDrop = async (targetStatus: number) => {
    const project = draggedProject;
    setDraggedProject(null);
    if (!project || !isAdminOrPm || kanbanBy !== 'status' || project.status === targetStatus) return;

    const fullProject = projects.find(item => item.id === project.id);
    if (!fullProject) return;

    if (targetStatus === 7) {
      handleCompleteFlow(fullProject);
      return;
    }
    if (targetStatus === 9) {
      handleCancelFlow(fullProject);
      return;
    }

    try {
      const preview = await apiRequest(`/projects/${project.id}/preview`, {
        method: 'PATCH',
        body: JSON.stringify({ status: targetStatus }),
      });
      const confirmMove = async () => {
        await moveStatusMutation.mutateAsync({ id: project.id, status: targetStatus });
      };
      setPreviewData(preview);
      setPendingConfirmAction(() => confirmMove);
      setPreviewOpen(true);
    } catch (err: any) {
      alert(err.message || 'Não foi possível alterar o status pelo Kanban.');
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Projetos</h1>
          <p className="page-subtitle">Gerencie demandas, solicitações e alocações de recursos</p>
        </div>
        <div className="page-actions">
          <button onClick={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')} className="btn btn-secondary btn-sm">
            {viewMode === 'list' ? 'Kanban' : 'Lista'}
          </button>
          {isAdminOrPm && (
            <button onClick={handleOpenNewDialog} className="btn btn-accent btn-sm">
              <Plus size={14} /> Novo Projeto
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="input-group" style={{ flex: 1, maxWidth: '320px' }}>
          <span className="input-icon"><Search size={15} /></span>
          <input className="input" placeholder="Buscar SD ou título..." value={searchTerm}
            onChange={(e) => handleFilterChange(setSearchTerm)(e.target.value)} />
        </div>
        <select className="input" style={{ maxWidth: '200px' }} value={filterDept}
          onChange={(e) => handleFilterChange(setFilterDept)(e.target.value)}>
          <option value="">Todos Departamentos</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input" style={{ maxWidth: '200px' }} value={filterStatus}
          onChange={(e) => handleFilterChange(setFilterStatus)(e.target.value)}>
          <option value="">Todos Status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{k}. {v}</option>)}
        </select>
      </div>

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        <div className="table-container">
          {loadingProjects ? (
            <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando projetos...</div>
          ) : filteredProjects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Info size={20} /></div>
              <div className="empty-state-title">Nenhum projeto encontrado</div>
              <p className="text-xs text-muted">Ajuste os filtros ou cadastre uma nova solicitação.</p>
            </div>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>SD</th>
                    <th>Título / Solicitante</th>
                    <th>Depto</th>
                    <th>Classe</th>
                    <th>Prioridade</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProjects.map(p => {
                    const noTAP = p.status === 5 && !p.committeeDecision;
                    const noResources = ![0, 7, 8, 9].includes(p.status) && !p.hasAllocatedResources;
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: '600', color: 'var(--primary)' }}>{p.sdNumber}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: '500' }}>{p.title}</span>
                            <span className="text-xs text-muted">{p.requester}</span>
                            {noTAP && (
                              <span style={{ color: 'var(--accent)', fontSize: '0.6875rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.125rem' }}>
                                <AlertCircle size={11} /> Sem Comitê
                              </span>
                            )}
                            {noResources && (
                              <span className="project-resource-warning">
                                <AlertTriangle size={11} /> Sem recursos alocados
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {p.departments.map(d => (
                              <span key={d.department.id} className="badge badge-navy" style={{ fontSize: '0.625rem' }}>{d.department.code}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: '500' }}>{p.class.name}</span>
                          <span className="text-xs text-muted" style={{ display: 'block' }}>{p.totalHours}h</span>
                        </td>
                        <td>{getPriorityBadge(p.businessPriority.code, p.businessPriority.name)}</td>
                        <td>{getStatusBadge(p.status)}</td>
                        <td>
                          <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                            {getActions(p)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="pagination-wrapper">
                <div className="pagination-info">
                  Mostrando {Math.min((currentPage - 1) * pageSize + 1, filteredProjects.length)} a {Math.min(currentPage * pageSize, filteredProjects.length)} de {filteredProjects.length} projetos
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div className="pagination-size">
                    <span>Itens por página:</span>
                    <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
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
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let pg: number;
                      if (totalPages <= 7) { pg = i + 1; }
                      else if (currentPage <= 4) { pg = i + 1; }
                      else if (currentPage >= totalPages - 3) { pg = totalPages - 6 + i; }
                      else { pg = currentPage - 3 + i; }
                      return (
                        <button key={pg} className={`pagination-btn ${currentPage === pg ? 'active' : ''}`} onClick={() => setCurrentPage(pg)}>
                          {pg}
                        </button>
                      );
                    })}
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

      {/* KANBAN VIEW */}
      {viewMode === 'kanban' && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            {(['status', 'phase', 'decision'] as const).map(by => (
              <button key={by} onClick={() => setKanbanBy(by)}
                className={`btn btn-sm ${kanbanBy === by ? 'btn-primary' : 'btn-secondary'}`}>
                {by === 'status' ? 'Status do Fluxo' : by === 'phase' ? 'Fase Remanescente' : 'Parecer do Comitê'}
              </button>
            ))}
            {kanbanBy === 'status' && isAdminOrPm && (
              <span className="kanban-drag-hint">Arraste um projeto para mudar seu status</span>
            )}
          </div>

          {loadingKanban ? (
            <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando kanban...</div>
          ) : (
            <div className="kanban-board">
              {Object.keys(kanbanColumns).map(colName => {
                const list = kanbanColumns[colName] || [];
                const label = getKanbanLabel(colName, kanbanBy);
                return (
                  <div
                    key={colName}
                    className={`kanban-column ${kanbanBy === 'status' && isAdminOrPm ? 'kanban-drop-enabled' : ''}`}
                    onDragOver={event => {
                      if (kanbanBy === 'status' && isAdminOrPm) event.preventDefault();
                    }}
                    onDrop={event => {
                      event.preventDefault();
                      if (kanbanBy === 'status') handleKanbanStatusDrop(Number(colName));
                    }}
                  >
                    <div className="kanban-column-header">
                      <span>{label}</span>
                      <span className="kanban-column-count">{list.length}</span>
                    </div>
                    <div className="kanban-column-body">
                      {list.length === 0 ? (
                        <p className="text-xs text-muted text-center" style={{ padding: '1rem 0' }}>Sem projetos</p>
                      ) : (
                        list.map((proj: any) => {
                          const isConcluido = proj.status === 7;
                          const noResources = ![0, 7, 8, 9].includes(proj.status) && !proj.hasAllocatedResources;
                          return (
                            <div
                              key={proj.id}
                              draggable={kanbanBy === 'status' && isAdminOrPm}
                              onDragStart={event => {
                                if (kanbanBy !== 'status' || !isAdminOrPm) return;
                                setDraggedProject(proj);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', proj.id);
                              }}
                              onDragEnd={() => setDraggedProject(null)}
                              className={draggedProject?.id === proj.id ? 'kanban-dragging' : ''}
                            >
                              <Link href={`/dashboard/projects/${proj.id}`}>
                              <div className="kanban-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                  <span style={{ fontWeight: '700', color: 'var(--primary)', fontSize: '0.6875rem' }}>{proj.sdNumber}</span>
                                  <span className={`badge ${proj.priority === 'Alta' ? 'priority-alta' : proj.priority === 'Média' ? 'priority-media' : 'priority-baixa'}`}
                                    style={{ fontSize: '0.6rem' }}>{proj.priority}</span>
                                </div>
                                <div className="kanban-card-title">{proj.title}</div>
                                {noResources && <div className="kanban-resource-warning"><AlertTriangle size={11} /> Sem recursos alocados</div>}
                                <div className="kanban-card-meta" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.375rem', marginTop: '0.25rem' }}>
                                  <span>{isConcluido ? 'Conclusão:' : 'Previsão:'}</span>
                                  <span style={{ fontWeight: '600' }}>
                                    {isConcluido
                                      ? (proj.realCompletionDate ? formatDateOnlyPtBr(proj.realCompletionDate) : '—')
                                      : (proj.endDate ? formatDateOnlyPtBr(proj.endDate) : 'Sem data')
                                    }
                                  </span>
                                </div>
                              </div>
                              </Link>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* NEW/EDIT MODAL — Fixed height with tabs */}
      {dialogOpen && (
        <div className="modal-overlay" onClick={() => setDialogOpen(false)}>
          <div className="modal-content modal-content-xl" onClick={(e) => e.stopPropagation()} style={{ height: '80vh' }}>
            <div className="modal-header">
              <h3>{editingProject ? `Editar ${editingProject.sdNumber}` : 'Novo Projeto'}</h3>
              <button className="btn-icon" onClick={() => setDialogOpen(false)}>✕</button>
            </div>

            {/* Tabs */}
            <div className="tabs-container" style={{ padding: '0 1.5rem', marginBottom: 0 }}>
              {['Dados Gerais', 'Detalhes e Escopo', 'Classificação', 'Financeiro', 'Observações'].map((tab, i) => (
                <button key={i} className={`tab-button ${modalTab === i ? 'active' : ''}`} onClick={() => setModalTab(i)}>
                  {tab}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body">
                {/* Tab 0: Dados Gerais */}
                {modalTab === 0 && (
                  <div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Número SD *</label>
                        <input className="input" required disabled={!!editingProject} value={sdNumber} onChange={e => setSdNumber(e.target.value)} placeholder="Ex: 285283" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Título do Projeto *</label>
                        <input className="input" required value={title} onChange={e => setTitle(e.target.value)} placeholder="Nome descritivo" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Solicitante *</label>
                        <input className="input" required value={requester} onChange={e => setRequester(e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Data de Abertura *</label>
                        <input type="date" className="input" required value={openingDate} onChange={e => setOpeningDate(e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Prazo Solicitado</label>
                        <input type="date" className="input" value={requestedDeadline} onChange={e => setRequestedDeadline(e.target.value)} />
                      </div>
                      {editingProject && (
                        <div className="form-group">
                          <label className="form-label">Data Real de Conclusão</label>
                          <input type="date" className="input" value={realCompletionDateField} onChange={e => setRealCompletionDateField(e.target.value)} />
                        </div>
                      )}
                    </div>

                    {/* Departments & Systems */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                      <div className="form-group">
                        <label className="form-label">Departamentos *</label>
                        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.5rem', maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {departments.map(d => (
                            <label key={d.id} className="checkbox-wrapper" style={{ fontSize: '0.8125rem' }}>
                              <input type="checkbox" checked={selectedDepts.includes(d.id)} onChange={() => handleToggleDept(d.id)} />
                              <span>{d.name} ({d.code})</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Sistemas *</label>
                        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.5rem', maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {systems.map(s => (
                            <label key={s.id} className="checkbox-wrapper" style={{ fontSize: '0.8125rem' }}>
                              <input type="checkbox" checked={selectedSystems.includes(s.id)} onChange={() => handleToggleSystem(s.id)} />
                              <span>{s.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 1: Detalhes e Escopo */}
                {modalTab === 1 && (
                  <div>
                    <div className="form-group">
                      <label className="form-label">Problema a ser resolvido</label>
                      <textarea className="input" style={{ minHeight: '80px', resize: 'vertical' }} value={problemDescription} onChange={e => setProblemDescription(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Objetivo do Projeto</label>
                      <textarea className="input" style={{ minHeight: '80px', resize: 'vertical' }} value={objective} onChange={e => setObjective(e.target.value)} />
                    </div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Processo Atual</label>
                        <textarea className="input" style={{ minHeight: '70px', resize: 'vertical' }} value={currentProcess} onChange={e => setCurrentProcess(e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Processo Desejado</label>
                        <textarea className="input" style={{ minHeight: '70px', resize: 'vertical' }} value={desiredProcess} onChange={e => setDesiredProcess(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Classificação */}
                {modalTab === 2 && (
                  <div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Classificação *</label>
                        <select className="input" required value={classificationId} onChange={e => setClassificationId(e.target.value)}>
                          {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Tipo de Fluxo *</label>
                        <select className="input" required value={flowTypeId} onChange={e => setFlowTypeId(e.target.value)}>
                          {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Prioridade de Negócio *</label>
                        <select className="input" required value={businessPriorityId} onChange={e => setBusinessPriorityId(e.target.value)}>
                          {priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Classe (Horas) *</label>
                        <select className="input" required value={classId} onChange={e => setClassId(e.target.value)}>
                          {classes.map(cl => <option key={cl.id} value={cl.id}>{cl.name} ({cl.value}h)</option>)}
                        </select>
                      </div>
                    </div>

                    {editingProject && (
                      <div className="form-group" style={{ marginTop: '0.5rem' }}>
                        <label className="form-label">Status do Projeto</label>
                        <select className="input" value={status} onChange={e => setStatus(Number(e.target.value))} style={{ maxWidth: '300px' }}>
                          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{k}. {v}</option>)}
                        </select>
                      </div>
                    )}

                    <label className="checkbox-wrapper" style={{ marginTop: '1rem', fontSize: '0.8125rem' }}>
                      <input type="checkbox" checked={isLegalRequirement} onChange={e => setIsLegalRequirement(e.target.checked)} />
                      <span>Requisito Legal / Obrigatório</span>
                    </label>
                  </div>
                )}

                {/* Tab 3: Financeiro */}
                {modalTab === 3 && (
                  <div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Ganho Mensal Estimado (R$)</label>
                        <input type="number" className="input" min="0" value={estimatedMonthlyGain} onChange={e => setEstimatedMonthlyGain(Number(e.target.value))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Prejuízo Mensal Evitado (R$)</label>
                        <input type="number" className="input" min="0" value={estimatedMonthlyLossAvoided} onChange={e => setEstimatedMonthlyLossAvoided(Number(e.target.value))} />
                      </div>
                    </div>
                    <div className="alert alert-info" style={{ marginTop: '1rem' }}>
                      O ROI mensal é calculado automaticamente: Ganho + Prejuízo Evitado = <strong>R$ {(Number(estimatedMonthlyGain) + Number(estimatedMonthlyLossAvoided)).toLocaleString('pt-BR')}</strong>
                    </div>
                  </div>
                )}

                {/* Tab 4: Observações do gestor */}
                {modalTab === 4 && (
                  <div>
                    <div className="form-group">
                      <label className="form-label">Observações do Gestor de Projetos</label>
                      <textarea
                        className="input"
                        style={{ minHeight: '240px', resize: 'vertical' }}
                        value={projectManagerNotes}
                        onChange={event => setProjectManagerNotes(event.target.value)}
                        placeholder="Registre informações internas de acompanhamento, pontos de atenção, acordos e próximos passos."
                      />
                      <p className="text-xs text-muted mt-1">Campo livre para acompanhamento do gestor. Não interfere no motor de cronograma.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialogOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Salvando...' : 'Salvar Projeto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Complete Modal */}
      {completeModalOpen && completingProject && (
        <div className="modal-overlay" onClick={() => setCompleteModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3>Concluir Projeto</h3>
              <button className="btn-icon" onClick={() => setCompleteModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
                Informe a data real de conclusão do projeto <strong>{completingProject.sdNumber}</strong>.
              </p>
              <div className="form-group">
                <label className="form-label">Data Real de Conclusão *</label>
                <input type="date" className="input" required value={realCompletionDate} onChange={e => setRealCompletionDate(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setCompleteModalOpen(false)}>Cancelar</button>
              <button className="btn btn-accent btn-sm" onClick={submitComplete}>Confirmar Conclusão</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModalOpen && cancellingProject && (
        <div className="modal-overlay" onClick={() => setCancelModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3>Cancelar Projeto</h3>
              <button className="btn-icon" onClick={() => setCancelModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>O projeto <strong>{cancellingProject.sdNumber}</strong> será arquivado e sairá da fila de capacidade.</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setCancelModalOpen(false)}>Voltar</button>
              <button className="btn btn-danger btn-sm" onClick={submitCancel}>Confirmar Cancelamento</button>
            </div>
          </div>
        </div>
      )}

      <ImpactSimulationModal
        open={previewOpen}
        data={previewData}
        onClose={() => setPreviewOpen(false)}
        onConfirm={async () => { if (pendingConfirmAction) await pendingConfirmAction(); }}
        isConfirming={saveMutation.isPending || completeMutation.isPending || moveStatusMutation.isPending || cancelMutation.isPending}
        confirmLabel="Confirmar Mudança"
        context="Alteração no cadastro ou status de um projeto"
      />

      <ConfirmationModal
        open={!!projectToDelete}
        title="Excluir projeto permanentemente?"
        description="Esta ação não pode ser desfeita. O projeto, suas alocações, entregas, avaliações e dados relacionados serão removidos, e o cronograma será recalculado sem ele."
        detail={projectToDelete ? `${projectToDelete.sdNumber} · ${projectToDelete.title}` : undefined}
        confirmLabel="Excluir permanentemente"
        isPending={deleteProjectMutation.isPending}
        onClose={() => setProjectToDelete(null)}
        onConfirm={() => { if (projectToDelete) deleteProjectMutation.mutate(projectToDelete.id); }}
      />
    </div>
  );
}
