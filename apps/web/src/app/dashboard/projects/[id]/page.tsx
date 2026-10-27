'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { formatHistoryDescription } from '@/lib/history';
import { dateOnlyKey, formatDateOnlyPtBr, todayDateOnly } from '@/lib/date-only';
import {
  ArrowLeft, Calendar, User, Activity, Layers, ShieldAlert, ArrowUp, ArrowDown,
  Trash2, Plus, CheckCircle, Loader2, AlertTriangle, Clock, History, Award, MessageSquare, Building2, Eye, Edit2, Search
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ImpactSimulationModal } from '@/components/ImpactSimulationModal';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { PROJECT_STATUS_LABELS as STATUS_LABELS } from '@/lib/project-status';

interface CatalogItem { id: string; name: string; }
interface Department { id: string; code: string; name: string; }
interface Resource { id: string; name: string; status: string; }
interface Allocation { id: string; minutesAllocated: number; order: number; resource: Resource; }
interface Phase {
  id: string; phaseId: string; name: string; percentage: number; order: number;
  totalMinutes: number; executionMode: 'SIMULTANEOUS' | 'SEQUENTIAL'; allocations: Allocation[];
}
interface Project {
  id: string; sdNumber: string; title: string; requester: string; openingDate: string; requestedDeadline?: string;
  classification: CatalogItem; flowType: CatalogItem; businessPriority: CatalogItem; class: CatalogItem;
  totalHours: number; isLegalRequirement: boolean; status: number;
  problemDescription?: string; objective?: string; currentProcess?: string; desiredProcess?: string;
  estimatedMonthlyGain?: number; estimatedMonthlyLossAvoided?: number; roiMonthlyValue?: number;
  committeeDecision?: string; committeeScore?: number; boardNotes?: string; realCompletionDate?: string;
  projectManagerNotes?: string;
  departments: { department: Department }[]; systems: { system: CatalogItem }[]; phases: Phase[];
}

