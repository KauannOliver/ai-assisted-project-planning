'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { dateOnlyKey, formatDateOnlyPtBr, todayDateOnly } from '@/lib/date-only';
import {
  Users, Plus, Calendar, FileText, ArrowLeftRight, TrendingUp, AlertTriangle, CheckCircle, Loader2, ChevronRight, Search, CheckSquare, Square, MessageSquare, Award, ArrowLeft, Edit2, Trash2, BarChart3, ChevronLeft
} from 'lucide-react';
import { ImpactSimulationModal } from '@/components/ImpactSimulationModal';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { PROJECT_STATUS_LABELS as STATUS_LABELS } from '@/lib/project-status';

interface Project {
  id: string; sdNumber: string; title: string; requester: string; status: number;
  committeeDecision?: string; committeeScore?: number;
  estimatedMonthlyGain?: number; estimatedMonthlyLossAvoided?: number;
}
interface Meeting {
  id: string; meetingDate: string; notes?: string;
  createdBy: { name: string; email: string }; _count: { evaluations: number };
}
interface MeetingDetails extends Meeting {
  evaluations: {
    id: string; decision: string; score?: number; notes?: string;
    estimatedMonthlyGain?: number; estimatedMonthlyLossAvoided?: number; roiMonthly?: number;
    project: { id: string; sdNumber: string; title: string; status: number };
    situationAtMeeting?: { status?: number; decision?: string; score?: number };
    situationToday?: { status?: number; decision?: string; score?: number };
  }[];
}

const formatMeetingDate = (value: string) => formatDateOnlyPtBr(value);

