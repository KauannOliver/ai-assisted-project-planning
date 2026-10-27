'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import {
  Building2, FolderEdit, FolderMinus, FolderCheck, ShieldAlert, Loader2, Search, ChevronLeft, ChevronRight
} from 'lucide-react';

interface Department {
  id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE';
}

export default function DepartmentsPage() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Form states
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [targetDept, setTargetDept] = useState<Department | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Queries
  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ['departments'], queryFn: () => apiRequest('/departments'),
  });

  // Mutations
  const createDeptMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/departments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['departments'] }); setShowCreateModal(false); resetForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const updateDeptMutation = useMutation({
    mutationFn: (body: any) => apiRequest(`/departments/${targetDept?.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['departments'] }); setShowEditModal(false); resetForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/departments/${id}/activate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['departments'] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/departments/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['departments'] }),
    onError: (err: any) => alert(err.message || 'Não é possível desativar este departamento.'),
  });

  const resetForm = () => { setDeptCode(''); setDeptName(''); setTargetDept(null); setErrorMsg(null); };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!/^[A-Z0-9_-]+$/i.test(deptCode)) {
      setErrorMsg('O código deve conter apenas letras, números, traços e sublinhados.'); return;
    }
    createDeptMutation.mutate({ code: deptCode.toUpperCase(), name: deptName });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!/^[A-Z0-9_-]+$/i.test(deptCode)) {
      setErrorMsg('O código deve conter apenas letras, números, traços e sublinhados.'); return;
    }
    updateDeptMutation.mutate({ code: deptCode.toUpperCase(), name: deptName });
  };

  // Filtered & Paginated departments
  const filteredDepartments = useMemo(() => {
    return departments.filter(d =>
      d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [departments, searchTerm]);

  const totalPages = Math.ceil(filteredDepartments.length / pageSize);
  const paginatedDepartments = filteredDepartments.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Departamentos</h1>
          <p className="page-subtitle">Cadastre áreas de negócio e centros de custo solicitantes</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent btn-sm" onClick={() => { resetForm(); setShowCreateModal(true); }}>
            <Building2 size={14} /> Novo Departamento
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="input-group" style={{ flex: 1, maxWidth: '300px' }}>
          <span className="input-icon"><Search size={14} /></span>
          <input className="input" placeholder="Buscar código ou nome..." value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }} />
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        {isLoading ? (
          <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando departamentos...</div>
        ) : filteredDepartments.length === 0 ? (
          <div className="empty-state">Nenhum departamento encontrado</div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nome do Departamento</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDepartments.map(d => (
                  <tr key={d.id}>
                    <td className="font-semibold" style={{ color: 'var(--primary)' }}>{d.code}</td>
                    <td>{d.name}</td>
                    <td>
                      <span className={`badge ${d.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`}>
                        {d.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn-icon" title="Editar" onClick={() => {
                          setTargetDept(d); setDeptCode(d.code); setDeptName(d.name); setErrorMsg(null); setShowEditModal(true);
                        }}>
                          <FolderEdit size={15} />
                        </button>
                        {d.status === 'ACTIVE' ? (
                          <button className="btn-icon" style={{ color: 'var(--danger)' }} title="Desativar" onClick={() => deactivateMutation.mutate(d.id)}>
                            <FolderMinus size={15} />
                          </button>
                        ) : (
                          <button className="btn-icon" style={{ color: 'var(--success)' }} title="Ativar" onClick={() => activateMutation.mutate(d.id)}>
                            <FolderCheck size={15} />
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
                Mostrando {Math.min((currentPage - 1) * pageSize + 1, filteredDepartments.length)} a {Math.min(currentPage * pageSize, filteredDepartments.length)} de {filteredDepartments.length} departamentos
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

      {/* Modals */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Novo Departamento</h3>
              <button className="btn-icon" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {errorMsg && <div className="alert alert-danger mb-4"><ShieldAlert size={16} /> <span>{errorMsg}</span></div>}
                <div className="form-group">
                  <label className="form-label">Código do Departamento *</label>
                  <input className="input" required placeholder="Ex: MANUTENCAO" value={deptCode} onChange={e => setDeptCode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nome Completo *</label>
                  <input className="input" required placeholder="Ex: Manutenção Operacional" value={deptName} onChange={e => setDeptName(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={createDeptMutation.isPending}>Cadastrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Editar Departamento</h3>
              <button className="btn-icon" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                {errorMsg && <div className="alert alert-danger mb-4"><ShieldAlert size={16} /> <span>{errorMsg}</span></div>}
                <div className="form-group">
                  <label className="form-label">Código do Departamento *</label>
                  <input className="input" required value={deptCode} onChange={e => setDeptCode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nome Completo *</label>
                  <input className="input" required value={deptName} onChange={e => setDeptName(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowEditModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={updateDeptMutation.isPending}>Salvar Alteração</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