const normalizeResourceSearch = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('pt-BR');

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = params.id as string;

  const [activeTab, setActiveTab] = useState<'info' | 'phases' | 'planned-deliveries' | 'deliveries' | 'timeline'>('info');

  // Auth User
  const [user] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      return u ? JSON.parse(u) : null;
    }
    return null;
  });
  const isAdminOrPm = user?.role === 'ADMIN' || user?.role === 'PROJECT_MANAGER';
  const isDirector = user?.role === 'DIRECTOR' || user?.role === 'ADMIN' || user?.role === 'PROJECT_MANAGER';

  // Modal states
  const [allocatingPhase, setAllocatingPhase] = useState<Phase | null>(null);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [resourceSearch, setResourceSearch] = useState('');
  const [newDeliveryOpen, setNewDeliveryOpen] = useState(false);
  const [newDeliveryDept, setNewDeliveryDept] = useState('');
  const [newDeliveryDate, setNewDeliveryDate] = useState(() => todayDateOnly());
  const [newDeliveryNotes, setNewDeliveryNotes] = useState('');
  const [newDeliveryPlannedId, setNewDeliveryPlannedId] = useState('');
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null);
  const [feedbackDelivery, setFeedbackDelivery] = useState<any | null>(null);
  const [feedbackDate, setFeedbackDate] = useState(() => todayDateOnly());
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [deliveryToDelete, setDeliveryToDelete] = useState<any | null>(null);
  const [feedbackToDelete, setFeedbackToDelete] = useState<any | null>(null);
  const [plannedDeliveryOpen, setPlannedDeliveryOpen] = useState(false);
  const [editingPlannedDeliveryId, setEditingPlannedDeliveryId] = useState<string | null>(null);
  const [plannedDeliveryTitle, setPlannedDeliveryTitle] = useState('');
  const [plannedDeliveryDept, setPlannedDeliveryDept] = useState('');
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState(() => todayDateOnly());
  const [plannedDeliveryNotes, setPlannedDeliveryNotes] = useState('');
  const [plannedDeliveryToDelete, setPlannedDeliveryToDelete] = useState<any | null>(null);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  // Impact Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<(() => Promise<void>) | null>(null);

  // Queries
  const { data: project, isLoading: loadingProject } = useQuery<Project>({
    queryKey: ['projects', projectId],
    queryFn: () => apiRequest(`/projects/${projectId}`),
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ['resources'],
    queryFn: () => apiRequest('/resources'),
  });

  const { data: historyEvents = [] } = useQuery<any[]>({
    queryKey: ['project-history', projectId],
    queryFn: () => apiRequest(`/projects/${projectId}/history`),
    enabled: activeTab === 'timeline' || activeTab === 'info',
  });

  const { data: deliveries = [] } = useQuery<any[]>({
    queryKey: ['project-deliveries', projectId],
    queryFn: () => apiRequest(`/projects/${projectId}/deliveries`),
    enabled: activeTab === 'deliveries',
  });

  const { data: plannedDeliveries = [] } = useQuery<any[]>({
    queryKey: ['project-planned-deliveries', projectId],
    queryFn: () => apiRequest(`/projects/${projectId}/planned-deliveries`),
    enabled: activeTab === 'planned-deliveries' || activeTab === 'deliveries',
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => apiRequest('/departments'),
  });

  // Mutations
  const allocateMutation = useMutation({
    mutationFn: async ({ phaseId, resourceIds }: { phaseId: string; resourceIds: string[] }) =>
      apiRequest(`/projects/${projectId}/phases/${phaseId}/resources/confirm`, {
        method: 'PUT', body: JSON.stringify({ resourceIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      setAllocatingPhase(null);
      setPreviewOpen(false);
    },
  });

  const executionModeMutation = useMutation({
    mutationFn: async ({ phaseId, executionMode, resourceOrder }: { phaseId: string; executionMode: 'SIMULTANEOUS' | 'SEQUENTIAL'; resourceOrder?: string[] }) =>
      apiRequest(`/projects/${projectId}/phases/${phaseId}/execution-mode/confirm`, {
        method: 'PUT', body: JSON.stringify({ executionMode, resourceOrder }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      setPreviewOpen(false);
    },
  });

  const createDeliveryMutation = useMutation({
    mutationFn: async (payload: any) => apiRequest(`/projects/${projectId}/deliveries`, { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliveries', projectId] });
      setNewDeliveryOpen(false); setNewDeliveryNotes(''); setNewDeliveryDept(''); setNewDeliveryPlannedId('');
    },
  });

  const createFeedbackMutation = useMutation({
    mutationFn: async ({ delivery, payload }: { delivery: any; payload: any }) =>
      apiRequest(`/deliveries/${delivery.id}/feedback`, { method: delivery.feedback ? 'PATCH' : 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliveries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deliveries-all'] });
      setFeedbackDelivery(null); setFeedbackNotes('');
    },
  });

  const updateDeliveryMutation = useMutation({
    mutationFn: async ({ deliveryId, payload }: { deliveryId: string; payload: any }) =>
      apiRequest(`/deliveries/${deliveryId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliveries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deliveries-all'] });
      setEditingDeliveryId(null); setNewDeliveryNotes(''); setNewDeliveryDept(''); setNewDeliveryPlannedId('');
    },
  });

  const deleteDeliveryMutation = useMutation({
    mutationFn: async (deliveryId: string) => apiRequest(`/deliveries/${deliveryId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliveries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deliveries-all'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries-metrics'] });
      setDeliveryToDelete(null);
    },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir a entrega.'),
  });

  const deleteFeedbackMutation = useMutation({
    mutationFn: async (deliveryId: string) => apiRequest(`/deliveries/${deliveryId}/feedback`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deliveries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['deliveries-all'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries-pending'] });
      queryClient.invalidateQueries({ queryKey: ['deliveries-metrics'] });
      setFeedbackToDelete(null);
    },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir a devolutiva.'),
  });

  const createPlannedDeliveryMutation = useMutation({
    mutationFn: async (payload: any) => apiRequest(`/projects/${projectId}/planned-deliveries`, { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-planned-deliveries', projectId] });
      setPlannedDeliveryOpen(false); resetPlannedDeliveryForm();
    },
  });

  const updatePlannedDeliveryMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => apiRequest(`/planned-deliveries/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-planned-deliveries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-deliveries', projectId] });
      setPlannedDeliveryOpen(false); resetPlannedDeliveryForm();
    },
  });

  const deletePlannedDeliveryMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/planned-deliveries/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-planned-deliveries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-deliveries', projectId] });
      setPlannedDeliveryToDelete(null);
    },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir a entrega planejada.'),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => apiRequest(`/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-kanban'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      router.push('/dashboard/projects');
    },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir o projeto.'),
  });

  const resetPlannedDeliveryForm = () => {
    setEditingPlannedDeliveryId(null); setPlannedDeliveryTitle(''); setPlannedDeliveryDept('');
    setPlannedDeliveryDate(todayDateOnly()); setPlannedDeliveryNotes('');
  };

  const openPlannedDeliveryEdit = (planned: any) => {
    setEditingPlannedDeliveryId(planned.id); setPlannedDeliveryTitle(planned.title);
    setPlannedDeliveryDept(planned.recipientDeptId); setPlannedDeliveryDate(dateOnlyKey(planned.plannedDate));
    setPlannedDeliveryNotes(planned.notes || ''); setPlannedDeliveryOpen(true);
  };

  const openDeliveryEdit = (delivery: any) => {
    setEditingDeliveryId(delivery.id); setNewDeliveryDept(delivery.recipientDeptId);
    setNewDeliveryDate(dateOnlyKey(delivery.deliveryDate)); setNewDeliveryNotes(delivery.notes || '');
    setNewDeliveryPlannedId(delivery.plannedDeliveryId || '');
  };

  const openFeedback = (delivery: any) => {
    setFeedbackDelivery(delivery);
    setFeedbackDate(delivery.feedback?.feedbackDate ? dateOnlyKey(delivery.feedback.feedbackDate) : todayDateOnly());
    setFeedbackNotes(delivery.feedback?.notes || '');
  };

  if (loadingProject) {
    return (
      <div className="loading-center" style={{ minHeight: '60vh' }}>
        <Loader2 className="spinner" size={24} /> Carregando detalhes do projeto...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Projeto não encontrado</div>
        <Link href="/dashboard/projects" className="btn btn-secondary btn-sm" style={{ marginTop: '1rem' }}>
          Voltar para Projetos
        </Link>
      </div>
    );
  }

  const formatMins = (mins: number) => {
    const hours = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${hours}h` : `${hours}h ${m}m`;
  };

  const handleOpenAllocation = (phase: Phase) => {
    setAllocatingPhase(phase);
    setSelectedResourceIds(phase.allocations.map(a => a.resource.id));
    setResourceSearch('');
  };

  const handleCloseAllocation = () => {
    setAllocatingPhase(null);
    setResourceSearch('');
  };

  const handleToggleResource = (id: string) => {
    setSelectedResourceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSaveAllocations = async () => {
    if (!allocatingPhase) return;
    try {
      const preview = await apiRequest(`/projects/${projectId}/phases/${allocatingPhase.id}/resources/preview`, {
        method: 'PUT', body: JSON.stringify({ resourceIds: selectedResourceIds }),
      });
      setPreviewData(preview);
      setPendingConfirmAction(() => async () => {
        await allocateMutation.mutateAsync({ phaseId: allocatingPhase.id, resourceIds: selectedResourceIds });
      });
      setPreviewOpen(true);
    } catch (err: any) { alert(err.message || 'Erro ao alocar.'); }
  };

  const handleToggleExecutionMode = async (phase: Phase, newMode: 'SIMULTANEOUS' | 'SEQUENTIAL') => {
    if (!isAdminOrPm) return;
    const resourceOrder = phase.allocations.map(a => a.resource.id);
    try {
      const preview = await apiRequest(`/projects/${projectId}/phases/${phase.id}/execution-mode/preview`, {
        method: 'PUT', body: JSON.stringify({ executionMode: newMode, resourceOrder }),
      });
      setPreviewData(preview);
      setPendingConfirmAction(() => async () => {
        await executionModeMutation.mutateAsync({ phaseId: phase.id, executionMode: newMode, resourceOrder });
      });
      setPreviewOpen(true);
    } catch (err: any) { alert(err.message || 'Erro ao alterar modo.'); }
  };

  const handleMoveResource = async (phase: Phase, index: number, direction: 'UP' | 'DOWN') => {
    if (!isAdminOrPm) return;
    const currentOrder = [...phase.allocations].sort((a, b) => a.order - b.order);
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) return;
    const temp = currentOrder[index]; currentOrder[index] = currentOrder[targetIndex]; currentOrder[targetIndex] = temp;
    const resourceOrder = currentOrder.map(a => a.resource.id);
    try {
      const preview = await apiRequest(`/projects/${projectId}/phases/${phase.id}/execution-mode/preview`, {
        method: 'PUT', body: JSON.stringify({ executionMode: phase.executionMode, resourceOrder }),
      });
      setPreviewData(preview);
      setPendingConfirmAction(() => async () => {
        await executionModeMutation.mutateAsync({ phaseId: phase.id, executionMode: phase.executionMode, resourceOrder });
      });
      setPreviewOpen(true);
    } catch (err: any) { alert(err.message || 'Erro ao reordenar.'); }
  };

  const normalizedResourceSearch = normalizeResourceSearch(resourceSearch);
  const filteredActiveResources = resources.filter(resource =>
    resource.status === 'ACTIVE'
    && (!normalizedResourceSearch || normalizeResourceSearch(resource.name).includes(normalizedResourceSearch))
  );

  const isExecutingWithoutTAP = project.status === 5 && !project.committeeDecision;

  return (
    <div>
      {/* Header */}
      <div className="project-detail-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Link href="/dashboard/projects" className="btn btn-secondary btn-icon">
          <ArrowLeft size={16} />
        </Link>
        <div className="project-detail-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--primary)' }}>{project.sdNumber}</span>
            <h1 className="page-title" style={{ fontSize: '1.25rem' }}>{project.title}</h1>
            <span className={`status-badge status-${project.status}`}>
              {STATUS_LABELS[project.status] || 'Desconhecido'}
            </span>
          </div>
          <p className="page-subtitle">
            Solicitado por {project.requester} em {formatDateOnlyPtBr(project.openingDate)}
          </p>
        </div>
        {isAdminOrPm && (
          <button className="btn-icon" title="Excluir projeto permanentemente" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => setDeleteProjectOpen(true)}>
            <Trash2 size={17} />
          </button>
        )}
      </div>

      {/* Warning */}
      {isExecutingWithoutTAP && (
        <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>
          <ShieldAlert size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Atenção: Projeto Iniciado Sem Comitê!</strong>
            <p className="text-xs">Em execução (&quot;Processo de Software&quot;), mas sem parecer aprovado (Priorizado) no comitê diretivo.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs-container">
        <button className={`tab-button ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>
          <Activity size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Informações Gerais
        </button>
        <button className={`tab-button ${activeTab === 'phases' ? 'active' : ''}`} onClick={() => setActiveTab('phases')}>
          <Layers size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Fases e Alocações ({project.phases.length})
        </button>
        <button className={`tab-button ${activeTab === 'planned-deliveries' ? 'active' : ''}`} onClick={() => setActiveTab('planned-deliveries')}>
          <Calendar size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Entregas Planejadas
        </button>
        <button className={`tab-button ${activeTab === 'deliveries' ? 'active' : ''}`} onClick={() => setActiveTab('deliveries')}>
          <CheckCircle size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Entregas Realizadas
        </button>
        <button className={`tab-button ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveTab('timeline')}>
          <History size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
          Linha do Tempo / Histórico
        </button>
      </div>

      {/* TAB 1: INFO */}
      {activeTab === 'info' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Committee decision */}
            <div className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
              <div className="card-header">
                <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Award size={16} />
                  Avaliação do Comitê
                </h3>
                {project.committeeDecision && (
                  <span className={`badge ${project.committeeDecision === 'PRIORIZADO' ? 'badge-active' : 'badge-warning'}`}>
                    {project.committeeDecision}
                  </span>
                )}
              </div>
              {project.committeeDecision ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8125rem' }}>
                  <div><span className="text-muted">Decisão do Comitê:</span><p className="font-semibold">{project.committeeDecision}</p></div>
                  <div><span className="text-muted">Nota da Diretoria:</span><p className="font-semibold">{project.committeeScore ? `${project.committeeScore} / 10` : 'Sem nota'}</p></div>
                  {project.boardNotes && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span className="text-muted">Parecer da Diretoria:</span>
                      <p className="mt-1" style={{ fontStyle: 'italic', background: '#fafbfc', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>{project.boardNotes}</p>
                    </div>
                  )}
                </div>
              ) : <p className="text-xs text-muted">Este projeto ainda não possui avaliação ou decisão registrada pelo comitê.</p>}
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Descrição e Escopo</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.8125rem' }}>
                <div>
                  <span className="font-semibold text-muted">Problema a ser resolvido</span>
                  <p className="mt-1">{project.problemDescription || 'Nenhum detalhe informado.'}</p>
                </div>
                <div>
                  <span className="font-semibold text-muted">Objetivo do Projeto</span>
                  <p className="mt-1">{project.objective || 'Nenhum detalhe informado.'}</p>
                </div>
                {project.currentProcess && (
                  <div>
                    <span className="font-semibold text-muted">Processo Atual</span>
                    <p className="mt-1">{project.currentProcess}</p>
                  </div>
                )}
                {project.desiredProcess && (
                  <div>
                    <span className="font-semibold text-muted">Processo Desejado</span>
                    <p className="mt-1">{project.desiredProcess}</p>
                  </div>
                )}
                <div>
                  <span className="font-semibold text-muted">Observações do Gestor de Projetos</span>
                  <p className="mt-1" style={{ whiteSpace: 'pre-wrap' }}>{project.projectManagerNotes || 'Nenhuma observação de acompanhamento registrada.'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Info */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Metadados do Projeto</h3>
            </div>
            <div style={{ fontSize: '0.8125rem' }}>
              <div className="detail-row">
                <span className="detail-label">Carga Horária</span>
                <span className="detail-value font-semibold">{project.class.name} ({project.totalHours} horas)</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Classificação</span>
                <span className="detail-value">{project.classification.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Tipo de Fluxo</span>
                <span className="detail-value">{project.flowType.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Prioridade</span>
                <span className="detail-value font-semibold">{project.businessPriority.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Requisito Legal</span>
                <span className="detail-value">{project.isLegalRequirement ? 'Sim (Precedência)' : 'Não'}</span>
              </div>
              {isDirector && (
                <div className="detail-row">
                  <span className="detail-label">ROI Mensal</span>
                  <span className="detail-value font-semibold" style={{ color: 'var(--success)' }}>
                    R$ {(project.roiMonthlyValue || 0).toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
              {project.realCompletionDate && (
                <div className="detail-row">
                  <span className="detail-label">Concluído Em</span>
                  <span className="detail-value font-semibold" style={{ color: 'var(--success)' }}>
                    {formatDateOnlyPtBr(project.realCompletionDate)}
                  </span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Sistemas</span>
                <span className="detail-value">
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    {project.systems.map(s => <span key={s.system.id} className="badge badge-secondary" style={{ fontSize: '0.625rem' }}>{s.system.name}</span>)}
                  </div>
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Departamentos</span>
                <span className="detail-value">
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    {project.departments.map(d => <span key={d.department.id} className="badge badge-navy" style={{ fontSize: '0.625rem' }}>{d.department.code}</span>)}
                  </div>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PHASES & ALLOCATIONS */}
      {activeTab === 'phases' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Fases do Projeto e Alocações de Recursos</h3>
              <span className="text-xs text-muted">Alocação por fase e modo de execução</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {project.phases.map((phase) => {
                const isSeq = phase.executionMode === 'SEQUENTIAL';
                const sortedAlloc = [...phase.allocations].sort((a, b) => a.order - b.order);

                return (
                  <div key={phase.id} className="phase-allocation-card">
                    <div className="phase-allocation-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div className="phase-allocation-heading" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: '600', fontSize: '0.875rem' }}>
                          {phase.order}. {phase.name}
                        </span>
                        <span className="badge badge-info" style={{ fontSize: '0.6875rem' }}>
                          {phase.percentage}% ({formatMins(phase.totalMinutes)})
                        </span>
                      </div>

                      <div className="phase-allocation-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {isAdminOrPm && (
                          <div className="phase-execution-mode" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', background: '#f1f5f9', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-sm)' }}>
                            <span className="text-xs text-muted" style={{ marginRight: '0.25rem' }}>Modo:</span>
                            <button className={`btn btn-xs ${!isSeq ? 'btn-primary' : 'btn-ghost'}`}
                              onClick={() => handleToggleExecutionMode(phase, 'SIMULTANEOUS')}>
                              Simultâneo
                            </button>
                            <button className={`btn btn-xs ${isSeq ? 'btn-primary' : 'btn-ghost'}`}
                              onClick={() => handleToggleExecutionMode(phase, 'SEQUENTIAL')}>
                              Sequencial
                            </button>
                          </div>
                        )}
                        {isAdminOrPm && (
                          <button className="btn btn-secondary btn-xs" onClick={() => handleOpenAllocation(phase)}>
                            <User size={12} /> Alocar Recursos
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Resources in this phase */}
                    {sortedAlloc.length === 0 ? (
                      <p className="text-xs text-muted" style={{ fontStyle: 'italic' }}>Nenhum recurso alocado nesta fase.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.5rem' }}>
                        {sortedAlloc.map((alloc, idx) => (
                          <div key={alloc.id} className="phase-resource-row" style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0.375rem 0.625rem', background: '#fafbfc', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {isSeq && <span className="badge badge-navy" style={{ fontSize: '0.625rem' }}>#{idx + 1}</span>}
                              <span className="font-medium">{alloc.resource.name}</span>
                              <span className="text-xs text-muted">({formatMins(alloc.minutesAllocated)})</span>
                            </div>

                            {isSeq && isAdminOrPm && sortedAlloc.length > 1 && (
                              <div style={{ display: 'flex', gap: '0.125rem' }}>
                                <button className="btn-icon" disabled={idx === 0} onClick={() => handleMoveResource(phase, idx, 'UP')}>
                                  <ArrowUp size={13} />
                                </button>
                                <button className="btn-icon" disabled={idx === sortedAlloc.length - 1} onClick={() => handleMoveResource(phase, idx, 'DOWN')}>
                                  <ArrowDown size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PLANNED DELIVERIES */}
      {activeTab === 'planned-deliveries' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Entregas Planejadas</h3>
                <p className="text-xs text-muted mt-1">Compromissos parciais previstos para este projeto. Não interferem no motor de cronograma.</p>
              </div>
              {isAdminOrPm && (
                <button className="btn btn-accent btn-xs" onClick={() => { resetPlannedDeliveryForm(); setPlannedDeliveryOpen(true); }}>
                  <Plus size={13} /> Planejar Entrega
                </button>
              )}
            </div>
            {plannedDeliveries.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                <div className="empty-state-icon"><Calendar size={20} /></div>
                <div className="empty-state-title">Nenhuma entrega planejada</div>
                <p className="text-xs text-muted">Cadastre apenas os compromissos parciais que precisam ser acompanhados.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: '.8rem' }}>
                {plannedDeliveries.map((planned: any) => {
                  const realized = planned.delivery;
                  const onTime = realized && dateOnlyKey(realized.deliveryDate) <= dateOnlyKey(planned.plannedDate);
                  return (
                    <div key={planned.id} className="planned-delivery-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.6rem' }}>
                        <div>
                          <strong style={{ color: 'var(--primary)' }}>{planned.title}</strong>
                          <p className="text-xs text-muted mt-1">{planned.recipientDept?.name} ({planned.recipientDept?.code})</p>
                        </div>
                        <span className={`badge ${realized ? (onTime ? 'badge-active' : 'badge-inactive') : 'badge-warning'}`}>
                          {realized ? (onTime ? 'Realizada no prazo' : 'Realizada com atraso') : 'Pendente'}
                        </span>
                      </div>
                      <div className="planned-delivery-dates">
                        <div><span>Data planejada</span><strong>{formatDateOnlyPtBr(planned.plannedDate)}</strong></div>
                        <div><span>Data realizada</span><strong>{realized ? formatDateOnlyPtBr(realized.deliveryDate) : '—'}</strong></div>
                      </div>
                      {planned.notes && <p className="text-xs mt-1" style={{ whiteSpace: 'pre-wrap' }}>{planned.notes}</p>}
                      {isAdminOrPm && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.4rem', marginTop: '.75rem' }}>
                          <button className="btn btn-secondary btn-xs" onClick={() => openPlannedDeliveryEdit(planned)}><Edit2 size={12} /> Editar</button>
                          <button className="btn-icon" title="Excluir entrega planejada" style={{ color: 'var(--danger)' }} onClick={() => setPlannedDeliveryToDelete(planned)}><Trash2 size={14} /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: DELIVERIES */}
      {activeTab === 'deliveries' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Entregas Realizadas</h3>
                <p className="text-xs text-muted mt-1">Registros efetivamente entregues e suas devolutivas.</p>
              </div>
              {isAdminOrPm && (
                <button className="btn btn-accent btn-xs" onClick={() => { setEditingDeliveryId(null); setNewDeliveryDept(''); setNewDeliveryDate(todayDateOnly()); setNewDeliveryNotes(''); setNewDeliveryPlannedId(''); setNewDeliveryOpen(true); }}>
                  <Plus size={13} /> Registrar Entrega
                </button>
              )}
            </div>

            {deliveries.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                <div className="empty-state-icon"><CheckCircle size={20} /></div>
                <div className="empty-state-title">Nenhuma entrega registrada</div>
                <p className="text-xs text-muted">Registre entregas do projeto para coletar devolutivas dos departamentos.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {deliveries.map((del: any) => {
                  const hasFeedback = !!del.feedback;
                  const planned = del.plannedDelivery;
                  const deliveredOnTime = planned ? dateOnlyKey(del.deliveryDate) <= dateOnlyKey(planned.plannedDate) : null;
                  return (
                    <div key={del.id} style={{
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1rem',
                      background: hasFeedback ? 'var(--success-light)' : '#ffffff'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Building2 size={15} style={{ color: 'var(--primary)' }} />
                            <span className="font-semibold" style={{ fontSize: '0.875rem' }}>{del.recipientDept?.name} ({del.recipientDept?.code})</span>
                            <span className={`badge ${hasFeedback ? 'badge-active' : 'badge-warning'}`}>
                              {hasFeedback ? 'Devolutiva Recebida' : 'Aguardando Devolutiva'}
                            </span>
                            {planned && <span className={`badge ${deliveredOnTime ? 'badge-active' : 'badge-inactive'}`}>{deliveredOnTime ? 'No prazo planejado' : 'Após a data planejada'}</span>}
                          </div>
                          <p className="text-xs text-muted mt-1">
                            Entregue em: {formatDateOnlyPtBr(del.deliveryDate)}
                            {del.notes && ` — "${del.notes}"`}
                          </p>
                          {planned && <p className="text-xs mt-1" style={{ color: deliveredOnTime ? 'var(--success)' : 'var(--danger)' }}>Referente a “{planned.title}” · planejada para {formatDateOnlyPtBr(planned.plannedDate)}</p>}
                        </div>

                        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {isAdminOrPm && <button className="btn btn-secondary btn-xs" onClick={() => openDeliveryEdit(del)}><Edit2 size={12} /> Editar entrega</button>}
                          <button className={`btn ${hasFeedback ? 'btn-secondary' : 'btn-primary'} btn-xs`} onClick={() => openFeedback(del)}>
                            <MessageSquare size={12} /> {hasFeedback ? 'Editar devolutiva' : 'Registrar devolutiva'}
                          </button>
                          {hasFeedback && <button className="btn btn-secondary btn-xs" style={{ color: 'var(--danger)' }} onClick={() => setFeedbackToDelete(del)}><Trash2 size={12} /> Excluir devolutiva</button>}
                          {isAdminOrPm && <button className="btn btn-secondary btn-xs" style={{ color: 'var(--danger)' }} onClick={() => setDeliveryToDelete(del)}><Trash2 size={12} /> Excluir entrega</button>}
                        </div>
                      </div>

                      {hasFeedback && (
                        <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--success-border)', fontSize: '0.8125rem' }}>
                          <span className="font-semibold" style={{ color: '#065f46' }}>Devolutiva registrada em {formatDateOnlyPtBr(del.feedback.feedbackDate)}:</span>
                          <p className="text-xs mt-1" style={{ color: '#065f46' }}>{del.feedback.notes || 'Sem observações.'}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: TIMELINE / HISTÓRICO */}
      {activeTab === 'timeline' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <History size={16} />
              Linha do Tempo de Alterações
            </h3>
          </div>

          {historyEvents.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <div className="empty-state-title">Nenhuma alteração gravada no histórico</div>
            </div>
          ) : (
            <div className="timeline">
              {historyEvents.map((evt: any) => (
                <div key={evt.id} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="timeline-date">
                    {new Date(evt.createdAt).toLocaleDateString('pt-BR', {
                      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </div>
                  <div className="timeline-title">{evt.displayLabel || evt.eventType.replace(/_/g, ' ')}</div>
                  <div className="timeline-desc">{formatHistoryDescription(evt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resource Allocation Modal */}
      {allocatingPhase && (
        <div className="modal-overlay" onClick={handleCloseAllocation}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Alocar Recursos — {allocatingPhase.name}</h3>
              <button className="btn-icon" onClick={handleCloseAllocation}>✕</button>
            </div>
            <div className="modal-body">
              <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                <span className="input-icon"><Search size={15} /></span>
                <input
                  className="input"
                  type="search"
                  autoFocus
                  value={resourceSearch}
                  onChange={event => setResourceSearch(event.target.value)}
                  placeholder="Pesquisar recurso por nome..."
                  aria-label="Pesquisar recursos disponíveis"
                />
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.5rem', maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {filteredActiveResources.map(r => (
                  <label key={r.id} className="checkbox-wrapper" style={{ fontSize: '0.8125rem' }}>
                    <input type="checkbox" checked={selectedResourceIds.includes(r.id)} onChange={() => handleToggleResource(r.id)} />
                    <span>{r.name}</span>
                  </label>
                ))}
                {filteredActiveResources.length === 0 && (
                  <div className="text-xs text-muted" style={{ padding: '0.75rem', textAlign: 'center' }}>
                    Nenhum recurso ativo encontrado para esta pesquisa.
                  </div>
                )}
              </div>
              <div className="text-xs text-muted" style={{ marginTop: '0.625rem' }}>
                {selectedResourceIds.length} recurso{selectedResourceIds.length === 1 ? '' : 's'} selecionado{selectedResourceIds.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={handleCloseAllocation}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveAllocations} disabled={allocateMutation.isPending}>
                Salvar Alocação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Planned Delivery Modal */}
      {plannedDeliveryOpen && (
        <div className="modal-overlay" onClick={() => { setPlannedDeliveryOpen(false); resetPlannedDeliveryForm(); }}>
          <div className="modal-content" onClick={event => event.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>{editingPlannedDeliveryId ? 'Editar Entrega Planejada' : 'Planejar Nova Entrega'}</h3>
              <button className="btn-icon" onClick={() => { setPlannedDeliveryOpen(false); resetPlannedDeliveryForm(); }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Título da Entrega *</label>
                <input className="input" value={plannedDeliveryTitle} onChange={event => setPlannedDeliveryTitle(event.target.value)} placeholder="Ex.: Protótipo para validação" />
              </div>
              <div className="form-group">
                <label className="form-label">Departamento Destino *</label>
                <select className="input" value={plannedDeliveryDept} onChange={event => setPlannedDeliveryDept(event.target.value)}>
                  <option value="">Selecione...</option>
                  {departments.map(department => <option key={department.id} value={department.id}>{department.name} ({department.code})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Data Planejada *</label>
                <input type="date" className="input" value={plannedDeliveryDate} onChange={event => setPlannedDeliveryDate(event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Observações</label>
                <textarea className="input" style={{ minHeight: '90px' }} value={plannedDeliveryNotes} onChange={event => setPlannedDeliveryNotes(event.target.value)} placeholder="Detalhes do compromisso, escopo parcial ou critérios esperados." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => { setPlannedDeliveryOpen(false); resetPlannedDeliveryForm(); }}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={!plannedDeliveryTitle.trim() || !plannedDeliveryDept || !plannedDeliveryDate || createPlannedDeliveryMutation.isPending || updatePlannedDeliveryMutation.isPending}
                onClick={() => {
                  const payload = { title: plannedDeliveryTitle.trim(), recipientDeptId: plannedDeliveryDept, plannedDate: plannedDeliveryDate, notes: plannedDeliveryNotes };
                  const request = editingPlannedDeliveryId
                    ? updatePlannedDeliveryMutation.mutateAsync({ id: editingPlannedDeliveryId, payload })
                    : createPlannedDeliveryMutation.mutateAsync(payload);
                  request.catch((error: any) => alert(error.message || 'Não foi possível salvar a entrega planejada.'));
                }}>
                {editingPlannedDeliveryId ? 'Salvar Alterações' : 'Salvar Planejamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Delivery Modal */}
      {(newDeliveryOpen || editingDeliveryId) && (
        <div className="modal-overlay" onClick={() => { setNewDeliveryOpen(false); setEditingDeliveryId(null); setNewDeliveryPlannedId(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>{editingDeliveryId ? 'Editar Entrega' : 'Registrar Nova Entrega'}</h3>
              <button className="btn-icon" onClick={() => { setNewDeliveryOpen(false); setEditingDeliveryId(null); setNewDeliveryPlannedId(''); }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Entrega Planejada de Referência</label>
                <select className="input" value={newDeliveryPlannedId} onChange={event => {
                  const plannedId = event.target.value; setNewDeliveryPlannedId(plannedId);
                  const planned = plannedDeliveries.find((item: any) => item.id === plannedId);
                  if (planned && !newDeliveryDept) setNewDeliveryDept(planned.recipientDeptId);
                }}>
                  <option value="">Sem vínculo com entrega planejada</option>
                  {plannedDeliveries.filter((item: any) => !item.delivery || item.delivery.id === editingDeliveryId).map((item: any) => (
                    <option key={item.id} value={item.id}>{item.title} · {formatDateOnlyPtBr(item.plannedDate)} · {item.recipientDept?.code}</option>
                  ))}
                </select>
                <p className="text-xs text-muted mt-1">Opcional. O vínculo permite comparar automaticamente a data planejada com a data realizada.</p>
              </div>
              <div className="form-group">
                <label className="form-label">Departamento Destino *</label>
                <select className="input" required value={newDeliveryDept} onChange={e => setNewDeliveryDept(e.target.value)}>
                  <option value="">Selecione...</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Data da Entrega *</label>
                <input type="date" className="input" required value={newDeliveryDate}
                  max={editingDeliveryId && deliveries.find((item: any) => item.id === editingDeliveryId)?.feedback?.feedbackDate ? dateOnlyKey(deliveries.find((item: any) => item.id === editingDeliveryId).feedback.feedbackDate) : undefined}
                  onChange={e => setNewDeliveryDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Observações</label>
                <textarea className="input" style={{ minHeight: '60px' }} value={newDeliveryNotes} onChange={e => setNewDeliveryNotes(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => { setNewDeliveryOpen(false); setEditingDeliveryId(null); setNewDeliveryPlannedId(''); }}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={!newDeliveryDept || createDeliveryMutation.isPending || updateDeliveryMutation.isPending}
                onClick={() => editingDeliveryId
                  ? updateDeliveryMutation.mutateAsync({ deliveryId: editingDeliveryId, payload: { recipientDeptId: newDeliveryDept, deliveryDate: newDeliveryDate, notes: newDeliveryNotes, plannedDeliveryId: newDeliveryPlannedId } }).catch((error: any) => alert(error.message || 'Não foi possível atualizar a entrega.'))
                  : createDeliveryMutation.mutateAsync({ recipientDeptId: newDeliveryDept, deliveryDate: newDeliveryDate, notes: newDeliveryNotes, plannedDeliveryId: newDeliveryPlannedId || undefined }).catch((error: any) => alert(error.message || 'Não foi possível registrar a entrega.'))}>
                {editingDeliveryId ? 'Salvar Alterações' : 'Registrar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {feedbackDelivery && (
        <div className="modal-overlay" onClick={() => setFeedbackDelivery(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>{feedbackDelivery.feedback ? 'Editar Devolutiva' : 'Registrar Devolutiva'}</h3>
              <button className="btn-icon" onClick={() => setFeedbackDelivery(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Data da Devolutiva *</label>
                <input type="date" className="input" required min={dateOnlyKey(feedbackDelivery.deliveryDate)} value={feedbackDate} onChange={e => setFeedbackDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Parecer do Departamento</label>
                <textarea className="input" style={{ minHeight: '80px' }} value={feedbackNotes} onChange={e => setFeedbackNotes(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setFeedbackDelivery(null)}>Cancelar</button>
              <button className="btn btn-accent btn-sm" disabled={createFeedbackMutation.isPending}
                onClick={() => createFeedbackMutation.mutateAsync({ delivery: feedbackDelivery, payload: { feedbackDate, notes: feedbackNotes } }).catch((error: any) => alert(error.message || 'Não foi possível salvar a devolutiva.'))}>
                {feedbackDelivery.feedback ? 'Salvar Alterações' : 'Salvar Devolutiva'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        open={deleteProjectOpen}
        title="Excluir projeto permanentemente?"
        description="Esta ação não pode ser desfeita. Todas as alocações, entregas, planejamentos e avaliações vinculadas serão removidos, e o cronograma será recalculado sem este projeto."
        detail={`${project.sdNumber} · ${project.title}`}
        confirmLabel="Excluir permanentemente"
        isPending={deleteProjectMutation.isPending}
        onClose={() => setDeleteProjectOpen(false)}
        onConfirm={() => deleteProjectMutation.mutate()}
      />

      <ConfirmationModal
        open={!!plannedDeliveryToDelete}
        title="Excluir entrega planejada?"
        description={plannedDeliveryToDelete?.delivery ? 'A entrega realizada será mantida, mas perderá o vínculo com este planejamento.' : 'O planejamento será removido deste projeto.'}
        detail={plannedDeliveryToDelete ? `${plannedDeliveryToDelete.title} · ${formatDateOnlyPtBr(plannedDeliveryToDelete.plannedDate)}` : undefined}
        confirmLabel="Excluir planejamento"
        isPending={deletePlannedDeliveryMutation.isPending}
        onClose={() => setPlannedDeliveryToDelete(null)}
        onConfirm={() => { if (plannedDeliveryToDelete) deletePlannedDeliveryMutation.mutate(plannedDeliveryToDelete.id); }}
      />

      <ConfirmationModal
        open={!!feedbackToDelete}
        title="Excluir devolutiva?"
        description="A devolutiva será removida e esta entrega voltará a ficar pendente."
        detail={feedbackToDelete ? `${feedbackToDelete.recipientDept?.code} · devolutiva de ${formatDateOnlyPtBr(feedbackToDelete.feedback.feedbackDate)}` : undefined}
        confirmLabel="Excluir devolutiva"
        isPending={deleteFeedbackMutation.isPending}
        onClose={() => setFeedbackToDelete(null)}
        onConfirm={() => { if (feedbackToDelete) deleteFeedbackMutation.mutate(feedbackToDelete.id); }}
      />

      <ConfirmationModal
        open={!!deliveryToDelete}
        title="Excluir entrega?"
        description={deliveryToDelete?.feedback ? 'A entrega e a devolutiva vinculada serão removidas juntas.' : 'A entrega será removida deste projeto.'}
        detail={deliveryToDelete ? `${deliveryToDelete.recipientDept?.code} · entrega de ${formatDateOnlyPtBr(deliveryToDelete.deliveryDate)}` : undefined}
        confirmLabel={deliveryToDelete?.feedback ? 'Excluir entrega e devolutiva' : 'Excluir entrega'}
        isPending={deleteDeliveryMutation.isPending}
        onClose={() => setDeliveryToDelete(null)}
        onConfirm={() => { if (deliveryToDelete) deleteDeliveryMutation.mutate(deliveryToDelete.id); }}
      />

      <ImpactSimulationModal
        open={previewOpen}
        data={previewData}
        onClose={() => setPreviewOpen(false)}
        onConfirm={async () => { if (pendingConfirmAction) await pendingConfirmAction(); }}
        confirmLabel="Confirmar Alocação"
        context="Alteração na alocação de recursos ou no modo de execução de uma fase"
        isConfirming={allocateMutation.isPending || executionModeMutation.isPending}
      />
    </div>
  );
}
