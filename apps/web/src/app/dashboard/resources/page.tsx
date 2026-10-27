'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { ImpactSimulationModal } from '@/components/ImpactSimulationModal';
import {
  UserPlus, UserX, UserCheck, Edit3, ShieldAlert, Loader2, Info, Search, ChevronLeft, ChevronRight
} from 'lucide-react';

interface CatalogItem { id: string; type: string; code: string; name: string; }
interface Resource {
  id: string; name: string; modalityId: string; roleId: string; weeklyHours: number;
  overheadPercentage: number; developmentPercentage: number; recommendedWipLimit: number;
  status: 'ACTIVE' | 'INACTIVE'; modality: CatalogItem; role: CatalogItem;
  capacity: {
    hoursAfterOverhead: number; weeklyProjCapacity: number; dailyCapacity: number;
    weeklyFormatted: string; dailyFormatted: string;
  };
}

export default function ResourcesPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Form states (using percentages 0-100 for input)
  const [name, setName] = useState('');
  const [modalityId, setModalityId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('44');
  const [overheadPctInput, setOverheadPctInput] = useState('15'); // 15%
  const [devPctInput, setDevPctInput] = useState('70');           // 70%
  const [recommendedWipLimit, setRecommendedWipLimit] = useState('3');
  const [targetResource, setTargetResource] = useState<Resource | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [pendingUpdate, setPendingUpdate] = useState<any>(null);

  // Queries
  const { data: resources = [], isLoading: loadingResources } = useQuery<Resource[]>({
    queryKey: ['resources'], queryFn: () => apiRequest('/resources'),
  });
  const { data: modalities = [] } = useQuery<CatalogItem[]>({
    queryKey: ['catalogs', 'modalities'], queryFn: () => apiRequest('/catalogs/modalities'),
  });
  const { data: roles = [] } = useQuery<CatalogItem[]>({
    queryKey: ['catalogs', 'roles'], queryFn: () => apiRequest('/catalogs/roles'),
  });

  // Live calculation preview
  const livePreview = useMemo(() => {
    const wh = parseFloat(weeklyHours) || 0;
    const oh = (parseFloat(overheadPctInput) || 0) / 100;
    const dev = (parseFloat(devPctInput) || 0) / 100;

    const afterOh = wh * (1 - oh);
    const netWeekly = afterOh * dev;
    const netDaily = netWeekly / 5;

    return {
      wh,
      ohPct: Math.round(oh * 100),
      devPct: Math.round(dev * 100),
      afterOhHours: afterOh.toFixed(1),
      netWeeklyHours: netWeekly.toFixed(1),
      netDailyHours: netDaily.toFixed(1),
    };
  }, [weeklyHours, overheadPctInput, devPctInput]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/resources', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['resources'] }); setShowCreateModal(false); resetForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => apiRequest(`/resources/${targetResource?.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['resources'] }); setShowEditModal(false); setPreviewData(null); setPendingUpdate(null); resetForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const previewUpdateMutation = useMutation({
    mutationFn: (body: any) => apiRequest(`/resources/${targetResource?.id}/preview`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (preview: any, body: any) => {
      setPendingUpdate(body);
      setPreviewData(preview);
      setShowEditModal(false);
    },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/resources/${id}/activate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/resources/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });

  const resetForm = () => {
    setName(''); setModalityId(modalities[0]?.id || ''); setRoleId(roles[0]?.id || '');
    setWeeklyHours('44'); setOverheadPctInput('15'); setDevPctInput('70');
    setRecommendedWipLimit('3'); setTargetResource(null); setErrorMsg(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const body = {
      name,
      modalityId: modalityId || modalities[0]?.id,
      roleId: roleId || roles[0]?.id,
      weeklyHours: parseFloat(weeklyHours),
      overheadPercentage: (parseFloat(overheadPctInput) || 0) / 100,
      developmentPercentage: (parseFloat(devPctInput) || 0) / 100,
      recommendedWipLimit: parseInt(recommendedWipLimit, 10),
    };
    if (isNaN(body.weeklyHours) || body.weeklyHours <= 0) {
      setErrorMsg('Horas semanais devem ser maiores que zero.'); return;
    }
    createMutation.mutate(body);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const body = {
      name, modalityId, roleId,
      weeklyHours: parseFloat(weeklyHours),
      overheadPercentage: (parseFloat(overheadPctInput) || 0) / 100,
      developmentPercentage: (parseFloat(devPctInput) || 0) / 100,
      recommendedWipLimit: parseInt(recommendedWipLimit, 10),
    };
    previewUpdateMutation.mutate(body);
  };

  // Filtered & Paginated resources
  const filteredResources = useMemo(() => {
    return resources.filter(r =>
      r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.modality.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [resources, searchTerm]);

  const totalPages = Math.ceil(filteredResources.length / pageSize);
  const paginatedResources = filteredResources.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Recursos Técnicos</h1>
          <p className="page-subtitle">Gerencie capacidade líquida, overhead e limites de WIP do time</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent btn-sm" onClick={() => { resetForm(); setShowCreateModal(true); }}>
            <UserPlus size={14} /> Cadastrar Recurso
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="input-group" style={{ flex: 1, maxWidth: '300px' }}>
          <span className="input-icon"><Search size={14} /></span>
          <input className="input" placeholder="Buscar por nome, cargo ou modalidade..." value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }} />
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        {loadingResources ? (
          <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando recursos...</div>
        ) : filteredResources.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">Nenhum recurso encontrado</div>
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cargo</th>
                  <th>Modalidade</th>
                  <th>Capacidade Diária</th>
                  <th>Capacidade Semanal</th>
                  <th>Limite WIP</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedResources.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold" style={{ color: 'var(--foreground)' }}>{r.name}</td>
                    <td>{r.role.name}</td>
                    <td><span className="badge badge-navy">{r.modality.name}</span></td>
                    <td className="font-semibold" style={{ color: 'var(--primary)' }}>{r.capacity.dailyFormatted}</td>
                    <td className="font-semibold" style={{ color: 'var(--primary)' }}>{r.capacity.weeklyFormatted}</td>
                    <td>{r.recommendedWipLimit} proj.</td>
                    <td>
                      <span className={`badge ${r.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`}>
                        {r.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn-icon" title="Editar" onClick={() => {
                          setTargetResource(r);
                          setName(r.name); setModalityId(r.modalityId); setRoleId(r.roleId);
                          setWeeklyHours(String(r.weeklyHours));
                          setOverheadPctInput(String(Math.round(r.overheadPercentage * 100)));
                          setDevPctInput(String(Math.round(r.developmentPercentage * 100)));
                          setRecommendedWipLimit(String(r.recommendedWipLimit));
                          setErrorMsg(null); setShowEditModal(true);
                        }}>
                          <Edit3 size={15} />
                        </button>
                        {r.status === 'ACTIVE' ? (
                          <button className="btn-icon" title="Desativar" style={{ color: 'var(--danger)' }} onClick={() => deactivateMutation.mutate(r.id)}>
                            <UserX size={15} />
                          </button>
                        ) : (
                          <button className="btn-icon" title="Ativar" style={{ color: 'var(--success)' }} onClick={() => activateMutation.mutate(r.id)}>
                            <UserCheck size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="pagination-wrapper">
              <div className="pagination-info">
                Mostrando {Math.min((currentPage - 1) * pageSize + 1, filteredResources.length)} a {Math.min(currentPage * pageSize, filteredResources.length)} de {filteredResources.length} recursos
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

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h3>Novo Recurso Técnico</h3>
              <button className="btn-icon" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {errorMsg && (
                  <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
                    <ShieldAlert size={16} /> <span>{errorMsg}</span>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Nome Completo *</label>
                  <input className="input" required placeholder="Nome do colaborador" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Cargo *</label>
                    <select className="input" value={roleId} onChange={e => setRoleId(e.target.value)}>
                      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Modalidade *</label>
                    <select className="input" value={modalityId} onChange={e => setModalityId(e.target.value)}>
                      {modalities.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Horas Semanais *</label>
                    <input type="number" className="input" required value={weeklyHours} onChange={e => setWeeklyHours(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Overhead (%) *</label>
                    <input type="number" className="input" min="0" max="100" required value={overheadPctInput} onChange={e => setOverheadPctInput(e.target.value)} placeholder="Ex: 15" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Dedicação Dev (%) *</label>
                    <input type="number" className="input" min="0" max="100" required value={devPctInput} onChange={e => setDevPctInput(e.target.value)} placeholder="Ex: 70" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Limite WIP *</label>
                    <input type="number" className="input" min="1" required value={recommendedWipLimit} onChange={e => setRecommendedWipLimit(e.target.value)} />
                  </div>
                </div>

                {/* Live Preview Calculation Box */}
                <div className="alert alert-info" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <span className="font-semibold">Prévia de Horas Líquidas Calculadas:</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.375rem', fontSize: '0.75rem' }}>
                    <div>Horas Líquidas Semanais: <strong>{livePreview.netWeeklyHours}h</strong></div>
                    <div>Horas Líquidas Diárias: <strong>{livePreview.netDailyHours}h/dia</strong></div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Gravando...' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h3>Editar Recurso Técnico</h3>
              <button className="btn-icon" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                {errorMsg && (
                  <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
                    <ShieldAlert size={16} /> <span>{errorMsg}</span>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Nome Completo *</label>
                  <input className="input" required value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Cargo *</label>
                    <select className="input" value={roleId} onChange={e => setRoleId(e.target.value)}>
                      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Modalidade *</label>
                    <select className="input" value={modalityId} onChange={e => setModalityId(e.target.value)}>
                      {modalities.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Horas Semanais *</label>
                    <input type="number" className="input" required value={weeklyHours} onChange={e => setWeeklyHours(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Overhead (%) *</label>
                    <input type="number" className="input" min="0" max="100" required value={overheadPctInput} onChange={e => setOverheadPctInput(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Dedicação Dev (%) *</label>
                    <input type="number" className="input" min="0" max="100" required value={devPctInput} onChange={e => setDevPctInput(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Limite WIP *</label>
                    <input type="number" className="input" min="1" required value={recommendedWipLimit} onChange={e => setRecommendedWipLimit(e.target.value)} />
                  </div>
                </div>

                {/* Live Preview */}
                <div className="alert alert-info" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <span className="font-semibold">Prévia de Horas Líquidas Calculadas:</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.375rem', fontSize: '0.75rem' }}>
                    <div>Horas Líquidas Semanais: <strong>{livePreview.netWeeklyHours}h</strong></div>
                    <div>Horas Líquidas Diárias: <strong>{livePreview.netDailyHours}h/dia</strong></div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowEditModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={previewUpdateMutation.isPending || updateMutation.isPending}>
                  {previewUpdateMutation.isPending ? 'Simulando impacto...' : 'Salvar Alteração'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ImpactSimulationModal
        open={Boolean(previewData)}
        data={previewData}
        context={`Alteração da capacidade de ${targetResource?.name || 'um recurso'}`}
        confirmLabel="Confirmar alteração de capacidade"
        isConfirming={updateMutation.isPending}
        onClose={() => { setPreviewData(null); setPendingUpdate(null); setShowEditModal(true); }}
        onConfirm={() => { if (pendingUpdate) updateMutation.mutate(pendingUpdate); }}
      />
    </div>
  );
}