export default function CommitteePage() {
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

  const [activeTab, setActiveTab] = useState<'meetings' | 'compare'>('meetings');
  const [meetingsPage, setMeetingsPage] = useState(1);
  const [meetingsPageSize, setMeetingsPageSize] = useState(15);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);

  // New Meeting Form
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [editingMeetingData, setEditingMeetingData] = useState<MeetingDetails | null>(null);
  const [meetingDate, setMeetingDate] = useState(() => todayDateOnly());
  const [meetingNotes, setMeetingNotes] = useState('');
  const [searchProjectTerm, setSearchProjectTerm] = useState('');

  // Selected projects in new meeting: Map of projId -> checked (boolean)
  const [selectedProjects, setSelectedProjects] = useState<Record<string, boolean>>({});

  // Local decisions for projects
  const [localDecisions, setLocalDecisions] = useState<Record<string, {
    decision: 'PRIORIZADO' | 'SEGUNDA_FASE' | 'CANCELADO' | 'NAO_AVALIADO';
    score?: number; notes?: string;
    estimatedMonthlyGain: number; estimatedMonthlyLossAvoided: number;
    expandExtra?: boolean;
  }>>({});

  // Compare Tab State
  const [compareMeetingId1, setCompareMeetingId1] = useState('');
  const [compareMeetingId2, setCompareMeetingId2] = useState('current');
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [impactPage, setImpactPage] = useState(1);
  const [impactPageSize, setImpactPageSize] = useState(10);

  // Impact Preview State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<(() => Promise<void>) | null>(null);

  // Queries
  const { data: meetings = [], isLoading: loadingMeetings } = useQuery<Meeting[]>({
    queryKey: ['committee-meetings'], queryFn: () => apiRequest('/committee/meetings'),
  });
  const meetingsTotalPages = Math.max(1, Math.ceil(meetings.length / meetingsPageSize));
  const currentMeetingsPage = Math.min(meetingsPage, meetingsTotalPages);
  const paginatedMeetings = useMemo(
    () => meetings.slice((currentMeetingsPage - 1) * meetingsPageSize, currentMeetingsPage * meetingsPageSize),
    [meetings, currentMeetingsPage, meetingsPageSize],
  );

  const { data: eligibleProjects = [] } = useQuery<Project[]>({
    queryKey: ['committee-eligible', editingMeetingId],
    queryFn: () => apiRequest(`/committee/eligible-projects${editingMeetingId ? `?meetingId=${editingMeetingId}` : ''}`),
    enabled: newMeetingOpen,
  });

  const { data: meetingDetails } = useQuery<MeetingDetails>({
    queryKey: ['committee-meetings', selectedMeetingId],
    queryFn: () => apiRequest(`/committee/meetings/${selectedMeetingId}`),
    enabled: !!selectedMeetingId,
  });

  // Mutations
  const createMeetingMutation = useMutation({
    mutationFn: async (payload: any) => apiRequest('/committee/meetings/confirm', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['committee-meetings'] });
      setNewMeetingOpen(false); setPreviewOpen(false); setMeetingNotes('');
    },
  });

  const updateMeetingMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) =>
      apiRequest(`/committee/meetings/${id}/confirm`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['committee-meetings'] });
      setNewMeetingOpen(false); setPreviewOpen(false); setEditingMeetingId(null); setEditingMeetingData(null);
      if (data?.meetingId) setSelectedMeetingId(data.meetingId);
    },
  });

  const deleteMeetingMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/committee/meetings/${id}`, { method: 'DELETE' }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['committee-meetings'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['official-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedMeetingId(null);
      setMeetingToDelete(null);
      if (result?.estimatedProjects > 0) {
        alert(`${result.estimatedProjects} projeto(s) antigo(s) foram restaurados com base na melhor reconstrução histórica disponível.`);
      }
    },
    onError: (error: any) => alert(error.message || 'Não foi possível excluir a reunião.'),
  });

  useEffect(() => {
    if (!newMeetingOpen || eligibleProjects.length === 0) return;
    const initialDecisions: typeof localDecisions = {};
    const initialSelected: typeof selectedProjects = {};
    for (const project of eligibleProjects) {
      const validDecision = ['PRIORIZADO', 'SEGUNDA_FASE', 'CANCELADO'].includes(project.committeeDecision || '')
        ? project.committeeDecision as any
        : 'PRIORIZADO';
      initialDecisions[project.id] = {
        decision: validDecision,
        score: project.committeeScore ?? 8,
        notes: '',
        estimatedMonthlyGain: project.estimatedMonthlyGain || 0,
        estimatedMonthlyLossAvoided: project.estimatedMonthlyLossAvoided || 0,
        expandExtra: false,
      };
      initialSelected[project.id] = false;
    }
    if (editingMeetingId && editingMeetingData) {
      for (const evaluation of editingMeetingData.evaluations) {
        initialSelected[evaluation.project.id] = true;
        initialDecisions[evaluation.project.id] = {
          decision: evaluation.decision as any,
          score: evaluation.score,
          notes: evaluation.notes || '',
          estimatedMonthlyGain: evaluation.estimatedMonthlyGain || 0,
          estimatedMonthlyLossAvoided: evaluation.estimatedMonthlyLossAvoided || 0,
          expandExtra: false,
        };
      }
    }
    setLocalDecisions(initialDecisions);
    setSelectedProjects(initialSelected);
  }, [newMeetingOpen, eligibleProjects, editingMeetingId, editingMeetingData]);

  // Toggle project selection checkbox
  const handleToggleProject = (id: string) => {
    setSelectedProjects(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Filtered projects inside modal
  const filteredEligible = useMemo(() => {
    return eligibleProjects.filter(p =>
      p.sdNumber.toLowerCase().includes(searchProjectTerm.toLowerCase()) ||
      p.title.toLowerCase().includes(searchProjectTerm.toLowerCase())
    );
  }, [eligibleProjects, searchProjectTerm]);

  // Update decision values
  const updateLocalDecision = (projId: string, field: string, val: any) => {
    setLocalDecisions(prev => ({
      ...prev,
      [projId]: { ...prev[projId], [field]: val },
    }));
  };

  const openCreateMeeting = () => {
    setEditingMeetingId(null);
    setEditingMeetingData(null);
    setMeetingDate(todayDateOnly());
    setMeetingNotes('');
    setSearchProjectTerm('');
    setNewMeetingOpen(true);
  };

  const openEditMeeting = (details: MeetingDetails) => {
    setEditingMeetingId(details.id);
    setEditingMeetingData(details);
    setMeetingDate(dateOnlyKey(details.meetingDate));
    setMeetingNotes(details.notes || '');
    setSearchProjectTerm('');
    setNewMeetingOpen(true);
  };

  const openEditMeetingById = async (id: string) => {
    try {
      const details = await apiRequest(`/committee/meetings/${id}`);
      openEditMeeting(details);
    } catch (err: any) {
      alert(err.message || 'Não foi possível carregar a reunião para edição.');
    }
  };

  const handleDeleteMeeting = (id: string) => {
    setMeetingToDelete(id);
  };

  const handleSaveMeeting = async (e: React.FormEvent) => {
    e.preventDefault();

    // Only evaluations for CHECKED projects
    const checkedIds = Object.keys(selectedProjects).filter(id => selectedProjects[id]);

    if (checkedIds.length === 0) {
      alert('Selecione ao menos um projeto avaliado nesta reunião.');
      return;
    }

    const evaluations = checkedIds.map(projId => ({
      projectId: projId,
      decision: localDecisions[projId]?.decision || 'PRIORIZADO',
      score: localDecisions[projId]?.score !== undefined ? Number(localDecisions[projId].score) : undefined,
      notes: localDecisions[projId]?.notes || undefined,
      estimatedMonthlyGain: Number(localDecisions[projId]?.estimatedMonthlyGain || 0),
      estimatedMonthlyLossAvoided: Number(localDecisions[projId]?.estimatedMonthlyLossAvoided || 0),
    }));

    const payload = { meetingDate, notes: meetingNotes || undefined, evaluations };

    try {
      const currentHashData = await apiRequest('/priority-queue');
      const stateHash = currentHashData.stateHash;

      const preview = await apiRequest(
        editingMeetingId ? `/committee/meetings/${editingMeetingId}/preview` : '/committee/meetings/preview',
        { method: editingMeetingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );

      const confirmMeeting = async () => {
        if (editingMeetingId) {
          await updateMeetingMutation.mutateAsync({ id: editingMeetingId, payload: { ...payload, stateHash } });
        } else {
          await createMeetingMutation.mutateAsync({ ...payload, stateHash });
        }
      };

      setPreviewData(preview);
      setPendingConfirmAction(() => confirmMeeting);
      setPreviewOpen(true);
    } catch (err: any) { alert(err.message || 'Erro ao simular reunião.'); }
  };

  const handleCompare = async () => {
    if (!compareMeetingId1) { alert('Selecione a reunião base.'); return; }
    setLoadingCompare(true);
    try {
      const data = await apiRequest(`/committee/compare?id1=${compareMeetingId1}&id2=${compareMeetingId2}`);
      setComparisonResult(data);
      setImpactPage(1);
    } catch (err: any) { alert(err.message || 'Erro na comparação.'); }
    finally { setLoadingCompare(false); }
  };

  const getDecisionBadge = (dec: string) => {
    switch (dec) {
      case 'PRIORIZADO': return <span className="badge badge-active">PRIORIZADO</span>;
      case 'SEGUNDA_FASE': return <span className="badge badge-warning">2ª FASE</span>;
      case 'CANCELADO': return <span className="badge badge-inactive">CANCELADO</span>;
      default: return <span className="badge badge-navy">NÃO AVALIADO</span>;
    }
  };

  const impactDetails = comparisonResult?.details || [];
  const totalImpactPages = Math.max(1, Math.ceil(impactDetails.length / impactPageSize));
  const paginatedImpactDetails = impactDetails.slice((impactPage - 1) * impactPageSize, impactPage * impactPageSize);
  const priorityDistribution = comparisonResult?.metrics?.priorityScoreDistribution || [];
  const priorityDistributionMax = Math.max(1, ...priorityDistribution.map((item: any) => Math.max(item.completed || 0, item.homologation || 0)));

  return (
    <div className="committee-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Comitê e Governança</h1>
          <p className="page-subtitle">Acompanhe deliberações de diretoria e atas de reunião</p>
        </div>
        {isAdminOrPm && activeTab === 'meetings' && !selectedMeetingId && (
          <div className="page-actions">
            <button onClick={openCreateMeeting} className="btn btn-accent btn-sm">
              <Plus size={14} /> Nova Reunião de Comitê
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      {!selectedMeetingId && (
        <div className="tabs-container">
          <button className={`tab-button ${activeTab === 'meetings' ? 'active' : ''}`} onClick={() => setActiveTab('meetings')}>
            <FileText size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
            Atas de Reunião ({meetings.length})
          </button>
          <button className={`tab-button ${activeTab === 'compare' ? 'active' : ''}`} onClick={() => setActiveTab('compare')}>
            <ArrowLeftRight size={15} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />
            Comparativo de Evolução
          </button>
        </div>
      )}

      {/* Selected Meeting Minutes Details */}
      {selectedMeetingId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={() => setSelectedMeetingId(null)} className="btn btn-secondary btn-icon">
              <ArrowLeft size={16} />
            </button>
            <div>
              <h2 className="page-title" style={{ fontSize: '1.25rem' }}>
                Ata de Reunião — {meetingDetails ? formatMeetingDate(meetingDetails.meetingDate) : ''}
              </h2>
              {meetingDetails && (
                <p className="page-subtitle">
                  Registrado por {meetingDetails.createdBy.name} ({meetingDetails.createdBy.email})
                </p>
              )}
            </div>
            {isAdminOrPm && meetingDetails && (
              <div className="page-actions" style={{ marginLeft: 'auto' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openEditMeeting(meetingDetails)}>
                  <Edit2 size={14} /> Editar Reunião
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDeleteMeeting(meetingDetails.id)} disabled={deleteMeetingMutation.isPending}>
                  <Trash2 size={14} /> Excluir
                </button>
              </div>
            )}
          </div>

          {meetingDetails ? (
            <div className="committee-minutes-grid">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Projetos Avaliados ({meetingDetails.evaluations.length})</h3>
                </div>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Projeto / SD</th>
                        <th>Na Reunião</th>
                        <th>Hoje</th>
                        <th>Decisão</th>
                        <th>Nota</th>
                        {isDirector && <th>ROI Mensal</th>}
                        <th>Parecer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meetingDetails.evaluations.map(ev => (
                        <tr key={ev.id}>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span className="font-semibold" style={{ color: 'var(--primary)' }}>{ev.project.sdNumber}</span>
                              <span className="text-xs font-medium">{ev.project.title}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status-badge status-${ev.situationAtMeeting?.status}`}>
                              {ev.situationAtMeeting?.status !== undefined && ev.situationAtMeeting?.status !== null ? (STATUS_LABELS[ev.situationAtMeeting.status] || `Status ${ev.situationAtMeeting.status}`) : 'Não registrado'}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge status-${ev.project.status}`}>
                              {STATUS_LABELS[ev.project.status] || 'Desconhecido'}
                            </span>
                          </td>
                          <td>{getDecisionBadge(ev.decision)}</td>
                          <td style={{ fontWeight: '700' }}>{ev.score !== null && ev.score !== undefined ? `${ev.score}/10` : '—'}</td>
                          {isDirector && (
                            <td style={{ fontWeight: '600', color: 'var(--success)' }}>
                              R$ {(ev.roiMonthly || 0).toLocaleString('pt-BR')}
                            </td>
                          )}
                          <td className="text-xs text-muted" style={{ fontStyle: 'italic' }}>
                            {ev.notes || 'Sem observações.'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Resumo da Ata</h3>
                </div>
                <div style={{ fontSize: '0.8125rem' }}>
                  <div className="detail-row">
                    <span className="detail-label">Data da Reunião</span>
                    <span className="detail-value font-semibold">{formatMeetingDate(meetingDetails.meetingDate)}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Elaborador</span>
                    <span className="detail-value">{meetingDetails.createdBy.name}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Avaliados</span>
                    <span className="detail-value font-semibold">{meetingDetails.evaluations.length} projetos</span>
                  </div>
                  {meetingDetails.notes && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <span className="detail-label">Observações Gerais</span>
                      <p className="mt-1 text-xs" style={{ background: '#fafbfc', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.625rem' }}>
                        {meetingDetails.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando ata...</div>
          )}
        </div>
      )}

      {/* Meetings List */}
      {activeTab === 'meetings' && !selectedMeetingId && (
        <div className="table-container">
          {loadingMeetings ? (
            <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando reuniões...</div>
          ) : meetings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><FileText size={20} /></div>
              <div className="empty-state-title">Nenhuma reunião registrada</div>
              <p className="text-xs text-muted">Registre a ata do comitê diretivo para acompanhar a evolução das demandas.</p>
            </div>
          ) : (
            <>
            <table className="table">
              <thead>
                <tr>
                  <th>Data da Reunião</th>
                  <th>Observações / Resumo</th>
                  <th>Elaborador</th>
                  <th>Avaliados</th>
                  <th style={{ textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {paginatedMeetings.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: '600', color: 'var(--primary)' }}>
                      {formatMeetingDate(m.meetingDate)}
                    </td>
                    <td className="text-muted text-xs">{m.notes || '—'}</td>
                    <td>{m.createdBy.name}</td>
                    <td style={{ fontWeight: '600' }}>{m._count.evaluations} projetos</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                        <button onClick={() => setSelectedMeetingId(m.id)} className="btn btn-secondary btn-xs">
                          <span>Ata Detalhada</span><ChevronRight size={12} />
                        </button>
                        {isAdminOrPm && (
                          <>
                            <button onClick={() => openEditMeetingById(m.id)} className="btn-icon" title="Editar reunião"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeleteMeeting(m.id)} className="btn-icon" title="Excluir reunião" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination-wrapper">
              <div className="pagination-info">
                Mostrando {Math.min((currentMeetingsPage - 1) * meetingsPageSize + 1, meetings.length)} a {Math.min(currentMeetingsPage * meetingsPageSize, meetings.length)} de {meetings.length} atas
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className="pagination-size">
                  <span>Itens por página:</span>
                  <select value={meetingsPageSize} onChange={event => { setMeetingsPageSize(Number(event.target.value)); setMeetingsPage(1); }}>
                    {[10, 15, 20, 25].map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
                <div className="pagination-controls">
                  <button className="pagination-btn" disabled={currentMeetingsPage <= 1} onClick={() => setMeetingsPage(page => page - 1)}><ChevronLeft size={14} /></button>
                  <span className="pagination-current">{currentMeetingsPage} de {meetingsTotalPages}</span>
                  <button className="pagination-btn" disabled={currentMeetingsPage >= meetingsTotalPages} onClick={() => setMeetingsPage(page => page + 1)}><ChevronRight size={14} /></button>
                </div>
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {/* Compare Tab */}
      {activeTab === 'compare' && !selectedMeetingId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Comparar Evolução da Carteira</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px', gap: '1rem', alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Reunião Base (Passado) *</label>
                <select className="input" value={compareMeetingId1} onChange={e => setCompareMeetingId1(e.target.value)}>
                  <option value="">Selecione...</option>
                  {meetings.map(m => (
                    <option key={m.id} value={m.id}>
                      Reunião de {formatMeetingDate(m.meetingDate)} ({m._count.evaluations} projetos)
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Alvo de Comparação</label>
                <select className="input" value={compareMeetingId2} onChange={e => setCompareMeetingId2(e.target.value)}>
                  <option value="current">Cenário Atual (DB)</option>
                  {meetings.map(m => (
                    <option key={m.id} value={m.id}>
                      Reunião de {formatMeetingDate(m.meetingDate)}
                    </option>
                  ))}
                </select>
              </div>
              <button onClick={handleCompare} className="btn btn-primary btn-sm" disabled={loadingCompare || !compareMeetingId1}>
                {loadingCompare ? 'Comparando...' : 'Comparar'}
              </button>
            </div>
          </div>

          {comparisonResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="committee-kpi-grid">
                <div className="kpi-card kpi-blue">
                  <div className="kpi-label">Variação de ROI</div>
                  <div className="kpi-value" style={{ color: comparisonResult.metrics?.roiChange >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {comparisonResult.metrics?.roiChange >= 0 ? '+' : ''}R$ {(comparisonResult.metrics?.roiChange || 0).toLocaleString('pt-BR')}
                  </div>
                </div>
                <div className="kpi-card kpi-green">
                  <div className="kpi-label">Antecipados</div>
                  <div className="kpi-value">{comparisonResult.metrics?.antecipadosCount || 0}</div>
                  <div className="kpi-sub">Projetos com cronograma adiantado</div>
                </div>
                <div className="kpi-card kpi-warning">
                  <div className="kpi-label">Postergados</div>
                  <div className="kpi-value">{comparisonResult.metrics?.postergadosCount || 0}</div>
                  <div className="kpi-sub">Projetos com prazo estendido</div>
                </div>
                <div className="kpi-card kpi-navy">
                  <div className="kpi-label">Conclusões / Cancelamentos</div>
                  <div className="kpi-value">
                    {comparisonResult.metrics?.concluidosCount || 0} conc / {comparisonResult.metrics?.canceladosCount || 0} canc
                  </div>
                </div>
                <div className="kpi-card kpi-blue">
                  <div className="kpi-label">Novos na Carteira</div>
                  <div className="kpi-value">{comparisonResult.metrics?.novosProjetosCount || 0}</div>
                  <div className="kpi-sub">Projetos surgidos após a reunião base</div>
                </div>
                <div className="kpi-card kpi-orange">
                  <div className="kpi-label">Em Homologação</div>
                  <div className="kpi-value">{comparisonResult.metrics?.homologacaoCount || 0}</div>
                  <div className="kpi-sub">Situação no cenário comparado</div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title">Distribuição completa por status</h3>
                    <p className="text-xs text-muted">Fotografia da carteira inteira na reunião base e no cenário comparado.</p>
                  </div>
                </div>
                <div className="table-container">
                  <table className="table">
                    <thead><tr><th>Status</th><th>{comparisonResult.meeting1Label}</th><th>{comparisonResult.meeting2Label}</th><th>Variação</th></tr></thead>
                    <tbody>
                      {[0,1,2,4,5,6,7,8,9].map(status => {
                        const base = comparisonResult.metrics?.statusDistributionBase?.[status] || 0;
                        const compare = comparisonResult.metrics?.statusDistributionCompare?.[status] || 0;
                        return <tr key={status}><td><span className={`status-badge status-${status}`}>{status}. {STATUS_LABELS[status]}</span></td><td>{base}</td><td className="font-semibold">{compare}</td><td style={{ color: compare-base > 0 ? 'var(--primary)' : compare-base < 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 700 }}>{compare-base > 0 ? '+' : ''}{compare-base}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card committee-score-card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}><BarChart3 size={16} /> Notas de prioridade — projetos entregues e em homologação</h3>
                    <p className="text-xs text-muted">Quantidade por nota no cenário comparado, incluindo projetos que ainda não possuem nota definida.</p>
                  </div>
                  <div className="score-chart-legend">
                    <span><i className="legend-completed" /> Concluídos</span>
                    <span><i className="legend-homologation" /> Homologação</span>
                  </div>
                </div>
                <div className="committee-score-chart" role="img" aria-label="Distribuição de notas de prioridade de projetos concluídos e em homologação">
                  {priorityDistribution.map((item: any) => (
                    <div className="score-bucket" key={item.label}>
                      <div className="score-bars">
                        <div className="score-bar-wrap">
                          <span>{item.completed || 0}</span>
                          <i className="score-bar completed" style={{ height: `${((item.completed || 0) / priorityDistributionMax) * 100}%` }} />
                        </div>
                        <div className="score-bar-wrap">
                          <span>{item.homologation || 0}</span>
                          <i className="score-bar homologation" style={{ height: `${((item.homologation || 0) / priorityDistributionMax) * 100}%` }} />
                        </div>
                      </div>
                      <strong>{item.label}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="table-container">
                <div className="card-header" style={{ padding: '1rem' }}>
                  <div><h3 className="card-title">Impactos e mudanças</h3><p className="text-xs text-muted">Projetos com alteração de prazo, decisão ou status.</p></div>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>SD / Projeto</th>
                      <th>Diferença Dias</th>
                      <th>Status Base</th>
                      <th>Status Alvo</th>
                      <th>Decisão Base</th>
                      <th>Decisão Alvo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedImpactDetails.map((d: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: '600' }}>{d.sdNumber} - {d.title}</td>
                        <td style={{ fontWeight: '700' }}>
                          {d.diffDays === 0 ? <span className="text-muted">0 dias</span> :
                           d.diffDays < 0 ? <span style={{ color: 'var(--success)' }}>{d.diffDays} dias</span> :
                           <span style={{ color: 'var(--danger)' }}>+{d.diffDays} dias</span>}
                        </td>
                        <td className="text-muted">{d.oldStatus !== undefined && d.oldStatus !== null ? (STATUS_LABELS[d.oldStatus] || d.oldStatus) : '—'}</td>
                        <td className="font-semibold">{d.newStatus !== undefined && d.newStatus !== null ? (STATUS_LABELS[d.newStatus] || d.newStatus) : '—'}</td>
                        <td>{d.oldDecision || '—'}</td>
                        <td className="font-semibold">{d.newDecision || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {impactDetails.length > 0 && (
                  <div className="pagination-wrapper">
                    <div className="pagination-info">
                      Mostrando {Math.min((impactPage - 1) * impactPageSize + 1, impactDetails.length)} a {Math.min(impactPage * impactPageSize, impactDetails.length)} de {impactDetails.length} mudanças
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div className="pagination-size">
                        <span>Itens por página:</span>
                        <select value={impactPageSize} onChange={event => { setImpactPageSize(Number(event.target.value)); setImpactPage(1); }}>
                          {[10, 15, 20, 25].map(size => <option key={size} value={size}>{size}</option>)}
                        </select>
                      </div>
                      <div className="pagination-controls">
                        <button className="pagination-btn" disabled={impactPage <= 1} onClick={() => setImpactPage(page => page - 1)}><ChevronLeft size={14} /></button>
                        <span className="pagination-current">{impactPage} de {totalImpactPages}</span>
                        <button className="pagination-btn" disabled={impactPage >= totalImpactPages} onClick={() => setImpactPage(page => page + 1)}><ChevronRight size={14} /></button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* NEW MEETING MODAL — Selection list with checkboxes and search */}
      {newMeetingOpen && (
        <div className="modal-overlay" onClick={() => setNewMeetingOpen(false)}>
          <div className="modal-content modal-content-xl committee-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingMeetingId ? 'Editar Reunião de Comitê' : 'Registrar Reunião de Comitê'}</h3>
              <button className="btn-icon" onClick={() => setNewMeetingOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSaveMeeting} className="modal-form">
              <div className="modal-body">
                <div className="form-grid committee-meeting-meta">
                  <div className="form-group">
                    <label className="form-label">Data da Reunião *</label>
                    <input type="date" className="input" required value={meetingDate} onChange={e => setMeetingDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Notas da Ata</label>
                    <input className="input" placeholder="Resumo dos assuntos discutidos..." value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)} />
                  </div>
                </div>

                {/* Filter and selection title */}
                <div className="committee-selection-toolbar">
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Selecione os projetos avaliados nesta reunião ({Object.values(selectedProjects).filter(Boolean).length} selecionados):
                  </label>
                  <div className="input-group" style={{ maxWidth: '240px' }}>
                    <span className="input-icon"><Search size={14} /></span>
                    <input className="input" placeholder="Buscar por SD ou título..." value={searchProjectTerm} onChange={e => setSearchProjectTerm(e.target.value)} style={{ padding: '0.375rem 0.5rem 0.375rem 2rem', fontSize: '0.75rem' }} />
                  </div>
                </div>

                {/* Projects Checkbox List */}
                <div className="committee-project-list">
                  {filteredEligible.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum projeto elegível encontrado.</div>
                  ) : (
                    filteredEligible.map((p, idx) => {
                      const isChecked = selectedProjects[p.id] || false;
                      const currentEval = localDecisions[p.id] || { decision: 'PRIORIZADO', score: 8, notes: '', estimatedMonthlyGain: 0, estimatedMonthlyLossAvoided: 0, expandExtra: false };

                      return (
                        <div key={p.id} className={`committee-project-item ${isChecked ? 'selected' : ''} ${idx % 2 === 0 ? 'alternate' : ''}`}>
                          {/* Top Row: Checkbox + Title + Status */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                            <label className="checkbox-wrapper" style={{ fontWeight: '600', fontSize: '0.8125rem' }}>
                              <input type="checkbox" checked={isChecked} onChange={() => handleToggleProject(p.id)} />
                              <span style={{ color: 'var(--primary)' }}>{p.sdNumber}</span> — {p.title}
                            </label>
                            <span className={`status-badge status-${p.status}`} style={{ fontSize: '0.65rem' }}>
                              {STATUS_LABELS[p.status] || 'Desconhecido'}
                            </span>
                          </div>

                          {/* Evaluation Fields — visible when checked */}
                          {isChecked && (
                            <div className="committee-evaluation-grid">
                              <div>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Decisão *</label>
                                <select className="input" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: '32px' }}
                                  value={currentEval.decision} onChange={e => updateLocalDecision(p.id, 'decision', e.target.value)}>
                                  <option value="PRIORIZADO">Priorizado</option>
                                  <option value="SEGUNDA_FASE">Segunda Fase</option>
                                  <option value="CANCELADO">Cancelado</option>
                                </select>
                              </div>
                              <div>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Nota (0-10)</label>
                                <input type="number" className="input" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: '32px' }}
                                  min="0" max="10" value={currentEval.score ?? ''} onChange={e => updateLocalDecision(p.id, 'score', e.target.value ? Number(e.target.value) : undefined)} />
                              </div>
                              <div>
                                <label className="form-label" style={{ fontSize: '0.7rem' }}>Parecer da Reunião</label>
                                <input className="input" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: '32px' }}
                                  placeholder="Parecer da diretoria..." value={currentEval.notes || ''} onChange={e => updateLocalDecision(p.id, 'notes', e.target.value)} />
                              </div>
                              <button type="button" className="btn btn-secondary btn-icon" title="Mais informações (Ganhos/Prejuízo Evitado)"
                                onClick={() => updateLocalDecision(p.id, 'expandExtra', !currentEval.expandExtra)}>
                                <Award size={15} />
                              </button>
                            </div>
                          )}

                          {/* Extra fields toggle (Ganhos/Prejuízos) */}
                          {isChecked && currentEval.expandExtra && (
                            <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: '#ffffff', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                              <div>
                                <label className="form-label text-xs">Ganho Mensal Estimado (R$)</label>
                                <input type="number" className="input" style={{ padding: '0.25rem', fontSize: '0.75rem' }}
                                  min="0" value={currentEval.estimatedMonthlyGain} onChange={e => updateLocalDecision(p.id, 'estimatedMonthlyGain', Number(e.target.value))} />
                              </div>
                              <div>
                                <label className="form-label text-xs">Prejuízo Mensal Evitado (R$)</label>
                                <input type="number" className="input" style={{ padding: '0.25rem', fontSize: '0.75rem' }}
                                  min="0" value={currentEval.estimatedMonthlyLossAvoided} onChange={e => updateLocalDecision(p.id, 'estimatedMonthlyLossAvoided', Number(e.target.value))} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewMeetingOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-accent btn-sm" disabled={createMeetingMutation.isPending || updateMeetingMutation.isPending}>
                  {editingMeetingId ? 'Salvar Nova Versão da Ata' : 'Salvar Ata da Reunião'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ImpactSimulationModal
        open={previewOpen}
        data={previewData}
        onClose={() => setPreviewOpen(false)}
        onConfirm={async () => { if (pendingConfirmAction) await pendingConfirmAction(); }}
        confirmLabel={editingMeetingId ? 'Salvar Nova Versão' : 'Confirmar Reunião'}
        context="Decisões e notas registradas em uma reunião de comitê"
      />
      <ConfirmationModal
        open={!!meetingToDelete}
        title="Excluir reunião do comitê?"
        description="Os projetos avaliados serão restaurados para a decisão válida mais recente e o cronograma oficial será recalculado."
        detail="A ata continuará preservada para auditoria. Em reuniões históricas antigas, o sistema poderá usar a melhor reconstrução disponível e informará quando isso ocorrer."
        confirmLabel="Excluir e restaurar projetos"
        isPending={deleteMeetingMutation.isPending}
        onClose={() => setMeetingToDelete(null)}
        onConfirm={() => { if (meetingToDelete) deleteMeetingMutation.mutate(meetingToDelete); }}
      />
    </div>
  );
}
